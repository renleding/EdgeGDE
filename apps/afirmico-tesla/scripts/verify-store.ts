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
    async first<T>() {
      const row = db.query(this.sql).get(...(this.args as never[]))
      return (row ?? null) as T | null
    }
    async all<T>() {
      return { results: db.query(this.sql).all(...(this.args as never[])) as T[] }
    }
    async run() {
      const info = db.query(this.sql).run(...(this.args as never[]))
      return { meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) } }
    }
  }
  return {
    prepare: (sql: string) => new Stmt(sql),
    exec: async (sql: string) => db.exec(sql),
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

  console.log()
  console.log(`passed ${pass}, failed ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('harness error:', error)
  process.exit(2)
})
