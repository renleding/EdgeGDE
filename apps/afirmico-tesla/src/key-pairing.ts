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
        error: `http_${res.status}`,
      }
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const response = body.response as Record<string, unknown> | undefined

    const keyPaired = response?.key_paired === true
    const synced = response?.synced === true

    let newState: KeyPairingResult['newState'] = 'unknown'
    if (keyPaired) newState = 'paired'
    else if (synced) newState = 'pending'
    else newState = 'unknown'

    return { vin, previousState: 'unknown', newState, keyPaired, synced }
  } catch (error) {
    return {
      vin,
      previousState: 'unknown',
      newState: 'failed',
      keyPaired: false,
      synced: false,
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
  // Get vehicles with key_state IN ('unpaired', NULL)
  const vehicles = await env.D1_TESLA.prepare(
    `SELECT v.vin, v.display_name, v.model, vk.key_state
       FROM tesla_vehicle v
       LEFT JOIN tesla_vehicle_key vk ON vk.vin = v.vin
      WHERE v.member_id = ?
        AND (vk.key_state IS NULL OR vk.key_state = 'unpaired')
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
    const currentKeyState = vehicle.key_state ?? 'unpaired'
    const polling = await pollKeyPairing(env, vehicle.vin, accessToken)

    // If key_paired became true, update key_state to 'paired' in DB
    if (polling.keyPaired && currentKeyState !== 'paired') {
      await env.D1_TESLA.prepare(
        `INSERT INTO tesla_vehicle_key (vin, key_state, paired_at, updated_at)
           VALUES (?, 'paired', datetime('now'), datetime('now'))
           ON CONFLICT(vin) DO UPDATE SET
             key_state = 'paired',
             paired_at = datetime('now'),
             updated_at = datetime('now')`
      )
      .bind(vehicle.vin)
      .run()
      results.push({ vin: vehicle.vin, keyState: 'paired', displayName: vehicle.display_name, model: vehicle.model })
    } else if (polling.synced && currentKeyState === 'unpaired') {
      // Update to unpaired (synced means config is sent but key not yet approved)
      // We keep 'unpaired' as the state since the schema only allows those values
      // The dashboard will show 'Pending approval' based on synced=true
      results.push({ vin: vehicle.vin, keyState: 'unpaired', displayName: vehicle.display_name, model: vehicle.model })
    } else {
      results.push({ vin: vehicle.vin, keyState: currentKeyState, displayName: vehicle.display_name, model: vehicle.model })
    }
  }

  return results
}

/**
 * Cron job: Poll all vehicles with key_state IN ('pending', 'unknown', NULL)
 * for key pairing status. Runs every 5 minutes via Cloudflare Cron Trigger.
 */
export async function cronPollAllKeyPairing(env: Env): Promise<{
  checked: number
  paired: number
  failed: number
  errors: string[]
}> {
  const vehicles = await env.D1_TESLA.prepare(
    `SELECT v.vin, v.member_id, v.display_name, v.model, vk.key_state
       FROM tesla_vehicle v
       LEFT JOIN tesla_vehicle_key vk ON vk.vin = v.vin
      WHERE vk.key_state IS NULL OR vk.key_state = 'unpaired'
      ORDER BY v.first_seen_at`
  ).all<{ vin: string; member_id: string; display_name: string | null; model: string | null; key_state: string | null }>()

  if (!vehicles.results?.length) {
    return { checked: 0, paired: 0, failed: 0, errors: [] }
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

      const currentKeyState = vehicle.key_state ?? 'unpaired'
      if (polling.keyPaired && currentKeyState !== 'paired') {
        await env.D1_TESLA.prepare(
          `INSERT INTO tesla_vehicle_key (vin, key_state, paired_at, updated_at)
             VALUES (?, 'paired', datetime('now'), datetime('now'))
             ON CONFLICT(vin) DO UPDATE SET
               key_state = 'paired',
               paired_at = datetime('now'),
               updated_at = datetime('now')`
        )
          .bind(vehicle.vin)
          .run()
        paired++
      } else if (polling.synced && currentKeyState === 'unpaired') {
        // Config is synced but key not yet approved - keep 'unpaired' state
        // The dashboard shows 'Pending approval' based on synced=true
      }
    }
  }

  return { checked, paired, failed, errors }
}