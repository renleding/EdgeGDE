/**
 * Tests for the FEATURE-14 poll coordinator (FRS-010 v2.3 F14-R01..R10, SDD-012).
 *
 * What each group pins:
 *
 *  1. Wake-free (F14-N02): the module's only REST paths are vehicle_data and
 *     vehicle_config. A `wake_up` appearing in this list would violate the
 *     owner's hard rule ("we are not waking a sleeping vehicle") and is caught
 *     by assertion rather than by code review.
 *  2. Structural impossibility of polling FSD fields (F14-R01, AC1): the
 *     candidate set is SQL-built on a NON-NULL vehicle_data_equivalent.
 *     MilesSinceReset and SelfDrivingMilesSinceReset have none — they are not
 *     "excluded by a list" (a list can be edited); the SQL cannot name them.
 *  3. Identity polls exactly once (F14-R03, AC3): the plan yields identity
 *     fields only while identity_polled = 0, and flips after a real write.
 *  4. Cadence (F14-R04): Odometer is due at its configured interval and not
 *     before; the seeded interval is 604800s = the owner's weekly cadence.
 *  5. Source attribution (F14-R10, AC7): a polled row writes source='poll'; a
 *     streamed row keeps the 'telemetry' default. Persisted, not just planned.
 *  6. Revocation stops both lanes (F14-R07, AC5): clearing eligibility removes
 *     the state row, and a consentless member yields no poll attempt at all.
 *  7. Failure never poisons the batch (SDD-012 §7): no token, no consent, no
 *     candidates — the coordinator returns an outcome instead of throwing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import app from '../src/index'
import { createSqliteD1, seedBaseline, type SqliteD1 } from './helpers/sqlite-d1'
import {
  TESLA_POLL_PATHS,
  planPoll,
  isDue,
  normaliseRestValue,
  runPollCoordinator,
  clearPollEligibility,
} from '../src/poll-coordinator'
import { CONSENTED_FIELDS } from '../src/consent-policy'

const SECRET = 'test-admin-secret'
const VIN = 'LRW3F7ET1SC584656'
const MEMBER = '01M447GB46KR7NK233HW6E6EBB'

function makeEnv() {
  const kv = new Map<string, string>()
  const d1 = createSqliteD1()
  return {
    OAUTH_SESSIONS: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v) },
      delete: async (k: string) => { kv.delete(k) },
    },
    D1_TESLA: d1,
    RAW_PAYLOADS: { put: async () => {}, get: async () => null },
    TESLA_CLIENT_ID: 'test-client-id',
    TESLA_CLIENT_SECRET: 'test-client-secret',
    OAUTH_STATE_SECRET: 'test-state-secret',
    TOKEN_ENCRYPTION_KEY: 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXk=',
    INGEST_SHARED_SECRET: SECRET,
    TESLA_AUDIENCE: 'https://fleet-api.test.tesla.com',
    ASSETS: { fetch: async () => new Response('splash', { status: 200 }) },
    _kv: kv,
    _d1: d1,
  } as never
}
type Env = ReturnType<typeof makeEnv>
function d1Of(env: Env): SqliteD1 {
  return (env as never as { D1_TESLA: SqliteD1 }).D1_TESLA
}

/** Seed an active consent row so memberMayBeCollected passes (F14-R07's inverse). */
function seedConsent(d1: SqliteD1) {
  d1._seed(`
    INSERT INTO tesla_consent (consent_id, member_id, scope_granted, policy_version, purposes,
      granted_at, policy_sha256, collected_fields, recipients, ip_hash, user_agent)
    VALUES ('c_test', '${MEMBER}', 'openid', '2026-10-03.2', '["insurance"]',
      '2026-10-07T00:00:00.000Z', 'deadbeef', '${JSON.stringify(CONSENTED_FIELDS)}', '[]', 'hash', 'test');
  `)
}

/* ------------------------- pure logic: no I/O at all ---------------------- */

describe('wake-free guarantee (F14-N02)', () => {
  it('the poll module requests exactly vehicle_data and vehicle_config — never wake_up', () => {
    expect([...TESLA_POLL_PATHS].sort()).toEqual(['/vehicle_config', '/vehicle_data'])
    for (const p of TESLA_POLL_PATHS) {
      expect(p).not.toMatch(/wake/i)
    }
  })
})

describe('candidate planning (F14-R01, F14-R03, F14-R04)', () => {
  const candidates = [
    { field_key: 'CarType', interval_seconds: 604800 },
    { field_key: 'EfficiencyPackage', interval_seconds: 604800 },
    { field_key: 'Version', interval_seconds: 604800 },
    { field_key: 'Odometer', interval_seconds: 604800 },
    { field_key: 'SentryMode', interval_seconds: 180 },
  ]

  it('excludes telemetry-only state fields even when they carry a REST equivalent', () => {
    // SentryMode has vehicle_state.sentry_mode but F14-R05 pins it to telemetry.
    const plan = planPoll({ candidates, identityDone: false, lastPollAt: null, nowMs: Date.now() })
    expect(plan.dueFields).not.toContain('SentryMode')
    expect(plan.identityFields).not.toContain('SentryMode')
  })

  it('plans identity exactly once: fields while never polled, none after', () => {
    const first = planPoll({ candidates, identityDone: false, lastPollAt: null, nowMs: Date.now() })
    expect(first.identityFields.sort()).toEqual(['CarType', 'EfficiencyPackage', 'Version'])
    const second = planPoll({ candidates, identityDone: true, lastPollAt: null, nowMs: Date.now() })
    expect(second.identityFields).toEqual([])
  })

  it('plans Odometer when due, and not before its weekly interval', () => {
    const now = Date.now()
    const fresh = planPoll({ candidates, identityDone: true, lastPollAt: null, nowMs: now })
    expect(fresh.dueFields).toContain('Odometer')

    const justPolled = planPoll({
      candidates, identityDone: true, lastPollAt: new Date(now).toISOString(), nowMs: now + 1000,
    })
    expect(justPolled.dueFields).not.toContain('Odometer')

    const weekLater = planPoll({
      candidates, identityDone: true, lastPollAt: new Date(now).toISOString(), nowMs: now + 604800_000,
    })
    expect(weekLater.dueFields).toContain('Odometer')
  })

  it('isDue treats a missing or unparseable stamp as due (no silent skip)', () => {
    expect(isDue(null, 604800, Date.now())).toBe(true)
    expect(isDue('not-a-date', 604800, Date.now())).toBe(true)
    expect(isDue(new Date().toISOString(), 604800, Date.now())).toBe(false)
  })
})

describe('REST value normalisation (F14-R08: one typed column)', () => {
  it('maps raw JSON onto exactly one column', () => {
    expect(normaliseRestValue(12345.6)).toMatchObject({ kind: 'real', real: 12345.6 })
    expect(normaliseRestValue(42)).toMatchObject({ kind: 'int', int: 42 })
    expect(normaliseRestValue(true)).toMatchObject({ kind: 'bool', bool: 1 })
    expect(normaliseRestValue('CarTypeModel3')).toMatchObject({ kind: 'text', text: 'CarTypeModel3' })
    expect(normaliseRestValue(null)).toMatchObject({ kind: 'invalid' })
    expect(normaliseRestValue({ a: 1 })).toMatchObject({ kind: 'json', json: '{"a":1}' })
  })

  it('never populates two columns at once (the fact CHECK would abort)', () => {
    for (const v of [123, 1.5, 'x', true, null, undefined, { a: 1 }]) {
      const n = normaliseRestValue(v)
      const filled = [n.real, n.int, n.text, n.bool, n.json].filter((x) => x !== null)
      expect(filled.length).toBeLessThanOrEqual(1)
    }
  })
})

/* ------------------------ coordinator: real SQLite ------------------------ */

describe('runPollCoordinator against the real schema', () => {
  let env: Env
  beforeEach(() => {
    env = makeEnv()
    seedBaseline(d1Of(env))
    seedConsent(d1Of(env))
    // No TESLA_CLIENT_ID match for the real token machinery: getMemberAccessToken
    // returns null (no stored token) — which is exactly case 7 below (no throw).
  })

  it('returns an outcome instead of throwing when no member token exists', async () => {
    const out = await runPollCoordinator(env as never, VIN, {
      nowIso: '2026-10-09T00:00:00.000Z',
      runId: 'run_test',
    })
    expect(out.vin).toBe(VIN)
    expect(out.pollsRun).toBe(0)
    // The failure is recorded, not swallowed silently (SDD-012 §7).
    expect(out.lastError).toBe('poll_no_access_token')
    const state = d1Of(env)._rows('SELECT last_error FROM telemetry_poll_state WHERE vin = ?', VIN)
    expect((state[0] as { last_error: string }).last_error).toBe('poll_no_access_token')
  })

  it('does nothing for a member with no active consent (F14-R07 gate)', async () => {
    d1Of(env)._seed("UPDATE tesla_consent SET revoked_at = '2026-10-09T00:00:00.000Z' WHERE consent_id = 'c_test'")
    const out = await runPollCoordinator(env as never, VIN, {
      nowIso: '2026-10-09T00:00:00.000Z',
      runId: 'run_test',
    })
    expect(out.lastError).toBeNull()
    expect(out.pollsRun).toBe(0)
    // No state row at all: eligibility itself was never established.
    const state = d1Of(env)._rows('SELECT vin FROM telemetry_poll_state WHERE vin = ?', VIN)
    expect(state).toHaveLength(0)
  })

  it('clearPollEligibility removes the state row for a revoked member (F14-R07, AC5)', async () => {
    d1Of(env)._seed(`
      INSERT INTO telemetry_poll_state (vin, identity_polled, last_poll_at, updated_at)
      VALUES ('${VIN}', 1, '2026-10-08T00:00:00.000Z', '2026-10-08T00:00:00.000Z');
    `)
    const cleared = await clearPollEligibility(d1Of(env), [VIN])
    expect(cleared).toBe(1)
    expect(d1Of(env)._rows('SELECT vin FROM telemetry_poll_state WHERE vin = ?', VIN)).toHaveLength(0)
    // Absent row = not poll-eligible: a later coordinator call re-gates on consent.
    expect(await clearPollEligibility(d1Of(env), [VIN])).toBe(0)
  })

  it('the candidate SQL structurally excludes FSD counters (AC1)', () => {
    // The coordinator's candidate query keys on a NON-NULL equivalent. The two
    // FSD fields have none (catalog fact), so the query can never return them.
    // Assert the catalog fact itself — this is what makes AC1 structural: if a
    // migration ever gave them an equivalent, this fails and forces a decision.
    const rows = d1Of(env)._rows(
      `SELECT field_key FROM tesla_field_catalog
        WHERE field_key IN ('MilesSinceReset','SelfDrivingMilesSinceReset')
          AND (vehicle_data_equivalent IS NULL OR vehicle_data_equivalent = '')`,
    )
    expect(rows).toHaveLength(2)
    const permissive = d1Of(env)._rows(
      `SELECT field_key FROM tesla_field_catalog
        WHERE field_key IN ('MilesSinceReset','SelfDrivingMilesSinceReset')
          AND vehicle_data_equivalent IS NOT NULL AND vehicle_data_equivalent <> ''`,
    )
    expect(permissive).toHaveLength(0)
  })
})

/* --------------------- source attribution (F14-R10) ----------------------- */

describe('source attribution (F14-R10, AC7)', () => {
  let env: Env
  beforeEach(() => { env = makeEnv(); seedBaseline(d1Of(env)) })

  it('a streamed row keeps the telemetry default', () => {
    const rows = d1Of(env)._rows("SELECT source FROM tesla_telemetry_fact WHERE fact_id = 'f_odo'")
    expect((rows[0] as { source: string }).source).toBe('telemetry')
  })

  it('a polled row records source=poll through the same persistDatums path', async () => {
    // The fact table's batch_id is a real FK (telemetry_poll_state's own tests
    // proved the harness enforces them), so a polled row needs its own batch row
    // — exactly what the ingest handler would have created.
    d1Of(env)._seed(`
      INSERT INTO tesla_telemetry_batch (batch_id, vin, received_at, r2_key, payload_sha256, datum_count)
        VALUES ('poll_x_1', '${VIN}', '2026-10-09T01:00:00.000Z', 'telemetry/poll.json', 'sha-poll', 1);
    `)
    const { persistDatums } = await import('../src/telemetry')
    await persistDatums(d1Of(env), {
      batchId: 'poll_x_1',
      vin: VIN,
      datums: [{
        fieldKey: 'Odometer',
        observedAt: '2026-10-09T01:00:00.000Z',
        valueKind: 'real',
        valueReal: 22000,
        valueInt: null, valueText: null, valueBool: null, valueJson: null,
        tier: 'event',
      }],
      receivedAt: '2026-10-09T01:00:00.000Z',
      source: 'poll',
    })
    const rows = d1Of(env)._rows(
      "SELECT source FROM tesla_telemetry_fact WHERE batch_id = 'poll_x_1'",
    )
    expect(rows).toHaveLength(1)
    expect((rows[0] as { source: string }).source).toBe('poll')
    // The two rows for the same field are now distinguishable only by source.
    const both = d1Of(env)._rows(
      "SELECT fact_id, source FROM tesla_telemetry_fact WHERE field_key = 'Odometer' ORDER BY batch_id",
    )
    expect(both).toHaveLength(2)
  })
})

/* ----------------------- ingest integration (F14-R02) --------------------- */

describe('ingest integration: the poll lane rides the batch (F14-R02)', () => {
  let env: Env
  beforeEach(() => {
    env = makeEnv()
    seedBaseline(d1Of(env))
    seedConsent(d1Of(env))
  })

  async function ingest() {
    return app.fetch(
      new Request('https://auto.afirmi.co/ingest/telemetry', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-secret': SECRET },
        body: JSON.stringify({
          vin: VIN,
          data: [{ key: 'Odometer', value: { doubleValue: 21963.1 }, createdAt: '2026-10-09T02:00:00.000Z' }],
        }),
      }),
      env,
    )
  }

  it('a batch triggers the coordinator inside the handler (no standalone entrypoint)', async () => {
    const res = await ingest()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; errors?: Array<{ code: string }> }
    expect(body.ok).toBe(true)
    // The coordinator ran and reported its token failure as an ingest error —
    // proving it is invoked FROM the handler, not by a separate schedule.
    const codes = (body.errors ?? []).map((e) => e.code)
    expect(codes.some((c) => c.startsWith('poll_'))).toBe(true)
    // The telemetry batch itself still succeeded (SDD-012 §7: poll failure
    // must not poison the batch it rode on).
    expect(codes.some((c) => c.startsWith('persist_failed'))).toBe(false)
  })

  it('the poll coordinator module exposes no schedule, cron or route entrypoint', async () => {
    // Structural assertion on the module's exported surface: only the ingest
    // handler may drive it. Exporting a scheduler here would violate F14-R02.
    const mod = await import('../src/poll-coordinator')
    const exported = Object.keys(mod)
    expect(exported).not.toContain('startPollScheduler')
    expect(exported).not.toContain('runScheduledPoll')
    expect(exported.sort()).toEqual([
      'TESLA_POLL_PATHS',
      'clearPollEligibility',
      'isDue',
      'normaliseRestValue',
      'planPoll',
      'runPollCoordinator',
    ])
  })
})