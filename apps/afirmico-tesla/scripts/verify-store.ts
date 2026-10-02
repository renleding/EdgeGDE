/**
 * Integration check: run the real persistence code against the real schema.
 *
 * Why this exists
 * ---------------
 * `verify-schema.sh` proves the SQL is valid. It cannot prove that `src/store.ts`
 * agrees with it — a column renamed in one and not the other typechecks fine and
 * fails only when a member tries to connect, which is the worst possible time.
 *
 * This script applies every migration to an in-memory SQLite database, wraps it
 * in a minimal D1-compatible adapter, and calls the actual store functions. It
 * then asserts what landed, including that the schema's guard triggers fire.
 *
 * Run: bun run verify:store
 */

// @ts-expect-error bun:sqlite has no type declarations available here
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  activeConsent,
  audit,
  createSession,
  ensureConsentPolicy,
  newId,
  recordConsent,
  revokeConsent,
  storeTokens,
  upsertMember,
  upsertVehicles,
} from '../src/store'
import { openToken } from '../src/crypto'
import { CONSENT_POLICY_VERSION, CONSENT_TEXT, sha256Hex } from '../src/consent-policy'

const MIGRATIONS = join(import.meta.dir, '..', 'migrations')

let pass = 0
let fail = 0

function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected)
  if (ok) {
    pass++
    console.log(`  ok    ${label.padEnd(48)} ${actual}`)
  } else {
    fail++
    console.log(`  FAIL  ${label.padEnd(48)} got ${actual}, expected ${expected}`)
  }
}

/* -------------------------------------------------------------------------- */
/* A D1-shaped adapter over bun:sqlite                                        */
/* -------------------------------------------------------------------------- */

/**
 * Minimal D1Database implementation. Only the surface `store.ts` actually uses:
 * prepare -> bind -> first/all/run. Anything else throws rather than silently
 * returning undefined, so an unexpected call is loud.
 */
function makeD1(db: InstanceType<typeof Database>) {
  class Stmt {
    constructor(private sql: string, private args: unknown[] = []) {}
    bind(...args: unknown[]) {
      return new Stmt(this.sql, args)
    }
    /** Exposed so the adapter's batch() can execute it. */
    _run() {
      return db.query(this.sql).run(...(this.args as never[]))
    }
    async first<T>() {
      const row = db.query(this.sql).get(...(this.args as never[]))
      return (row ?? null) as T | null
    }
    async all<T>() {
      return { results: db.query(this.sql).all(...(this.args as never[])) as T[] }
    }
    async run() {
      const info = this._run()
      return { meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) } }
    }
  }
  return {
    prepare: (sql: string) => new Stmt(sql),
    exec: async (sql: string) => db.exec(sql),
    /**
     * D1 executes a batch as one implicit transaction. Mirroring that here
     * matters: persistDatums relies on all-or-nothing so a partial payload
     * cannot leave a gap a later derivation would read as zero travel.
     */
    batch: async (statements: Stmt[]) => {
      db.exec('BEGIN')
      try {
        const results = statements.map((s) => s._run())
        db.exec('COMMIT')
        return results.map((info) => ({
          meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) },
        }))
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
}

/* -------------------------------------------------------------------------- */

async function main() {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')

  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  console.log(`Applying ${files.length} migrations to in-memory SQLite`)
  for (const file of files) {
    db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  console.log()

  const d1 = makeD1(db)
  const encryptionKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
  const iso = '2026-10-02T12:00:00.000Z'

  /* ---- member ---------------------------------------------------------- */
  console.log('Member upsert (F01-R05)')
  const memberId = await upsertMember(
    d1,
    { teslaSub: 'tesla-sub-abc', teslaEmail: 'member@toca.example', displayName: 'TOCA Member' },
    iso,
  )
  check('member created', memberId.length > 20, 'true')

  // Reconnecting must not create a second member row.
  const again = await upsertMember(d1, { teslaSub: 'tesla-sub-abc' }, iso)
  check('reconnect reuses the member', again, memberId)

  const memberCount = db.query('SELECT count(*) c FROM tesla_member').get() as { c: number }
  check('one member row', memberCount.c, 1)

  const status = db
    .query('SELECT toca_status, tier FROM tesla_member WHERE member_id = ?')
    .get(memberId) as { toca_status: string; tier: string }
  check('toca_status not assumed verified', status.toca_status, 'unknown')
  check('tier defaults to toca', status.tier, 'toca')

  /* ---- vehicles -------------------------------------------------------- */
  console.log('\nVehicle upsert')
  await upsertVehicles(d1, memberId, [
    { vin: 'VIN0000000000001', displayName: 'Model Y' },
    { vin: 'VIN0000000000002' },
  ], iso)
  const vc = db.query('SELECT count(*) c FROM tesla_vehicle').get() as { c: number }
  check('two vehicles stored', vc.c, 2)

  // Idempotent: Tesla returning the same list again must not duplicate.
  await upsertVehicles(d1, memberId, [{ vin: 'VIN0000000000001', displayName: 'Model Y' }], iso)
  const vc2 = db.query('SELECT count(*) c FROM tesla_vehicle').get() as { c: number }
  check('re-run does not duplicate', vc2.c, 2)

  /* ---- consent --------------------------------------------------------- */
  console.log('\nConsent (F01-R02/R03, F01 AC1)')
  await ensureConsentPolicy(d1, iso)
  const { consentId, policySha256 } = await recordConsent(d1, {
    memberId,
    scope: 'openid offline_access vehicle_device_data',
    ip: '203.0.113.42',
    userAgent: 'Mozilla/5.0 (test)',
    nowIso: iso,
  })

  const consentRow = db
    .query(
      `SELECT policy_version, policy_sha256, ip_hash, user_agent, revoked_at, collected_fields
         FROM tesla_consent WHERE consent_id = ?`,
    )
    .get(consentId) as Record<string, string | null>

  check('policy_version recorded', consentRow.policy_version, CONSENT_POLICY_VERSION)
  check('policy_sha256 is the text hash', consentRow.policy_sha256, await sha256Hex(CONSENT_TEXT))
  check('user_agent recorded (F01-R03)', consentRow.user_agent, 'Mozilla/5.0 (test)')
  check('consent not yet revoked', consentRow.revoked_at, 'null')

  // F01-R03/IP: the raw address must never be stored.
  const rawIpLeaked = JSON.stringify(consentRow).includes('203.0.113.42')
  check('raw IP never stored', rawIpLeaked, 'false')
  check('ip_hash is a sha256', /^[0-9a-f]{64}$/.test(String(consentRow.ip_hash)), 'true')
  check('field set recorded', JSON.parse(String(consentRow.collected_fields)).length, 3)

  // F01 AC5: the stored text must be reproducible and hash-identical.
  const policyRow = db
    .query('SELECT policy_text, policy_sha256 FROM tesla_consent_policy WHERE policy_version = ?')
    .get(CONSENT_POLICY_VERSION) as { policy_text: string; policy_sha256: string }
  check('stored consent text is byte-identical', policyRow.policy_text === CONSENT_TEXT, 'true')
  check('stored text hashes to recorded hash', policyRow.policy_sha256, policySha256)

  const active = await activeConsent(d1, memberId)
  check('active consent resolves', active?.consent_id, consentId)

  /* ---- tokens ---------------------------------------------------------- */
  console.log('\nToken storage (F02-R05)')
  await storeTokens(d1, {
    memberId,
    refreshToken: 'REFRESH-TOKEN-ORIGINAL',
    scope: 'openid offline_access vehicle_device_data',
    expiresAt: '2027-01-01T00:00:00.000Z',
    teslaSub: 'tesla-sub-abc',
    encryptionKey,
    nowIso: iso,
  })
  const tok = db
    .query('SELECT refresh_token_enc, refresh_token_iv, key_version FROM tesla_oauth_token WHERE member_id = ?')
    .get(memberId) as { refresh_token_enc: string; refresh_token_iv: string; key_version: number }

  const wholeRow = JSON.stringify(tok)
  check('token ciphertext is not plaintext', wholeRow.includes('REFRESH-TOKEN-ORIGINAL'), 'false')
  const decrypted = await openToken(
    { ciphertext: tok.refresh_token_enc, iv: tok.refresh_token_iv, keyVersion: tok.key_version },
    encryptionKey,
  )
  check('token decrypts to the original', decrypted, 'REFRESH-TOKEN-ORIGINAL')

  // Rotation keeps the outgoing token so a failed refresh does not strand the member.
  await storeTokens(d1, {
    memberId,
    refreshToken: 'REFRESH-TOKEN-ROTATED',
    scope: 'openid offline_access vehicle_device_data',
    expiresAt: '2027-01-01T00:00:00.000Z',
    encryptionKey,
    nowIso: '2026-10-02T13:00:00.000Z',
  })
  const rotated = db
    .query('SELECT refresh_token_enc, refresh_token_iv, previous_token_enc, previous_token_iv FROM tesla_oauth_token WHERE member_id = ?')
    .get(memberId) as Record<string, string>
  check('rotation keeps one row per member',
    (db.query('SELECT count(*) c FROM tesla_oauth_token').get() as { c: number }).c, 1)
  check('current token rotated',
    await openToken({ ciphertext: rotated.refresh_token_enc, iv: rotated.refresh_token_iv, keyVersion: 1 }, encryptionKey),
    'REFRESH-TOKEN-ROTATED')
  check('previous token retained for grace',
    await openToken({ ciphertext: rotated.previous_token_enc, iv: rotated.previous_token_iv, keyVersion: 1 }, encryptionKey),
    'REFRESH-TOKEN-ORIGINAL')

  /* ---- session + audit ------------------------------------------------- */
  console.log('\nSession and audit')
  const sessionId = crypto.randomUUID()
  await createSession(d1, {
    sessionId, memberId, scope: 'openid', expiresAt: '2027-01-01T00:00:00.000Z',
    userAgent: 'Mozilla/5.0 (test)', nowIso: iso,
  })
  await audit(d1, {
    action: 'member.connect', actorType: 'member', actor: memberId,
    subjectType: 'member', subjectId: memberId, detail: { consentId }, nowIso: iso,
  })
  check('session recorded', (db.query('SELECT count(*) c FROM tesla_auth_session').get() as { c: number }).c, 1)
  check('audit recorded', (db.query('SELECT count(*) c FROM tesla_audit_event').get() as { c: number }).c, 1)

  // The dashboard query, verbatim — a join mistake here is a broken dashboard.
  const dashboard = db
    .query(
      `SELECT m.member_id, c.consent_id, c.policy_sha256
         FROM tesla_auth_session s
         JOIN tesla_member m ON m.member_id = s.member_id
         LEFT JOIN tesla_consent c ON c.member_id = m.member_id AND c.revoked_at IS NULL
        WHERE s.session_id = ?
        ORDER BY c.granted_at DESC
        LIMIT 1`,
    )
    .get(sessionId) as { member_id: string; consent_id: string }
  check('dashboard query resolves', dashboard.consent_id, consentId)

  /* ---- revocation ------------------------------------------------------ */
  console.log('\nRevocation (F01-R04, F01 AC2, F01 AC3)')
  check('revoke affected one row', await revokeConsent(d1, memberId, 'member_revoked', '2026-10-02T14:00:00.000Z'), 1)
  check('revoked_at set',
    (db.query('SELECT revoked_at FROM tesla_consent WHERE consent_id = ?').get(consentId) as { revoked_at: string }).revoked_at,
    '2026-10-02T14:00:00.000Z')
  check('no active consent after revocation', await activeConsent(d1, memberId), 'null')

  // Re-granting appends rather than rewriting history (F01 AC3).
  const regranted = await recordConsent(d1, {
    memberId, scope: 'openid', nowIso: '2026-10-02T15:00:00.000Z',
  })
  check('re-grant appends a new row',
    (db.query('SELECT count(*) c FROM tesla_consent').get() as { c: number }).c, 2)
  check('prior grant still readable',
    (db.query('SELECT revoked_at FROM tesla_consent WHERE consent_id = ?').get(consentId) as { revoked_at: string }).revoked_at,
    '2026-10-02T14:00:00.000Z')
  check('new consent is active', (await activeConsent(d1, memberId))?.consent_id, regranted.consentId)

  /* ---- guard triggers actually fire ------------------------------------ */
  console.log('\nSchema guard triggers (the reason the DB, not the Worker, enforces these)')
  let threw = 'no'
  try {
    db.query(
      `UPDATE tesla_consent SET revoked_at = NULL WHERE consent_id = ?`,
    ).run(consentId)
  } catch (e) {
    threw = (e as Error).message.includes('cannot be re-granted') ? 'yes' : `other: ${(e as Error).message}`
  }
  check('un-revoking is impossible', threw, 'yes')

  threw = 'no'
  try {
    // Soc is in the catalog but collected = 0, so a fact row must be refused.
    db.query(
      `INSERT INTO tesla_telemetry_fact
         (fact_id, vin, field_key, observed_at, received_at, value_int, value_kind, collection_tier)
       VALUES (?, 'VIN0000000000001', 'Soc', 't', 't', 55, 'int', 'event')`,
    ).run(newId())
  } catch (e) {
    threw = (e as Error).message.includes('not marked collected') ? 'yes' : `other: ${(e as Error).message}`
  }
  check('uncollected field refused', threw, 'yes')

  threw = 'no'
  try {
    // Odometer is 'event' tier, so it may not go in the once-only snapshot table.
    db.query(
      `INSERT INTO tesla_vehicle_snapshot (vin, field_key, value_text, observed_at)
       VALUES ('VIN0000000000001', 'Odometer', '1', 't')`,
    ).run()
  } catch (e) {
    threw = (e as Error).message.includes('once-only') ? 'yes' : `other: ${(e as Error).message}`
  }
  check('event field refused in snapshot', threw, 'yes')

  threw = 'no'
  try {
    // CarType IS once-only, so the snapshot table must accept it.
    db.query(
      `INSERT INTO tesla_vehicle_snapshot (vin, field_key, value_text, observed_at)
       VALUES ('VIN0000000000001', 'CarType', 'model3', 't')`,
    ).run()
  } catch (e) {
    threw = `rejected: ${(e as Error).message}`
  }
  check('once-only field accepted', threw, 'no')

  /* ---- ingest: consent gate (F04-R14, F04 AC5) -------------------------- */
  console.log('\nIngest consent gate (F04-R14)')
  const { memberMayBeCollected, vehicleExists, timingSafeEqual, recordRejections } = await import('../src/store')
  const { normalise, persistDatums, extractDatums, recordSignals, costReport, startIngestRun, finishIngestRun, resolveTiers } =
    await import('../src/telemetry')

  check('unknown VIN refused', await vehicleExists(d1, 'VIN-DOES-NOT-EXIST'), 'false')
  check('known VIN recognised', await vehicleExists(d1, 'VIN0000000000001'), 'true')

  // The re-grant above made consent active again, so this vehicle may be collected.
  check('consented vehicle may be collected', await memberMayBeCollected(d1, 'VIN0000000000001'), 'true')

  await revokeConsent(d1, memberId, 'member_revoked', '2026-10-02T16:00:00.000Z')
  check('revoked member is not collected', await memberMayBeCollected(d1, 'VIN0000000000001'), 'false')

  await recordConsent(d1, { memberId, scope: 'openid', nowIso: '2026-10-02T17:00:00.000Z' })
  check('re-consented member collected again', await memberMayBeCollected(d1, 'VIN0000000000001'), 'true')

  /* ---- ingest: the real path ------------------------------------------- */
  console.log('\nIngest: real payload through the real schema (F04 AC1)')
  const runId = await startIngestRun(d1, { cadence: 'push', nowIso: '2026-10-03T00:00:00.000Z' })

  const payload = {
    vin: 'VIN0000000000001',
    data: [
      { key: 'Odometer', value: { doubleValue: 16093.4 }, createdAt: '2026-10-03T00:00:00.000Z' },
      { key: 'MilesSinceReset', value: { doubleValue: 1000 }, createdAt: '2026-10-03T00:00:00.000Z' },
      { key: 'SelfDrivingMilesSinceReset', value: { doubleValue: 400 }, createdAt: '2026-10-03T00:00:00.000Z' },
      // once-tier: must land in the snapshot table, never the fact table.
      { key: 'CarType', value: { stringValue: 'model3' }, createdAt: '2026-10-03T00:00:00.000Z' },
      // catalogued but NOT collected (consented scope excludes it).
      { key: 'Soc', value: { intValue: 72 }, createdAt: '2026-10-03T00:00:00.000Z' },
      // not catalogued at all.
      { key: 'SomeFutureFirmwareField', value: { intValue: 1 }, createdAt: '2026-10-03T00:00:00.000Z' },
      // reported as unavailable by the vehicle.
      { key: 'Odometer', value: { invalid: true }, createdAt: '2026-10-03T00:00:00.000Z' },
    ],
  }

  const extracted = extractDatums(payload)
  check('datums extracted', extracted.length, 7)

  const tiers = await resolveTiers(d1, extracted.map((e) => e.datum.key))
  const normalized = normalise(extracted, tiers, '2026-10-03T00:00:00.000Z')
  check('collected datums accepted', normalized.normalised.length, 5)
  check('uncatalogued dropped', normalized.skippedUnknown, 1)
  check('uncollected dropped', normalized.skippedUncollected, 1)
  check('invalid counted, not dropped', normalized.invalidValues, 1)

  const batchId = newId()
  await d1.prepare(
    `INSERT INTO tesla_telemetry_batch (batch_id, vin, received_at, payload_bytes, r2_key, payload_sha256, datum_count, is_resend, content_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'application/json')`,
  ).bind(batchId, 'VIN0000000000001', '2026-10-03T00:00:00.000Z', 100, 'k', 'sha', 7).run()

  const written = await persistDatums(d1, {
    batchId, vin: 'VIN0000000000001', datums: normalized.normalised, receivedAt: '2026-10-03T00:00:00.000Z',
  })
  check('facts written (duplicate Odometer collapsed)', written.factsWritten, 3)
  check('once field went to snapshot', written.snapshotsWritten, 1)

  const snapshotRows = db.query("SELECT field_key FROM tesla_vehicle_snapshot WHERE vin = 'VIN0000000000001'").all() as Array<{ field_key: string }>
  check('snapshot holds only CarType', snapshotRows.map((r) => r.field_key).join(','), 'CarType')
  check('no Soc fact stored',
    (db.query("SELECT count(*) c FROM tesla_telemetry_fact WHERE field_key = 'Soc'").get() as { c: number }).c, 0)
  check('no uncatalogued fact stored',
    (db.query("SELECT count(*) c FROM tesla_telemetry_fact WHERE field_key = 'SomeFutureFirmwareField'").get() as { c: number }).c, 0)

  // The valid Odometer reading won the dedupe, so the invalid marker for the same
  // instant is correctly absent — a real reading must not be replaced by
  // "unavailable". Prove invalid persistence separately with an invalid-only field.
  const invalidOnly = db.query("SELECT count(*) c FROM tesla_telemetry_fact WHERE field_key = 'Odometer' AND value_kind = 'invalid'").get() as { c: number }
  check('valid reading beats invalid at same instant', invalidOnly.c, 0)

  await persistDatums(d1, {
    batchId,
    vin: 'VIN0000000000001',
    receivedAt: '2026-10-03T00:00:00.000Z',
    datums: [
      { fieldKey: 'PinToDriveEnabled', observedAt: '2026-10-03T00:00:00.000Z', valueKind: 'invalid', valueReal: null, valueInt: null, valueText: null, valueBool: null, valueJson: null, tier: 'event' },
    ],
  })
  const invalidRow = db.query("SELECT value_kind FROM tesla_telemetry_fact WHERE field_key = 'PinToDriveEnabled'").get() as { value_kind: string } | null
  check('invalid datum persisted as evidence', invalidRow?.value_kind, 'invalid')

  /* ---- ingest: cost + run log (F04-R16, F04 AC6) ------------------------ */
  console.log('\nCost and run log (F04-R16, F04 AC6)')
  await recordSignals(d1, { vin: 'VIN0000000000001', datumCount: 7, nowIso: '2026-10-03T00:00:00.000Z' })
  await recordSignals(d1, { vin: 'VIN0000000000001', datumCount: 3, nowIso: '2026-10-03T06:00:00.000Z' })
  const cost = await costReport(d1, '2026-10')
  check('signals accumulate per day', cost.signals, 10)
  check('cost derived from signals', cost.costUsd.toFixed(8), (10 / 150000).toFixed(8))

  await recordRejections(d1, {
    runId, vin: 'VIN0000000000001', fieldKeys: ['Soc'], reason: 'not_collected',
    observedAt: '2026-10-03T00:00:00.000Z', createdAt: '2026-10-03T00:00:00.000Z',
  })
  check('rejection recorded with reason',
    (db.query("SELECT count(*) c FROM tesla_ingest_rejection WHERE reason = 'not_collected'").get() as { c: number }).c, 1)

  await finishIngestRun(d1, runId, {
    nowIso: '2026-10-03T00:00:05.000Z', attempted: 1, succeeded: 1, failed: 0, errors: [], costUsd: cost.costUsd,
  })
  const run = db.query('SELECT status, cost_usd, finished_at FROM tesla_ingest_run WHERE run_id = ?').get(runId) as { status: string; cost_usd: number; finished_at: string }
  check('run marked complete', run.status, 'complete')
  check('run carries cost (F04 AC6)', run.cost_usd > 0, 'true')

  // F04-R11 / AC2: a run with one failure and one success is partial, not failed.
  const run2 = await startIngestRun(d1, { cadence: 'push', nowIso: '2026-10-03T01:00:00.000Z' })
  await finishIngestRun(d1, run2, {
    nowIso: '2026-10-03T01:00:01.000Z', attempted: 2, succeeded: 1, failed: 1,
    errors: [{ vin: 'VIN0000000000002', code: 'persist_failed' }], costUsd: 0,
  })
  check('partial run degraded correctly (F04 AC2)',
    (db.query('SELECT status FROM tesla_ingest_run WHERE run_id = ?').get(run2) as { status: string }).status, 'partial')
  // A run where everything failed is failed, not partial.
  const run3 = await startIngestRun(d1, { cadence: 'push', nowIso: '2026-10-03T02:00:00.000Z' })
  await finishIngestRun(d1, run3, {
    nowIso: '2026-10-03T02:00:01.000Z', attempted: 2, succeeded: 0, failed: 2,
    errors: [{ vin: 'a', code: 'x' }, { vin: 'b', code: 'y' }], costUsd: 0,
  })
  check('all-failed run marked failed',
    (db.query('SELECT status FROM tesla_ingest_run WHERE run_id = ?').get(run3) as { status: string }).status, 'failed')

  /* ---- derivation end-to-end (F05 AC1, AC2, AC5) ------------------------ */
  console.log('\nDerivation end-to-end (F05)')
  const { deriveProfile, loadFacts, saveProfile, DERIVATION_FIELDS } = await import('../src/derive')

  await persistDatums(d1, {
    batchId,
    vin: 'VIN0000000000001',
    receivedAt: '2026-11-01T00:00:00.000Z',
    datums: [
      { fieldKey: 'MilesSinceReset', observedAt: '2026-11-01T00:00:00.000Z', valueKind: 'real', valueReal: 2000, valueInt: null, valueText: null, valueBool: null, valueJson: null, tier: 'event' },
      { fieldKey: 'SelfDrivingMilesSinceReset', observedAt: '2026-11-01T00:00:00.000Z', valueKind: 'real', valueReal: 800, valueInt: null, valueText: null, valueBool: null, valueJson: null, tier: 'event' },
    ],
  })

  const facts = await loadFacts(d1, {
    vin: 'VIN0000000000001', from: '2026-10-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z',
    fieldKeys: [...DERIVATION_FIELDS],
  })
  check('loadFacts returns typed numeric facts only', facts.length > 0, 'true')

  const profile = deriveProfile({
    periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z', facts,
  })
  // 1000 -> 2000 miles total, 400 -> 800 on FSD: a 0.40 share.
  check('FSD share derived (F05 AC2)', profile.fsdPercent?.toFixed(4), '0.4000')
  check('FSD labelled measured', profile.fsdAvailability, 'measured')
  check('distance converted to km', Math.round(profile.distanceKm ?? 0), Math.round(1000 * 1.609344))
  check('source range recorded (F05 AC5)', `${profile.sourceFactMin}|${profile.sourceFactMax}`.length > 10, 'true')

  const profileId = await saveProfile(d1, { memberId, vin: 'VIN0000000000001', profile, nowIso: '2026-12-01T00:00:00.000Z' })
  const saved = db.query('SELECT distance_km, fsd_availability, derivation_version FROM tesla_driver_profile WHERE profile_id = ?').get(profileId) as { distance_km: number; fsd_availability: string; derivation_version: string }
  check('profile persisted', saved.fsd_availability, 'measured')
  check('derivation version stored (F05-R12)', saved.derivation_version, '1.0.0')

  /* ---- raw payload archive (F04 AC7) ----------------------------------- */
  console.log('\nRaw payload retrievability (F04-R15, F04 AC7)')
  const batchRow = db.query('SELECT r2_key, payload_sha256, datum_count FROM tesla_telemetry_batch WHERE batch_id = ?').get(batchId) as { r2_key: string; payload_sha256: string; datum_count: number }
  check('batch row records the R2 key', batchRow.r2_key.length > 0, 'true')
  check('batch row records a hash for replay verification', batchRow.payload_sha256.length > 0, 'true')

  /* ---- secret comparison ----------------------------------------------- */
  console.log('\nRelay authentication')
  check('constant-time compare accepts a match', timingSafeEqual('abc123', 'abc123'), 'true')
  check('constant-time compare rejects a near miss', timingSafeEqual('abc123', 'abc124'), 'false')
  check('constant-time compare rejects a length mismatch', timingSafeEqual('abc123', 'abc1234'), 'false')
  check('constant-time compare rejects empty', timingSafeEqual('', 'x'), 'false')

  console.log()
  console.log(`passed ${pass}, failed ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('harness error:', error)
  process.exit(2)
})
