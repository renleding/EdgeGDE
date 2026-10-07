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
import { CONSENT_POLICY_VERSION, CONSENTED_FIELDS, CONSENT_TEXT, sha256Hex } from '../src/consent-policy'

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
    // Strip a UTF-8 BOM: generated migration files can carry one, and a leading
    // U+FEFF makes SQLite reject the statement with a syntax error whose message
    // points at the first token, not at the invisible byte.
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/^\uFEFF/, '')
    db.exec(sql)
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
  // Migration 0013 adds Trim, so the collection set is 15. Pinned so an accidental
  // change to the set requires a considered edit rather than passing unnoticed.
  check('field set recorded', JSON.parse(String(consentRow.collected_fields)).length, 15)

  // F01 AC6 (Must): the catalog's collected set and CONSENTED_FIELDS are two
  // independent representations of the same decision. R-10 was raised because
  // nothing compared them — the disclosure said two numbers, the catalog said
  // fourteen, and every gate passed. This is the gate that was missing.
  const catalogCollected = (
    db.query('SELECT field_key FROM tesla_field_catalog WHERE collected = 1 ORDER BY field_key').all() as Array<{
      field_key: string
    }>
  ).map((r) => r.field_key)
  const declared = [...CONSENTED_FIELDS].sort()
  check('catalog collected count', catalogCollected.length, declared.length)
  check('catalog collected set == CONSENTED_FIELDS (F01 AC6)', catalogCollected.join(','), declared.join(','))

  // The row written above records the set under the CURRENT policy version, so it
  // must agree too — otherwise a member who consented today holds a consent row
  // describing a different set from the one being collected.
  check(
    'consent row field set == CONSENTED_FIELDS',
    JSON.parse(String(consentRow.collected_fields)).sort().join(','),
    declared.join(','),
  )

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

  /* ---- F07: quote package + consent-based release ----------------------- */
  console.log('\nQuote package and release (F07)')
  const {
    buildQuotePackage, issueDownloadToken, redeemDownloadToken,
    releaseEligibility, activePolicyHold, PACKAGE_VERSION, ReleaseBlocked,
  } = await import('../src/release')

  const releaseMember = await upsertMember(d1, {
    teslaSub: 'release-sub-1', teslaEmail: 'r@example.com', displayName: 'Release Tester',
  })
  await d1.prepare('UPDATE tesla_member SET mobile = ?, postcode = ? WHERE member_id = ?')
    .bind('0400000000', '2335', releaseMember).run()
  await upsertVehicles(d1, releaseMember, [
    { vin: 'VIN-RELEASE-000001', displayName: 'Release Car' },
  ], '2026-10-01T00:00:00.000Z')
  await recordConsent(d1, { memberId: releaseMember, scope: 'openid', nowIso: '2026-10-01T00:00:01.000Z' })

  check('eligibility requires live consent', (await releaseEligibility(d1, releaseMember)).eligible, 'true')

  const period = { periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z' }
  const pkg = await buildQuotePackage(d1, {
    memberId: releaseMember, vin: 'VIN-RELEASE-000001',
    ...period, nowIso: '2026-10-02T00:00:00.000Z', requestedBy: 'underwriter:test',
  })
  check('package built', pkg.rowCount, 1)
  check('package carries FSD availability', pkg.csv.includes('unavailable'), 'true')
  check('package version pinned', pkg.csv.includes(PACKAGE_VERSION), 'true')
  check('member PII present in package (F07-R01)', pkg.csv.includes('0400000000') && pkg.csv.includes('2335'), 'true')
  check('package hash recorded', pkg.sha256.length, 64)

  // F07-R03/F07-N01: attributable audit row.
  check('release has an audit row',
    (db.query("SELECT count(*) c FROM tesla_audit_event WHERE action = 'release_created' AND subject_id = ?").get(pkg.releaseId) as { c: number }).c, 1)

  // F07-R05/R06: time-limited single-recipient link.
  const dlTok = await issueDownloadToken(d1, {
    releaseId: pkg.releaseId, issuedTo: 'insurer:test', ttlSeconds: 3600, nowIso: '2026-10-02T00:00:00.000Z',
  })
  check('token is not stored in plaintext', 
    (db.query('SELECT count(*) c FROM tesla_download_token WHERE token_hash = ?').get(dlTok.token) as { c: number }).c, 0)
  check('token expiry set', dlTok.expiresAt, '2026-10-02T01:00:00.000Z')

  const load = async () => pkg.csv
  const redeemed = await redeemDownloadToken(d1, {
    token: dlTok.token, nowIso: '2026-10-02T00:10:00.000Z', ipHash: 'h', userAgent: 'ua', loadArtifact: load,
  })
  check('valid token redeems', redeemed.ok, 'true')
  check('download logged (F07-R06)',
    (db.query("SELECT count(*) c FROM tesla_release_access WHERE release_id = ? AND action = 'download'").get(pkg.releaseId) as { c: number }).c, 1)

  const replay = await redeemDownloadToken(d1, {
    token: dlTok.token, nowIso: '2026-10-02T00:11:00.000Z', ipHash: 'h', userAgent: 'ua', loadArtifact: load,
  })
  check('single-use token refuses replay', replay.reason, 'already_used')

  const expired = await issueDownloadToken(d1, {
    releaseId: pkg.releaseId, issuedTo: 'insurer:test', ttlSeconds: 60, nowIso: '2026-10-02T00:00:00.000Z',
  })
  const late = await redeemDownloadToken(d1, {
    token: expired.token, nowIso: '2026-10-02T02:00:00.000Z', ipHash: 'h', userAgent: 'ua', loadArtifact: load,
  })
  check('expired token refused (F07-N02)', late.reason, 'expired')

  // F07-N03: a link minted while consent was live must stop working on revocation.
  const revokedTok = await issueDownloadToken(d1, {
    releaseId: pkg.releaseId, issuedTo: 'insurer:test', ttlSeconds: 86400, nowIso: '2026-10-02T00:00:00.000Z',
  })
  await revokeConsent(d1, releaseMember, 'member_revoked', '2026-10-02T00:30:00.000Z')
  const afterRevoke = await redeemDownloadToken(d1, {
    token: revokedTok.token, nowIso: '2026-10-02T00:31:00.000Z', ipHash: 'h', userAgent: 'ua', loadArtifact: load,
  })
  check('revocation blocks an already-issued link (F07-N03)', afterRevoke.reason, 'consent_revoked')

  const blocked = await buildQuotePackage(d1, {
    memberId: releaseMember, vin: 'VIN-RELEASE-000001',
    ...period, nowIso: '2026-10-02T00:32:00.000Z', requestedBy: 'underwriter:test',
  }).then(() => null).catch((e) => e)
  check('no release without live consent (F07-R02)', blocked instanceof ReleaseBlocked ? blocked.reason : 'NOT BLOCKED', 'no_live_consent')

  /* ---- F07-R10: policy hold ------------------------------------------- */
  console.log('\nPolicy hold (F07-R10, F07-N04)')
  await recordConsent(d1, { memberId: releaseMember, scope: 'openid', nowIso: '2026-10-02T01:00:00.000Z' })

  const noPolicy = await activePolicyHold(d1, releaseMember, '2026-10-15T00:00:00.000Z')
  check('no hold without a policy', noPolicy.held, 'false')

  await d1.prepare(
    `INSERT INTO tesla_policy (policy_id, member_id, vin, insurer_ref, insurer_name, policy_number,
       cover_start, cover_end, status, bound_at, created_at, updated_at)
     VALUES (?, ?, ?, 'INS-T', 'Test Insurer', 'P-1', '2026-10-01T00:00:00.000Z', '2027-10-01T00:00:00.000Z', 'active',
             '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).bind(newId(), releaseMember, 'VIN-RELEASE-000001').run()
  const held = await activePolicyHold(d1, releaseMember, '2026-10-15T00:00:00.000Z')
  check('active policy holds collection (F07-R10)', held.held, 'true')
  check('hold reports cover end', held.coverEnd, '2027-10-01T00:00:00.000Z')

  const afterExpiry = await activePolicyHold(d1, releaseMember, '2027-11-01T00:00:00.000Z')
  check('expired policy no longer holds', afterExpiry.held, 'false')

  // One active policy per vehicle: a second would double-count in F06 aggregates.
  const dup = (() => {
    try {
      db.query(
        `INSERT INTO tesla_policy (policy_id, member_id, vin, insurer_ref, insurer_name, policy_number,
           cover_start, cover_end, status, bound_at, created_at, updated_at)
         VALUES (?, ?, ?, 'INS-U', 'Other', 'P-2', '2026-10-01T00:00:00.000Z', '2027-10-01T00:00:00.000Z', 'active',
                 '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      ).run(newId(), releaseMember, 'VIN-RELEASE-000001')
      return 'accepted'
    } catch { return 'refused' }
  })()
  check('two active policies on one VIN impossible', dup, 'refused')

  // cover_end before cover_start is a data-entry error, not a valid policy.
  const badCover = (() => {
    try {
      db.query(
        `INSERT INTO tesla_policy (policy_id, member_id, vin, insurer_ref, cover_start, cover_end, status, bound_at, created_at, updated_at)
         VALUES (?, ?, 'VIN-RELEASE-000001', 'INS-X', '2027-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'active',
                 '2027-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z')`,
      ).run(newId(), releaseMember)
      return 'accepted'
    } catch { return 'refused' }
  })()
  check('policy with reversed cover period refused', badCover, 'refused')

  /* ---- F01-R05: member details ----------------------------------------- */
  console.log('\nMember details (F01-R05)')
  const { saveMemberDetails, memberDetailGaps, InvalidDetail, normalisePostcodeAu } =
    await import('../src/onboarding')

  const detailsMember = await upsertMember(d1, {
    teslaSub: 'details-sub-1', teslaEmail: 'd@example.com', displayName: 'Details Tester',
  })

  check('a fresh member is missing both details',
    (await memberDetailGaps(d1, detailsMember)).join(','), 'mobile,postcode')

  const savedDetails = await saveMemberDetails(d1, {
    memberId: detailsMember, mobile: '0412 345 678', postcode: '0800',
    nowIso: '2026-10-02T00:00:00.000Z',
  })
  check('mobile stored canonical', savedDetails.mobile, '+61412345678')
  check('leading-zero postcode preserved', savedDetails.postcode, '0800')
  check('gaps closed after saving', (await memberDetailGaps(d1, detailsMember)).length, 0)

  // The stored value, read back through the same type the release path reads.
  const stored = db.query('SELECT mobile, postcode FROM tesla_member WHERE member_id = ?')
    .get(detailsMember) as { mobile: string; postcode: string }
  check('postcode survives the round trip as text', stored.postcode, '0800')
  check('postcode did not become a number', typeof stored.postcode, 'string')

  const noChange = await saveMemberDetails(d1, {
    memberId: detailsMember, mobile: '+61 412 345 678', postcode: '0800',
    nowIso: '2026-10-02T00:01:00.000Z',
  })
  check('re-submitting the same details is not a change', noChange.changed, 'false')

  const badMobile = await saveMemberDetails(d1, {
    memberId: detailsMember, mobile: '0512345678', postcode: '0800',
  }).then(() => null).catch((e) => e)
  check('a non-mobile prefix is refused',
    badMobile instanceof InvalidDetail ? badMobile.field : 'NOT REFUSED', 'mobile')

  const badPostcode = await saveMemberDetails(d1, {
    memberId: detailsMember, mobile: '0412345678', postcode: '0100',
  }).then(() => null).catch((e) => e)
  check('an unallocated postcode is refused',
    badPostcode instanceof InvalidDetail ? badPostcode.field : 'NOT REFUSED', 'postcode')

  // A refused save must not have partially written the good field.
  const afterRefusal = db.query('SELECT mobile, postcode FROM tesla_member WHERE member_id = ?')
    .get(detailsMember) as { mobile: string; postcode: string }
  check('a refused save leaves both fields untouched',
    `${afterRefusal.mobile}|${afterRefusal.postcode}`, '+61412345678|0800')

  check('0800 would be corrupted if coerced to a number',
    normalisePostcodeAu('0800') === String(Number('0800')) ? 'CORRUPTED' : 'preserved', 'preserved')

  /* ---- F06: group-level analytics -------------------------------------- */
  console.log('\nGroup analytics (F06)')
  const { buildGroupExport, scanForPii, AGGREGATION_VERSION } = await import('../src/analytics')

  // Two members in 2335, one in 0800 (the single-member cohort F06-R04 requires to be
  // published). gxPii deliberately has NO postcode: excluded from cells, and counted.
  const gx1 = await upsertMember(d1, { teslaSub: 'gx-1', teslaEmail: 'g1@example.com', displayName: 'G One' })
  const gx2 = await upsertMember(d1, { teslaSub: 'gx-2', teslaEmail: 'g2@example.com', displayName: 'G Two' })
  const gx3 = await upsertMember(d1, { teslaSub: 'gx-3', teslaEmail: 'g3@example.com', displayName: 'G Three' })
  const gxPii = await upsertMember(d1, { teslaSub: 'gx-4', teslaEmail: 'leak@example.com', displayName: 'Leaky Person' })

  await d1.prepare("UPDATE tesla_member SET postcode = '2335' WHERE member_id IN (?, ?)").bind(gx1, gx2).run()
  await d1.prepare("UPDATE tesla_member SET postcode = '0800' WHERE member_id = ?").bind(gx3).run()

  // NOTE on segmentation: `upsertVehicles` writes only vin/display_name/timestamps, so
  // tesla_vehicle.model is NULL here exactly as it is in production. The model must
  // therefore come from the once-tier snapshot (CarType) — which is the path every
  // real export takes, and the path the first version of analytics.ts got wrong by
  // silently labelling everything 'Unknown'.
  for (const [member, vin, carType] of [
    [gx1, '5YJ3E1EA73F000001', 'CarTypeModel3'],
    [gx2, '5YJ3E1EA73F000002', 'CarTypeModel3'],
    [gx3, '5YJ3E1EA7LF000003', 'CarTypeModelY'],
    [gxPii, '5YJ3E1EA7LF000004', 'CarTypeModel3'],
  ] as const) {
    await upsertVehicles(d1, member, [{ vin, displayName: vin }], '2026-10-01T00:00:00.000Z')
    // Written exactly as telemetry.ts writes a once-tier field.
    await d1.prepare(
      `INSERT INTO tesla_vehicle_snapshot (vin, field_key, value_text, value_kind, observed_at)
       VALUES (?, 'CarType', ?, 'text', '2026-09-01T00:00:00.000Z')
       ON CONFLICT (vin, field_key) DO UPDATE SET value_text = excluded.value_text`,
    ).bind(vin, carType).run()
  }

  // Two profiles for gx1 so the "latest per vehicle" rule is actually exercised.
  const profileRows: Array<[string, string, string, number, number, number | null, string]> = [
    [gx1, '5YJ3E1EA73F000001', '2026-09-01T00:00:00.000Z', 10000, 1000, 400, 'measured'],
    [gx1, '5YJ3E1EA73F000001', '2026-09-15T00:00:00.000Z', 12000, 1200, 480, 'measured'],
    [gx2, '5YJ3E1EA73F000002', '2026-09-01T00:00:00.000Z', 20000, 2000, 1000, 'partial'],
    [gx3, '5YJ3E1EA7LF000003', '2026-09-01T00:00:00.000Z', 5000, 500, null, 'unavailable'],
    // gxPii has a profile but NO postcode, so it is genuinely a member that cannot be
    // placed in a cell. Without this profile the exclusion count would be 0 and the
    // F06-R09 assertion below would pass vacuously.
    [gxPii, '5YJ3E1EA7LF000004', '2026-09-01T00:00:00.000Z', 7000, 700, 280, 'measured'],
  ]
  for (const [member, vin, start, odo, dist, fsd, avail] of profileRows) {
    await d1.prepare(
      `INSERT INTO tesla_driver_profile
         (profile_id, member_id, vin, period_start, period_end, odometer_km, distance_km,
          fsd_km, fsd_availability, fsd_note, counter_reset_count, derivation_version, derived_at)
       VALUES (?, ?, ?, ?, '2026-10-01T00:00:00.000Z', ?, ?, ?, ?, NULL, 0, '1.0.0', ?)`,
    ).bind(`prof_${vin}_${start}`, member, vin, start, odo, dist, fsd, avail, start).run()
  }

  // F06-AC6: seed a run + batch + fact so the generation run is genuinely traceable.
  // This is the chain that did NOT work before migration 0010 — the batch row had no
  // run_id, so a fact could reach its payload but never the run.
  const gxRunId = 'run_gx_trace_0001'
  await d1.prepare(
    `INSERT INTO tesla_ingest_run (run_id, cadence, started_at, status, updated_at)
     VALUES (?, 'push', '2026-09-01T00:00:00.000Z', 'complete', '2026-09-01T00:01:00.000Z')`,
  ).bind(gxRunId).run()
  await d1.prepare(
    `INSERT INTO tesla_telemetry_batch (batch_id, vin, received_at, r2_key, payload_sha256, run_id)
     VALUES ('bat_gx_0001', '5YJ3E1EA73F000001', '2026-09-01T00:00:05.000Z', 'k', 'h', ?)`,
  ).bind(gxRunId).run()
  await d1.prepare(
    `INSERT INTO tesla_telemetry_fact
       (fact_id, vin, field_key, observed_at, received_at, value_int, value_kind, collection_tier, batch_id, is_resend)
     VALUES ('fact_gx_0001', '5YJ3E1EA73F000001', 'Odometer', '2026-09-01T00:00:05.000Z',
             '2026-09-01T00:00:06.000Z', 12000, 'int', 'event', 'bat_gx_0001', 0)`,
  ).run()

  const gx = await buildGroupExport(d1, {
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    requestedBy: 'insurer:acme',
    nowIso: '2026-10-02T00:00:00.000Z',
  })

  check('vehicle count is per vehicle, not per profile', gx.vehicleCount, 3)
  check('single-member cohort published (F06-R04)',
    gx.rows.find((r) => r.postcode === '0800')?.vehicle_count, 1)
  check('exclusions reported rather than silently dropped (F06-R09)',
    gx.membersExcludedNoPostcode, 1)

  // F06-R03: the segment must be a real model resolved from the snapshot, not
  // 'Unknown' — the defect this rewrite exists to fix.
  check('model resolved from the once-tier snapshot (F06-R03)',
    gx.rows.every((r) => r.model !== 'Unknown'), 'true')
  check('segment source records provenance', gx.rows[0]?.segment_source, 'snapshot')
  check('model year derived from the VIN', gx.rows.find((r) => r.postcode === '0800')?.model_year, 2020)
  check('year-only segmentation is reported as VIN-derived (not as a resolved model)',
    gx.caveats.some((c) => c.code === 'model_year_derived'), 'true')
  check('no unresolved segments in this dataset',
    gx.caveats.some((c) => c.code === 'segment_unresolved'), 'false')

  const cell2335 = gx.rows.find((r) => r.postcode === '2335')
  check('2335 and 0800 are separate cells', gx.rowCount >= 2, 'true')
  check('avg odometer uses latest profile per vehicle', cell2335?.avg_odometer_km, 16000)
  check('avg distance uses latest profile per vehicle', cell2335?.avg_period_distance_km, 1600)
  // gx1 480/1200 = 0.40 measured, gx2 1000/2000 = 0.50 partial -> 0.45
  check('avg FSD share is a fraction, not a percentage', cell2335?.avg_fsd_share, 0.45)
  check('partial derivations disclosed, not blended silently', cell2335?.fsd_partial_vehicles, 1)
  check('coverage reported alongside the figure (F06-R09)', cell2335?.fsd_contributing_vehicles, 2)

  const cell0800 = gx.rows.find((r) => r.postcode === '0800')
  check('unavailable FSD is not averaged as zero (F06-R05)', cell0800?.avg_fsd_share, 'null')
  check('unavailable FSD contributes 0 vehicles, not 1', cell0800?.fsd_contributing_vehicles, 0)
  check('single-member cell is warned about (F06-R08)',
    gx.smallCells.some((c) => c.postcode === '0800' && c.vehicleCount === 1), 'true')

  // F06-AC6 — the traceability that migration 0010 fixes.
  check('collection run resolved from facts -> batch -> run (F06-AC6)',
    gx.collectionRunIds.join(','), gxRunId)
  const trace = await d1.prepare(
    `SELECT r.run_id FROM tesla_telemetry_fact f
       JOIN tesla_telemetry_batch b ON b.batch_id = f.batch_id
       JOIN tesla_ingest_run r ON r.run_id = b.run_id
      WHERE f.fact_id = 'fact_gx_0001'`,
  ).first<{ run_id: string }>()
  check('the full fact -> run chain is joinable in SQL', trace?.run_id, gxRunId)

  check('charging absence is stated as a caveat (F06-R05)',
    gx.caveats.some((c) => c.code === 'charging_not_collected'), 'true')

  // F06-N01: the automated scan, against real values from the source data.
  const leaks = scanForPii(gx.csv, [
    'Leaky Person', 'leak@example.com', '5YJ3E1EA73F000001', '5YJ3E1EA7LF000004',
    'gx-1', '0412345678',
  ])
  check('PII scan finds nothing in the export (F06-N01, AC1)', leaks.join(','), '')
  check('scan CAN fail (guards against a vacuous scan)',
    scanForPii(`${gx.csv}Leaky Person\r\n`, ['Leaky Person']).length, 1)
  check('no VIN appears anywhere in the export', gx.csv.includes('5YJ3E1EA7'), 'false')

  // F06-R06/N03: reproducibility across two runs on the same dataset.
  const gxAgain = await buildGroupExport(d1, {
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    requestedBy: 'insurer:acme',
    nowIso: '2026-10-02T00:05:00.000Z',
  })
  check('re-running the same export yields identical bytes (F06-N03, AC4)', gxAgain.csv, gx.csv)
  check('...and the same hash', gxAgain.sha256, gx.sha256)

  // F06-R07: logged with query definition, recipient, timestamp, runs and caveats.
  const log = db.query(
    `SELECT query_json, requested_by, requested_at, artifact_sha256, small_cell_count,
            collection_run_ids, caveats_json, aggregation_version
       FROM tesla_group_export WHERE export_id = ?`,
  ).get(gx.exportId) as {
    query_json: string; requested_by: string; requested_at: string; artifact_sha256: string
    small_cell_count: number; collection_run_ids: string | null; caveats_json: string | null
    aggregation_version: string
  } | null
  check('export logged with recipient (F06-R07, AC5)', log?.requested_by, 'insurer:acme')
  check('export logged with timestamp', log?.requested_at, '2026-10-02T00:00:00.000Z')
  check('export log carries the query definition', log?.query_json.includes('period_start'), 'true')
  check('export log hash matches the delivered bytes', log?.artifact_sha256, gx.sha256)
  check('warning count persisted, not just printed', log?.small_cell_count, gx.smallCells.length)
  check('generation runs persisted with the export (F06-AC6)',
    JSON.parse(log?.collection_run_ids ?? '[]').includes(gxRunId), 'true')
  check('caveats persisted with the export', JSON.parse(log?.caveats_json ?? '[]').length > 0, 'true')
  check('aggregation version pinned (F06-R06)', AGGREGATION_VERSION, '2.0.0')

  console.log()
  console.log(`passed ${pass}, failed ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('harness error:', error)
  process.exit(2)
})
