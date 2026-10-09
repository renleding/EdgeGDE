/**
 * Tests for catalog enrolment (F12-R18) and its AC6 gate shape.
 *
 * Why this file exists. Enrolment is the one operation in FEATURE-12 that
 * WIDENS the collected set — every other control may only narrow it (F12-R04).
 * Three properties make it dangerous if unguarded, and each is asserted here:
 *
 *  1. Transactional + audited (SDD-011 §12.4, invariant 11): the catalog flip,
 *     the global-scope seed and the audit row land together or not at all. A
 *     field marked collected with no global entry is exactly the state F12-R02
 *     calls a configuration error.
 *  2. Gate-shaped consent check: the consent row records the set at grant time,
 *     which is a SUBSET of the current set once enrolment happens. The old
 *     equality check (R-10's original form) would report every post-enrolment
 *     state as drift. /healthz must instead fail only when a DECLARED field
 *     disappears from the catalog — stale declaration — and must tolerate
 *     extras as enrolled fields (F01 AC6 as amended by F12-R18).
 *  3. Catalog hygiene: broken and deprecated fields are refused (409). Tesla
 *     cannot send them, so enrolling one lands a field that never produces data
 *     while counting against the consented set.
 *
 * All of it runs against REAL SQLite with the real migrations
 * (test/helpers/sqlite-d1.ts) — the mock that accepts any SQL is what let a
 * production 500 ship with 295 tests green.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import app from '../src/index'
import { createSqliteD1, seedBaseline, type SqliteD1 } from './helpers/sqlite-d1'
import { CONSENTED_FIELDS } from '../src/consent-policy'

const SECRET = 'test-admin-secret'

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
    // Without this, /healthz is degraded for an unrelated reason (F02-R13's
    // unconfigured limit) and the status assertions below would test billing
    // configuration rather than the AC6 gate.
    TESLA_BILLING_LIMIT_USD: '5',
    ASSETS: { fetch: async () => new Response('splash', { status: 200 }) },
    _kv: kv,
    _d1: d1,
  } as never
}

type Env = ReturnType<typeof makeEnv>
function d1Of(env: Env): SqliteD1 {
  return (env as never as { D1_TESLA: SqliteD1 }).D1_TESLA
}

/** An enrollable field: uncollected, not broken, not deprecated. */
const ENROL_FIELD = 'ACChargingPower'
/** A field the catalog itself refuses: deprecated. */
const BAD_FIELD = 'Deprecated_1'

async function enroll(env: Env, field_key: string) {
  return app.fetch(
    new Request('https://auto.afirmi.co/admin/telemetry/enrol', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-admin-secret': SECRET },
      body: `field_key=${encodeURIComponent(field_key)}`,
    }),
    env,
  )
}

describe('catalog enrolment (F12-R18)', () => {
  let env: Env
  beforeEach(() => { env = makeEnv() })

  it('is closed without a session (the global admin guard applies)', async () => {
    const res = await app.fetch(
      new Request('https://auto.afirmi.co/admin/telemetry/enrol', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'field_key=ACChargingPower',
      }),
      env,
    )
    expect(res.status).toBe(401)
  })

  it('enrolls a usable catalog field: flips the catalog, seeds the global scope, writes the audit row', async () => {
    const d1 = d1Of(env)
    const before = d1._rows('SELECT collected FROM tesla_field_catalog WHERE field_key = ?', ENROL_FIELD)
    expect((before[0] as { collected: number }).collected).toBe(0)

    const res = await enroll(env, ENROL_FIELD)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/admin/telemetry/configurator?scope=global')

    const catalog = d1._rows(
      'SELECT collected, collection_tier FROM tesla_field_catalog WHERE field_key = ?',
      ENROL_FIELD,
    ) as Array<{ collected: number; collection_tier: string }>
    expect(catalog[0].collected).toBe(1)
    // 'never' would violate the catalog CHECK (collected=1 ⇒ tier ≠ never).
    expect(catalog[0].collection_tier).not.toBe('never')

    // F12-R02 totality: the moment the field joins the set, a global entry
    // exists — no unresolved-field configuration error.
    const entry = d1._rows(
      "SELECT interval_seconds, enabled FROM telemetry_config_entry WHERE scope_id = 'global' AND field_key = ?",
      ENROL_FIELD,
    ) as Array<{ interval_seconds: number; enabled: number }>
    expect(entry).toHaveLength(1)
    expect(entry[0].enabled).toBe(1)

    const audit = d1._rows(
      "SELECT actor, action FROM tesla_audit_event WHERE action = 'telemetry_field_enrolled' AND subject_id = ?",
      ENROL_FIELD,
    ) as Array<{ actor: string; action: string }>
    expect(audit).toHaveLength(1)
    expect(audit[0].actor).toBe('admin')
  })

  it('is idempotent: re-enrolling an already-collected field changes nothing and returns ok', async () => {
    const d1 = d1Of(env)
    const res = await enroll(env, 'Odometer') // already collected
    expect(res.status).toBe(200)
    const audit = d1._rows(
      "SELECT event_id FROM tesla_audit_event WHERE action = 'telemetry_field_enrolled' AND subject_id = 'Odometer'",
    )
    expect(audit).toHaveLength(0)
    const entry = d1._rows(
      "SELECT interval_seconds FROM telemetry_config_entry WHERE scope_id = 'global' AND field_key = 'Odometer'",
    )
    expect(entry).toHaveLength(1)
  })

  it('refuses a deprecated field (409) and leaves the catalog untouched', async () => {
    const d1 = d1Of(env)
    const res = await enroll(env, BAD_FIELD)
    expect(res.status).toBe(409)
    const catalog = d1._rows(
      'SELECT collected FROM tesla_field_catalog WHERE field_key = ?',
      BAD_FIELD,
    ) as Array<{ collected: number }>
    expect(catalog[0].collected).toBe(0)
    const entry = d1._rows(
      "SELECT field_key FROM telemetry_config_entry WHERE scope_id = 'global' AND field_key = ?",
      BAD_FIELD,
    )
    expect(entry).toHaveLength(0)
  })

  it('refuses a field that is not in the catalog (404)', async () => {
    const res = await enroll(env, 'NotARealField')
    expect(res.status).toBe(404)
  })

  it('refuses an empty field_key (400)', async () => {
    const res = await enroll(env, '')
    expect(res.status).toBe(400)
  })
})

describe('/healthz AC6 gate under enrolment (F01 AC6 as amended by F12-R18)', () => {
  let env: Env
  beforeEach(() => { env = makeEnv() })

  it('reports consent_field_set ok while the catalog matches the declaration', async () => {
    const res = await app.fetch(new Request('https://auto.afirmi.co/healthz'), env)
    const body = (await res.json()) as { checks?: Record<string, string>; status?: string }
    // Migration 0013 (Trim) makes catalog == declared == 15 with no enrolment yet.
    expect(body.checks?.consent_field_set).toBe('ok')
    expect(body.status).toBe('ok')
  })

  it('tolerates enrolled fields as extras instead of reporting drift', async () => {
    seedBaseline(d1Of(env))
    const enrolled = await enroll(env, ENROL_FIELD)
    expect(enrolled.status).toBe(303)

    const res = await app.fetch(new Request('https://auto.afirmi.co/healthz'), env)
    const body = (await res.json()) as { checks?: Record<string, string>; problems?: string[]; status?: string }
    expect(body.checks?.consent_field_set).toBe('ok+enrolled:1')
    expect(body.status).toBe('ok')
    expect(JSON.stringify(body.problems ?? [])).not.toContain('F01 AC6')
  })

  it('still fails when a DECLARED field vanishes from the catalog (stale declaration)', async () => {
    // The invariant the gate exists for (R-10): every CONSENTED_FIELD must
    // remain collected. Simulate a catalog row losing collected=1 behind our back.
    const d1 = d1Of(env)
    d1._seed("UPDATE tesla_field_catalog SET collected = 0, collection_tier = 'never' WHERE field_key = 'Trim'")

    const res = await app.fetch(new Request('https://auto.afirmi.co/healthz'), env)
    const body = (await res.json()) as { checks?: Record<string, string>; problems?: string[]; status?: string }
    expect(body.checks?.consent_field_set).toBe('STALE_DECLARED missing=Trim')
    expect(body.status).toBe('degraded')
    expect(JSON.stringify(body.problems)).toContain('F01 AC6')
  })

  it('the declared set is the consent set the member was shown', async () => {
    // Guards the subset rule's premise: a consent row records CONSENTED_FIELDS
    // at grant time, so a DECLARED field can never be outside what consent covers.
    expect([...CONSENTED_FIELDS]).toContain('Odometer')
    expect(CONSENTED_FIELDS.length).toBe(15)
  })
})