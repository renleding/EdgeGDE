/**
 * FEATURE-14 — the poll coordinator (FRS-010 v2.3 F14-R01..R10, SDD-012).
 *
 * WHAT THIS IS
 * ------------
 * The second transport lane beside Fleet Telemetry: REST polling of
 * low-frequency and static fields, fired ONLY as a co-processor of a telemetry
 * ingest. The two structural rules this module exists to enforce:
 *
 *   F14-R02 — no poll without a batch, and no `wake_up`, ever. The ONLY call
 *   site for `runPollCoordinator` is inside the ingest handler, after
 *   `persistDatums()` commits a batch. A sleeping vehicle produces no batches,
 *   so it produces no polls, whatever the cadence table says. There is no cron
 *   entry point and no admin route: exporting nothing else is the mechanism.
 *
 *   F14-R01 — transport comes from the catalog, never from an operator. The
 *   candidate set is built by SQL joining `tesla_field_catalog` on a NON-NULL
 *   `vehicle_data_equivalent`. Fields without a REST equivalent (MilesSinceReset,
 *   SelfDrivingMilesSinceReset) are structurally absent from the candidate set —
 *   they cannot poll because the SQL can never name them.
 *
 * The three cadences (F14-R03/R04/R05):
 *   - identity fields (CarType, EfficiencyPackage, Version, Trim): polled
 *     EXACTLY ONCE per VIN, at first sync, to build the member profile;
 *   - Odometer: backstop on its configured interval — the seed (0019) sets
 *     604800s, which IS the owner's weekly cadence;
 *   - the on_change state fields (SentryMode, SpeedLimitMode and the settings
 *     fields): telemetry-only by F14-R05, excluded from candidates by the same
 *     non-null-equivalent join plus the explicit exclusion list.
 *
 * Design note — the identity tier trap. `persistDatums()` routes `once` fields
 * to the snapshot table, but the snapshot trigger requires the CATALOG tier to
 * be 'once'. Odometer's catalog tier is 'event' (migration 0013 gave Trim
 * 'once', but Odometer never gets one). Poll writes therefore go through
 * `persistPolledValues`, which maps by catalog tier directly and never relies
 * on a transport-implied tier — a polled row and a streamed row differ only by
 * `source` (F14-R10).
 *
 * Failure handling is swallow-and-record (SDD-012 §7): a poll failure must
 * never fail the ingest batch it rode in on. Every outcome is written to
 * telemetry_poll_state, so the next batch sees it and retries under the same
 * cadence rules.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { persistDatums, recordSignals } from './telemetry'
import { memberMayBeCollected, newId } from './store'
import { getMemberAccessToken } from './key-pairing'
import type { Env } from './index'

/** The REST paths this module may request. A test asserts this list contains no wake endpoint. */
export const TESLA_POLL_PATHS = ['/vehicle_data', '/vehicle_config'] as const

const FLEET_API = 'https://fleet-api.prd.na.vn.cloud.tesla.com'
const POLL_TIMEOUT_MS = 8_000

/**
 * Fields polled exactly once at first sync (F14-R03): model, variant, version.
 * These are `once`-tier catalog fields with a REST equivalent. `Trim` joins them
 * once its vehicle_config path is confirmed against live Tesla (SDD-012 §9 O-3
 * variant: a new Version arriving over telemetry contradicts the stored value —
 * today that mismatch is visible, no automatic re-poll).
 */
const IDENTITY_FIELDS = ['CarType', 'EfficiencyPackage', 'Version'] as const

/**
 * F14-R05: on_change state fields that HAVE a REST equivalent but stay on
 * telemetry (owner: "state change ok - telemetry"). Excluded explicitly — the
 * non-null join would otherwise make them poll candidates.
 */
const TELEMETRY_ONLY_STATE = ['SentryMode', 'SpeedLimitMode'] as const

export interface PollOutcome {
  vin: string
  identityPolled: number
  pollsRun: number
  fieldsPolled: number
  /** Set when a REST call was attempted and failed; the ingest response surfaces it in `errors`. */
  lastError: string | null
}

/* -------------------------------------------------------------------------- */
/* Pure due-check logic (unit-testable without any I/O)                      */
/* -------------------------------------------------------------------------- */

export function isDue(lastPollAt: string | null, intervalSeconds: number, nowMs: number): boolean {
  if (lastPollAt === null) return true
  const last = Date.parse(lastPollAt)
  if (Number.isNaN(last)) return true
  return nowMs - last >= intervalSeconds * 1000
}

/**
 * The fields a poll may carry for this VIN (F14-R01). Pure: given the catalog
 * candidates and the state, decide what to fetch. Exported so the tests can
 * assert the FSD counters are structurally impossible to poll without touching
 * a database or the network.
 */
export function planPoll(opts: {
  candidates: Array<{ field_key: string; interval_seconds: number }>
  identityDone: boolean
  lastPollAt: string | null
  nowMs: number
}): { identityFields: string[]; dueFields: string[] } {
  const excluded = new Set<string>(TELEMETRY_ONLY_STATE)
  const identitySet = new Set<string>(IDENTITY_FIELDS)

  const identityFields = opts.identityDone
    ? []
    : opts.candidates
        .map((c) => c.field_key)
        .filter((k) => identitySet.has(k) && !excluded.has(k))

  const dueFields = opts.candidates
    .filter((c) => !identitySet.has(c.field_key) && !excluded.has(c.field_key))
    .filter((c) => isDue(opts.lastPollAt, c.interval_seconds, opts.nowMs))
    .map((c) => c.field_key)

  return { identityFields, dueFields }
}

/* -------------------------------------------------------------------------- */
/* Candidate discovery (SQL builds the set — F14-R01)                        */
/* -------------------------------------------------------------------------- */

async function loadCandidates(
  db: D1Database,
  vin: string,
): Promise<Array<{ field_key: string; interval_seconds: number }>> {
  const rows = await db
    .prepare(
      `SELECT c.field_key AS field_key, e.interval_seconds AS interval_seconds
         FROM tesla_field_catalog c
         -- F14-R01: transport derived here, not chosen. A NULL equivalent puts
         -- the field on telemetry and it never enters this candidate set.
         JOIN telemetry_config_entry e
           ON e.field_key = c.field_key AND e.scope_id = 'global'
        WHERE c.collected = 1
          AND c.vehicle_data_equivalent IS NOT NULL
          AND c.vehicle_data_equivalent <> ''
          AND e.enabled = 1
          AND c.field_key NOT IN ('SentryMode', 'SpeedLimitMode')
        ORDER BY c.field_key`,
    )
    .all<{ field_key: string; interval_seconds: number }>()
  return rows.results ?? []
}

async function loadState(
  db: D1Database,
  vin: string,
): Promise<{ identity_polled: number; last_poll_at: string | null }> {
  const row = await db
    .prepare('SELECT identity_polled, last_poll_at FROM telemetry_poll_state WHERE vin = ?')
    .bind(vin)
    .first<{ identity_polled: number; last_poll_at: string | null }>()
  // Absent row = never polled. It is created on the first successful poll —
  // a row that only exists after a real poll keeps "we polled" and "we meant
  // to poll" from drifting apart (SDD-012 §4.2).
  return row ?? { identity_polled: 0, last_poll_at: null }
}

/* -------------------------------------------------------------------------- */
/* REST fetch + normalisation                                                 */
/* -------------------------------------------------------------------------- */

interface TeslaResponse {
  response?: unknown
}

/** One Fleet API GET. Never a wake: `TESLA_POLL_PATHS` contains no wake endpoint. */
async function teslaGet(
  accessToken: string,
  vin: string,
  path: typeof TESLA_POLL_PATHS[number],
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS)
  try {
    const res = await fetch(`${FLEET_API}/api/1/vehicles/${encodeURIComponent(vin)}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as TeslaResponse
    if (!body.response || typeof body.response !== 'object') return null
    return body.response as Record<string, unknown>
  } catch {
    // A sleeping vehicle returns stale or empty data — that lands as null here
    // and is recorded as "not reported", never as zero (SDD-012 §7).
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Dig a value out of a nested REST response by the catalog's dotted path
 * ("vehicle_state.odometer", "vehicle_config.car_type").
 */
function readPath(root: Record<string, unknown>, path: string): unknown {
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/**
 * REST values are raw JSON (number, string, boolean) — NOT the protobuf wire
 * shape `classifyValue` consumes. Map them onto the same single-typed-column
 * contract so a polled row and a streamed row are indistinguishable downstream
 * except by `source` (F14-R08/F14-R10). Exactly one column may be populated —
 * the fact table's CHECK demands it.
 */
export function normaliseRestValue(value: unknown): {
  kind: 'real' | 'int' | 'text' | 'bool' | 'json' | 'invalid'
  real: number | null
  int: number | null
  text: string | null
  bool: number | null
  json: string | null
} {
  const none = { real: null, int: null, text: null, bool: null, json: null } as const
  if (value === null || value === undefined) return { kind: 'invalid', ...none }
  if (typeof value === 'boolean') return { kind: 'bool', ...none, bool: value ? 1 : 0 }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { kind: 'int', ...none, int: value }
      : { kind: 'real', ...none, real: value }
  }
  if (typeof value === 'string') return { kind: 'text', ...none, text: value }
  return { kind: 'json', ...none, json: JSON.stringify(value) }
}

/**
 * Persist polled values through the SAME normalisation path as telemetry
 * (F14-R08), with the catalog tier deciding storage (the identity-tier trap in
 * the module doc) and `source` recorded on every fact row (F14-R10).
 */
async function persistPolledValues(
  db: D1Database,
  vin: string,
  values: Array<{ field_key: string; value: unknown; observedAt: string }>,
  receivedAt: string,
): Promise<number> {
  if (!values.length) return 0
  const keys = values.map((v) => v.field_key)
  const tierRows = await db
    .prepare(
      `SELECT field_key, collection_tier FROM tesla_field_catalog
        WHERE field_key IN (${keys.map(() => '?').join(',')})`,
    )
    .bind(...keys)
    .all<{ field_key: string; collection_tier: string }>()
  const tierByKey = new Map((tierRows.results ?? []).map((r) => [r.field_key, r.collection_tier]))

  const datums = values
    .map((v) => {
      const tier = tierByKey.get(v.field_key)
      if (!tier) return null
      const norm = normaliseRestValue(v.value)
      return {
        fieldKey: v.field_key,
        observedAt: v.observedAt,
        valueKind: norm.kind,
        valueReal: norm.real,
        valueInt: norm.int,
        valueText: norm.text,
        valueBool: norm.bool,
        valueJson: norm.json,
        tier: tier as 'event' | 'on_change' | 'once',
      }
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)

  if (!datums.length) return 0
  const result = await persistDatums(db, {
    batchId: `poll_${newId()}`,
    vin,
    datums,
    receivedAt,
    source: 'poll',
  })
  return result.factsWritten + result.snapshotsWritten
}

/* -------------------------------------------------------------------------- */
/* The coordinator                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Run the poll lane for one VIN after its telemetry batch has committed.
 *
 * MUST only be called from inside the ingest handler (F14-R02). Failures are
 * recorded on telemetry_poll_state and never thrown: the batch that rode in on
 * has already been paid for and must not be failed by a REST hiccup.
 */
export async function runPollCoordinator(
  env: Pick<Env, 'D1_TESLA' | 'TESLA_CLIENT_ID' | 'TESLA_CLIENT_SECRET' | 'TOKEN_ENCRYPTION_KEY'>,
  vin: string,
  opts: { nowIso: string; runId: string },
): Promise<PollOutcome> {
  const nowMs = Date.parse(opts.nowIso)
  const outcome: PollOutcome = {
    vin,
    identityPolled: 0,
    pollsRun: 0,
    fieldsPolled: 0,
    lastError: null,
  }

  const writeState = async (identityPolled?: number, lastPollAt?: string, lastIdentityAt?: string, lastError?: string) => {
    const setParts: string[] = ['updated_at = ?']
    const binds: unknown[] = [opts.nowIso]
    if (identityPolled !== undefined) { setParts.push('identity_polled = ?'); binds.push(identityPolled) }
    if (lastPollAt !== undefined) { setParts.push('last_poll_at = ?'); binds.push(lastPollAt) }
    if (lastIdentityAt !== undefined) { setParts.push('last_identity_at = ?'); binds.push(lastIdentityAt) }
    if (lastError !== undefined) { setParts.push('last_error = ?'); binds.push(lastError) }
    binds.push(vin)
    const updated = await env.D1_TESLA.prepare(
      `UPDATE telemetry_poll_state SET ${setParts.join(', ')} WHERE vin = ?`,
    ).bind(...binds).run()
    if (!(updated.meta?.changes ?? 0)) {
      // First touch for this VIN: the INSERT path must carry the same values
      // the UPDATE path would have written — including last_error. An earlier
      // version bound only the four columns, so a failure recorded on the very
      // first attempt landed as null and the diagnostic vanished (caught by the
      // coordinator's own test asserting state.last_error after a no-token run).
      await env.D1_TESLA.prepare(
        `INSERT INTO telemetry_poll_state
           (vin, identity_polled, last_poll_at, last_identity_at, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (vin) DO NOTHING`,
      ).bind(
        vin,
        identityPolled ?? 0,
        lastPollAt ?? null,
        lastIdentityAt ?? null,
        lastError ?? null,
        opts.nowIso,
      ).run()
    }
  }

  // Gate 1 — consent (F14-R07): revocation stops BOTH lanes, and the delete of
  // this state row is what makes that true for polling even before the consent
  // row would refuse the ingest. Belt and braces: the consent check runs here too.
  if (!(await memberMayBeCollected(env.D1_TESLA, vin))) return outcome

  const candidates = await loadCandidates(env.D1_TESLA, vin)
  if (!candidates.length) return outcome

  const state = await loadState(env.D1_TESLA, vin)
  const plan = planPoll({ candidates, identityDone: state.identity_polled === 1, lastPollAt: state.last_poll_at, nowMs })
  if (!plan.identityFields.length && !plan.dueFields.length) return outcome

  // Gate 2 — a member token exists (refresh machinery, F02/F14-R08).
  const memberRow = await env.D1_TESLA.prepare(
    'SELECT member_id FROM tesla_vehicle WHERE vin = ?',
  ).bind(vin).first<{ member_id: string }>()
  if (!memberRow?.member_id) return outcome

  const accessToken = await getMemberAccessToken(env as Env, memberRow.member_id)
  if (!accessToken) {
    outcome.lastError = 'poll_no_access_token'
    await writeState(undefined, undefined, undefined, outcome.lastError)
    return outcome
  }

  // --- identity build (F14-R03): exactly once -----------------------------
  if (plan.identityFields.length) {
    const identityCfg = await env.D1_TESLA.prepare(
      `SELECT field_key, vehicle_data_equivalent FROM tesla_field_catalog
        WHERE field_key IN (${plan.identityFields.map(() => '?').join(',')})
          AND vehicle_data_equivalent IS NOT NULL AND vehicle_data_equivalent <> ''`,
    ).bind(...plan.identityFields).all<{ field_key: string; vehicle_data_equivalent: string }>()

    const identityCfgRows = identityCfg.results ?? []
    if (identityCfgRows.length) {
      const vehicleConfig = await teslaGet(accessToken, vin, '/vehicle_config')
      const vehicleState = await teslaGet(accessToken, vin, '/vehicle_data')
      const values: Array<{ field_key: string; value: unknown; observedAt: string }> = []
      for (const row of identityCfgRows) {
        // vehicle_config.* reads from vehicle_config; vehicle_state.* reads from
        // a vehicle_data response (Version lives at vehicle_state.car_version).
        const source = row.vehicle_data_equivalent.startsWith('vehicle_config.')
          ? vehicleConfig
          : vehicleState
        if (!source) continue
        const raw = readPath(source, row.vehicle_data_equivalent)
        if (raw === undefined || raw === null) continue
        values.push({ field_key: row.field_key, value: raw, observedAt: opts.nowIso })
      }
      if (values.length) {
        await persistPolledValues(env.D1_TESLA, vin, values, opts.nowIso)
        await recordSignals(env.D1_TESLA, { vin, datumCount: values.length, nowIso: opts.nowIso })
        outcome.fieldsPolled += values.length
        outcome.identityPolled = 1
        await writeState(1, undefined, opts.nowIso, undefined)
      }
      // No values (asleep / empty): identity_polled stays 0, so the next batch
      // retries. "First sync builds the profile" — not "first attempt gives up".
    }
  }

  // --- cadence due fields (F14-R04 for Odometer) --------------------------
  if (plan.dueFields.length) {
    const dueCfg = await env.D1_TESLA.prepare(
      `SELECT field_key, vehicle_data_equivalent FROM tesla_field_catalog
        WHERE field_key IN (${plan.dueFields.map(() => '?').join(',')})`,
    ).bind(...plan.dueFields).all<{ field_key: string; vehicle_data_equivalent: string }>()

    const byPath = new Map<string, string[]>()
    for (const row of dueCfg.results ?? []) {
      const list = byPath.get(row.vehicle_data_equivalent) ?? []
      list.push(row.field_key)
      byPath.set(row.vehicle_data_equivalent, list)
    }

    const values: Array<{ field_key: string; value: unknown; observedAt: string }> = []
    let fetched: Record<string, unknown> | null = null
    for (const [path, fieldKeys] of byPath) {
      // vehicle_data is a single call carrying every vehicle_state.* field —
      // fetch once per response type, not once per field (F14-N01: cadence cost).
      const target = path.startsWith('vehicle_state.') ? '/vehicle_data' : '/vehicle_config'
      const source = target === '/vehicle_data'
        ? (fetched ??= await teslaGet(accessToken, vin, '/vehicle_data'))
        : await teslaGet(accessToken, vin, '/vehicle_config')
      if (!source) continue
      const raw = readPath(source, path)
      if (raw === undefined || raw === null) continue
      for (const field_key of fieldKeys) {
        values.push({ field_key, value: raw, observedAt: opts.nowIso })
      }
    }

    if (values.length) {
      const written = await persistPolledValues(env.D1_TESLA, vin, values, opts.nowIso)
      await recordSignals(env.D1_TESLA, { vin, datumCount: values.length, nowIso: opts.nowIso })
      outcome.fieldsPolled += values.length
      outcome.pollsRun += 1
      // Stamp only on a real write: an empty response means the vehicle did not
      // report, and stamping would silently skip the whole cadence window (AC4:
      // a poll that lands nothing reads "overdue", never "skipped").
      await writeState(undefined, opts.nowIso, undefined, undefined)
      void written
    } else {
      outcome.lastError = 'poll_empty_response'
      await writeState(undefined, undefined, undefined, outcome.lastError)
    }
  }

  // Meter the REST traffic (F14-R09): each poll counts as a data request so
  // /healthz's billing guard can project the cost before it happens (AC8).
  const requests = (outcome.identityPolled ? 1 : 0) + (outcome.pollsRun || outcome.fieldsPolled ? 1 : 0)
  if (requests > 0) {
    await env.D1_TESLA.prepare(
      `INSERT INTO tesla_signal_counter (counter_id, vin, period_start, signals, data_requests, wakes, updated_at)
       VALUES (?, ?, ?, 0, ?, 0, ?)
       ON CONFLICT (vin, period_start) DO UPDATE SET
         data_requests = data_requests + excluded.data_requests,
         updated_at = excluded.updated_at`,
    ).bind(newId(), vin, opts.nowIso.slice(0, 10), requests, opts.nowIso).run()
  }

  return outcome
}

/** F14-R07: revocation deletes poll eligibility for every VIN of a member. */
export async function clearPollEligibility(
  db: D1Database,
  vins: string[],
): Promise<number> {
  if (!vins.length) return 0
  const result = await db
    .prepare(
      `DELETE FROM telemetry_poll_state WHERE vin IN (${vins.map(() => '?').join(',')})`,
    )
    .bind(...vins)
    .run()
  return result.meta.changes ?? 0
}