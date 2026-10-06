/**
 * Virtual Key Pairing Detection (F02-R09a, F02-R09b)
 *
 * Detects when a member has approved the virtual key in the Tesla app by polling
 * Tesla's `fleet_telemetry_config` endpoint for `key_paired: true`.
 *
 * This operates INDEPENDENTLY of telemetry ingest (which requires a paired key
 * to function — circular dependency). The polling is the primary detection mechanism.
 *
 * Flow:
 * 1. Member completes OAuth consent → vehicle record created with key_state='pending'
 * 2. Dashboard loads → checks key_state for each vehicle
 * 3. If key_state IN ('pending', 'unknown') → poll fleet_telemetry_config
 * 4. If key_paired: true → update key_state to 'paired' and trigger telemetry config send
 * 5. Cron job also polls every 5 minutes for all pending vehicles
 */

import type { Env } from './index'
import { openToken, sealToken } from './crypto'

export interface KeyPairingResult {
  vin: string
  previousState: string
  newState: 'paired' | 'pending' | 'unknown' | 'failed'
  keyPaired: boolean
  synced: boolean
  /**
   * True when Tesla lists the VIN in `unpaired_vins` while the vehicle also
   * carries a telemetry config. That combination means the owner removed the
   * virtual key at the car (Locks screen) rather than it never having been
   * added, which is a different operational situation and is recorded
   * separately so the dashboard and the operator prompt differ accordingly.
   */
  unpairedByOwner: boolean
  /**
   * Whether Tesla holds a telemetry config for this VIN, and where it points.
   * This is the only evidence that a config actually reached the vehicle --
   * a 2xx from the send proves the request was accepted, not that the vehicle
   * adopted it, and `synced` alone stays true after a config is removed.
   */
  hasConfig: boolean
  configHostname: string | null
  configPort: number | null
  error?: string
}

/**
 * Poll Tesla's fleet_telemetry_config endpoint for a single VIN.
 * Returns the pairing state and whether the config is synced.
 */
export async function pollKeyPairing(
  env: Env,
  vin: string,
  accessToken: string
): Promise<KeyPairingResult> {
  const base = 'https://fleet-api.prd.na.vn.cloud.tesla.com'
  const url = `${base}/api/1/vehicles/${encodeURIComponent(vin)}/fleet_telemetry_config`

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
    })

    if (!res.ok) {
      return {
        vin,
        previousState: 'unknown',
        newState: 'failed',
        keyPaired: false,
        synced: false,
        unpairedByOwner: false,
        hasConfig: false,
        configHostname: null,
        configPort: null,
        error: `http_${res.status}`,
      }
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const response = body.response as Record<string, unknown> | undefined

    const keyPaired = response?.key_paired === true
    const synced = response?.synced === true
    // A config present on the vehicle with the key not paired means the key was
    // added once and later removed at the car -- distinguishing it from a vehicle
    // whose key was never added (which carries no config).
    const config = response?.config as Record<string, unknown> | null | undefined
    const hasConfig = Boolean(config)
    const unpairedByOwner = !keyPaired && hasConfig

    let newState: KeyPairingResult['newState'] = 'unknown'
    if (keyPaired) newState = 'paired'
    else if (synced) newState = 'pending'
    else newState = 'unknown'

    return {
      vin,
      previousState: 'unknown',
      newState,
      keyPaired,
      synced,
      unpairedByOwner,
      hasConfig,
      configHostname: (config?.hostname as string | undefined) ?? null,
      configPort: typeof config?.port === 'number' ? (config.port as number) : null,
    }
  } catch (error) {
    return {
      vin,
      previousState: 'unknown',
      newState: 'failed',
      keyPaired: false,
      synced: false,
      unpairedByOwner: false,
      hasConfig: false,
      configHostname: null,
      configPort: null,
      error: `transport:${(error as Error).message}`,
    }
  }
}

/**
 * Get a valid member access token for polling.
 * Uses the stored refresh token to get a fresh access token.
 */
export async function getMemberAccessToken(
  env: Env,
  memberId: string
): Promise<string | null> {
  const row = await env.D1_TESLA.prepare(
    `SELECT refresh_token_enc, refresh_token_iv, key_version, access_token_expires_at
       FROM tesla_oauth_token
      WHERE member_id = ?
      ORDER BY updated_at DESC
      LIMIT 1`
  )
    .bind(memberId)
    .first<{ refresh_token_enc: string; refresh_token_iv: string; key_version: number; access_token_expires_at: string }>()

  if (!row) return null

  // Check if we have a valid access token (we don't store it, so we check expiry)
  const expiresAt = new Date(row.access_token_expires_at).getTime()
  const now = Date.now()
  const fiveMin = 5 * 60 * 1000

  if (expiresAt - now > fiveMin) {
    // We don't store the access token, so we need to refresh
    // This means we always refresh for polling (safer anyway)
  }

  // Decrypt the refresh token and use it to get a fresh access token
  try {
    const refreshToken = await openToken(
      { ciphertext: row.refresh_token_enc, iv: row.refresh_token_iv, keyVersion: row.key_version },
      env.TOKEN_ENCRYPTION_KEY
    )
    const refreshed = await refreshAccessToken(env, memberId, refreshToken)
    return refreshed
  } catch {
    return null
  }
}

/**
 * Refresh the access token using the refresh token.
 */
async function refreshAccessToken(
  env: Env,
  memberId: string,
  refreshToken: string
): Promise<string | null> {
  const clientId = env.TESLA_CLIENT_ID
  const clientSecret = env.TESLA_CLIENT_SECRET

  if (!clientId || !clientSecret) return null

  try {
    const res = await fetch('https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    })

    if (!res.ok) return null

    const body = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    const newAccessToken = body.access_token
    const newRefreshToken = body.refresh_token ?? refreshToken
    const expiresAt = new Date(Date.now() + body.expires_in * 1000).toISOString()

    // Store updated tokens (encrypt the new refresh token)
    const sealed = await sealToken(newRefreshToken, env.TOKEN_ENCRYPTION_KEY)
    await env.D1_TESLA.prepare(
      `UPDATE tesla_oauth_token
          SET refresh_token_enc = ?, refresh_token_iv = ?, key_version = ?,
              access_token_expires_at = ?, updated_at = datetime('now')
        WHERE member_id = ?`
    )
      .bind(sealed.ciphertext, sealed.iv, sealed.keyVersion, expiresAt, memberId)
      .run()

    return newAccessToken
  } catch {
    return null
  }
}

/**
 * Check and update key pairing state for a member's vehicles.
 * Called from dashboard on load.
 * Returns updated vehicle list with pairing states.
 */
export async function checkAndUpdateKeyPairing(
  env: Env,
  memberId: string
): Promise<Array<{ vin: string; keyState: string; displayName: string | null; model: string | null }>> {
  // Deliberately NOT filtered to unpaired rows. A vehicle previously recorded
  // `paired` must still be re-verified: the owner can remove the virtual key at
  // any time from the car's Locks screen, and Tesla then reports
  // `key_paired: false` / `unpaired_vins: [...]` with no notification to us.
  // Filtering by state is what let a revoked key stay `paired` in our records
  // indefinitely while the vehicle silently stopped streaming.
  const vehicles = await env.D1_TESLA.prepare(
    `SELECT v.vin, v.display_name, v.model, vk.key_state
       FROM tesla_vehicle v
       LEFT JOIN tesla_vehicle_key vk ON vk.vin = v.vin
      WHERE v.member_id = ?
      ORDER BY v.first_seen_at`
  )
    .bind(memberId)
    .all<{ vin: string; display_name: string | null; model: string | null; key_state: string | null }>()

  if (!vehicles.results?.length) return []

  const accessToken = await getMemberAccessToken(env, memberId)
  if (!accessToken) return vehicles.results.map(v => ({
    vin: v.vin,
    keyState: v.key_state ?? 'unpaired',
    displayName: v.display_name,
    model: v.model,
  }))

  const results: Array<{ vin: string; keyState: string; displayName: string | null; model: string | null }> = []

  for (const vehicle of vehicles.results) {
    const polling = await pollKeyPairing(env, vehicle.vin, accessToken)
    const actual = await reconcileKeyState(env, vehicle.vin, polling.keyPaired, polling.unpairedByOwner)
    results.push({ vin: vehicle.vin, keyState: actual, displayName: vehicle.display_name, model: vehicle.model })
  }

  return results
}

export type ConfigVerification =
  | { action: 'verify' }
  | { action: 'demote'; reason: string }

/**
 * Decide what to do with a config row, given Tesla's evidence.
 *
 * Pure and exported so every branch is pinned by a test. It never promotes a row
 * -- only sending a config creates one -- and it only confirms on affirmative
 * evidence (Tesla holds a config pointing at our host).
 */
export function decideConfigVerification(
  row: { state: string; hostname: string | null; verified_at: string | null } | null,
  tesla: { keyPaired: boolean; hasConfig: boolean; configHostname: string | null },
): ConfigVerification | null {
  if (!row) return null
  // Only live claims are in scope; a row already failed/removed is not something
  // this check corrects.
  if (row.state !== 'active' && row.state !== 'pending') return null

  const hostMatches =
    tesla.hasConfig && row.hostname !== null && tesla.configHostname === row.hostname
  if (hostMatches) {
    return row.verified_at ? null : { action: 'verify' }
  }

  const reason = !tesla.keyPaired
    ? 'key_not_paired'
    : !tesla.hasConfig
      ? 'config_absent_at_tesla'
      : 'config_hostname_mismatch'
  return { action: 'demote', reason }
}

/**
 * Reconcile a telemetry-config row against what Tesla actually holds.
 *
 * This is F11-R02's obligation, which was designed and then never built: an
 * `active` row that has never been verified is a claim, not a fact. Observed
 * live -- vehicle 5YJ3F7EB7LF697834 held a row in state `active` with
 * `verified_at: null` while Tesla reported `config: null` for it, and nothing
 * anywhere would ever have corrected that.
 *
 * The evidence used is Tesla's own `fleet_telemetry_config` response:
 *   - `config` present and the hostname matches ours -> verified, set
 *     `verified_at`, keep `active`.
 *   - `config` absent -> the vehicle does not hold our config. Transition the
 *     row out of `active` so no surface keeps asserting collection that is not
 *     happening. If the key is also unpaired the cause is `key_not_paired`;
 *     otherwise the config was dropped (revocation, another app taking the slot,
 *     or a failed adoption).
 *
 * Deliberately narrow: this only ever DEMOTES a row it can prove wrong, and only
 * sets `verified_at` on affirmative evidence. It never promotes a row to
 * `active` -- sending a config is still the only thing that creates one.
 *
 * Returns the state the row now holds, or null when nothing changed.
 */
export async function reconcileTelemetryConfig(
  env: Env,
  vin: string,
  polling: KeyPairingResult,
): Promise<{ from: string; to: string; reason: string } | null> {
  const row = await env.D1_TESLA.prepare(
    `SELECT state, hostname, verified_at FROM tesla_telemetry_config
      WHERE vin = ? AND state IN ('active','pending')
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(vin)
    .first<{ state: string; hostname: string | null; verified_at: string | null }>()

  if (!row) return null

  const nowIso = new Date().toISOString()
  const decision = decideConfigVerification(row, polling)
  if (!decision) return null

  if (decision.action === 'verify') {
    await env.D1_TESLA.prepare(
      `UPDATE tesla_telemetry_config SET verified_at = ? WHERE vin = ? AND state = ?`,
    )
      .bind(nowIso, vin, row.state)
      .run()
    return null
  }

  await env.D1_TESLA.prepare(
    `UPDATE tesla_telemetry_config
        SET state = 'failed', last_error = ?, verified_at = ?
      WHERE vin = ? AND state IN ('active','pending')`,
  )
    .bind(decision.reason, nowIso, vin)
    .run()

  return { from: row.state, to: 'failed', reason: decision.reason }
}

/**
 * Decide the `key_state` our record should hold, from Tesla's two booleans.
 *
 * Pure and exported so the mapping is pinned by a test: this is the decision that
 * was previously wrong in one direction only (upgrade recorded, downgrade
 * ignored), which is how a removed key stayed "paired" indefinitely.
 */
export function resolveKeyState(keyPaired: boolean, unpairedByOwner: boolean): {
  state: 'paired' | 'unpaired' | 'unpaired_by_owner'
  lastError: string | null
} {
  if (keyPaired) return { state: 'paired', lastError: null }
  if (unpairedByOwner) return { state: 'unpaired_by_owner', lastError: 'key_removed_by_owner' }
  return { state: 'unpaired', lastError: 'key_not_paired_at_tesla' }
}

/**
 * Make our `tesla_vehicle_key` row match what Tesla just told us, in both
 * directions.
 *
 * Recording only the upgrade (`unpaired` -> `paired`) is a one-way ratchet: once
 * a vehicle is marked paired, a later removal at the car is never recorded, and
 * every downstream surface keeps asserting a pairing that no longer exists. That
 * is the silent-false-success class this platform has already been bitten by, so
 * both directions are written here.
 *
 * `unpaired_by_owner` is set when Tesla reports the owner deliberately removed
 * the key, which is operationally different from "never paired" and is already a
 * permitted state in the schema.
 */
async function reconcileKeyState(
  env: Env,
  vin: string,
  keyPaired: boolean,
  unpairedByOwner: boolean,
): Promise<string> {
  const { state: nextState, lastError } = resolveKeyState(keyPaired, unpairedByOwner)

  await env.D1_TESLA.prepare(
    `INSERT INTO tesla_vehicle_key (vin, key_state, paired_at, last_error, updated_at)
       VALUES (?, ?, CASE WHEN ? = 'paired' THEN datetime('now') ELSE NULL END, ?, datetime('now'))
       ON CONFLICT(vin) DO UPDATE SET
         key_state = excluded.key_state,
         -- Keep the first paired_at; only set it when we have never had one.
         paired_at = CASE
           WHEN excluded.key_state = 'paired' THEN COALESCE(tesla_vehicle_key.paired_at, datetime('now'))
           ELSE NULL
         END,
         last_error = excluded.last_error,
         updated_at = datetime('now')`
  )
    .bind(vin, nextState, nextState, lastError)
    .run()

  return nextState
}

/**
 * Cron job: Poll all vehicles with key_state IN ('pending', 'unknown', NULL)
 * for key pairing status. Runs every 5 minutes via Cloudflare Cron Trigger.
 */
export async function cronPollAllKeyPairing(env: Env): Promise<{
  checked: number
  paired: number
  unpaired: number
  failed: number
  errors: string[]
}> {
  // Every vehicle, every run -- no key_state filter.
  //
  // Filtering to `unpaired` made the pairing record a one-way ratchet: a vehicle
  // marked `paired` was never polled again, so a key removed at the car stayed
  // "paired" in our records forever and the vehicle silently stopped streaming
  // while every surface we show asserted it was connected.
  //
  // The cost of polling all vehicles is one GET per VIN per 5 minutes, which is
  // what the pairing cron already spends on the unpaired set; correctness here is
  // worth more than the saved call, because the failure mode is invisible.
  const vehicles = await env.D1_TESLA.prepare(
    `SELECT v.vin, v.member_id, v.display_name, v.model, vk.key_state
       FROM tesla_vehicle v
       LEFT JOIN tesla_vehicle_key vk ON vk.vin = v.vin
      ORDER BY v.first_seen_at`
  ).all<{ vin: string; member_id: string; display_name: string | null; model: string | null; key_state: string | null }>()

  if (!vehicles.results?.length) {
    return { checked: 0, paired: 0, unpaired: 0, failed: 0, errors: [] }
  }

  // Group by member to reuse access tokens
  const byMember = new Map<string, typeof vehicles.results>()
  for (const v of vehicles.results) {
    const arr = byMember.get(v.member_id) ?? []
    arr.push(v)
    byMember.set(v.member_id, arr)
  }

  let checked = 0
  let paired = 0
  let unpaired = 0
  let failed = 0
  const errors: string[] = []

  for (const [memberId, memberVehicles] of byMember) {
    const accessToken = await getMemberAccessToken(env, memberId)
    if (!accessToken) {
      errors.push(`No access token for member ${memberId}`)
      failed += memberVehicles.length
      continue
    }

    for (const vehicle of memberVehicles) {
      checked++
      const polling = await pollKeyPairing(env, vehicle.vin, accessToken)

      if (polling.error) {
        failed++
        errors.push(`${vehicle.vin}: ${polling.error}`)
        continue
      }

      // Reconcile both directions and record the transition, so a key removed at
      // the car is a visible event rather than a silent state change.
      const previous = vehicle.key_state ?? 'unpaired'
      const actual = await reconcileKeyState(env, vehicle.vin, polling.keyPaired, polling.unpairedByOwner)

      if (actual === 'paired') paired++
      else unpaired++

      if (actual !== previous) {
        // console.warn rather than the log level the governance gate forbids in
        // production code: a key-state transition is a warning-level event (a
        // vehicle just stopped or started streaming), not chatter.
        console.warn(`[cron] key-pairing-poll transition ${vehicle.vin}: ${previous} -> ${actual} (key_paired=${polling.keyPaired}, unpaired_by_owner=${polling.unpairedByOwner})`)
      }

      // Verify the config row against Tesla too. A row claiming `active` with a
      // null `verified_at` is a claim, not a fact -- and nothing else in the
      // platform ever checks it.
      try {
        const cfgChange = await reconcileTelemetryConfig(env, vehicle.vin, polling)
        if (cfgChange) {
          console.warn(`[cron] config verification corrected ${vehicle.vin}: ${cfgChange.from} -> ${cfgChange.to} (${cfgChange.reason})`)
        }
      } catch (error) {
        errors.push(`${vehicle.vin}: config verify failed: ${(error as Error).message}`)
      }
    }
  }

  return { checked, paired, unpaired, failed, errors }
}