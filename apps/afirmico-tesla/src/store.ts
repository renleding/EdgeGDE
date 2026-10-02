/**
 * Persistence for the member onboarding flow (FRS-010 F01, F02-R05/R06).
 *
 * Every function here takes the D1 binding explicitly rather than reaching for
 * an ambient environment, so the statements are testable and the call sites stay
 * honest about which database they touch.
 *
 * Identifier format: ULID-like, time-sortable. Generated here rather than by
 * SQLite because D1 gives no ordering guarantee across rows written in the same
 * millisecond and a monotonic-looking id makes audit reading far easier.
 */

import { CONSENTED_FIELDS, CONSENT_POLICY_VERSION, CONSENT_PURPOSES, CONSENT_TEXT, sha256Hex } from './consent-policy'
import { sealToken, type SealedToken } from './crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Time-sortable id: 48-bit millisecond timestamp + 80 bits of randomness,
 * Crockford base32. Sortable as text, which is what the primary keys want.
 */
export function newId(nowMs = Date.now()): string {
  let time = ''
  let remaining = nowMs
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[remaining % 32] + time
    remaining = Math.floor(remaining / 32)
  }
  const random = crypto.getRandomValues(new Uint8Array(16))
  let tail = ''
  for (const byte of random) tail += CROCKFORD[byte % 32]
  return time + tail
}

/** Hash an IP for consent evidence. Never store the raw address (F01-R03). */
export async function hashIp(ip: string | undefined | null): Promise<string | null> {
  if (!ip) return null
  return sha256Hex(ip)
}

export interface MemberIdentity {
  teslaSub?: string
  teslaEmail?: string
  displayName?: string
}

/**
 * Whether a vehicle is known to us (F04 ingest gate).
 *
 * A payload for an unknown VIN is not an ingest error — it means a telemetry
 * configuration points at a vehicle whose member never completed onboarding, or
 * revoked and re-registered under a different Tesla account. Worth recording,
 * because an unconfigured vehicle streaming into us is exactly the silent leak
 * this gate catches.
 */
export async function vehicleExists(db: D1Database, vin: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS present FROM tesla_vehicle WHERE vin = ?')
    .bind(vin)
    .first<{ present: number }>()
  return Boolean(row)
}

/**
 * Consent gate for ingest (F04-R14, F04 AC5).
 *
 * Collection is permitted only where the member has an unrevoked consent. The
 * "and no active policy" half of F04-R14 governs *retention*, not collection: a
 * member holding a live policy who has revoked consent still stops being
 * collected, because consent — not the policy — is what authorises reading the
 * vehicle. Conflating the two would mean quietly reading a vehicle after its
 * owner withdrew permission, which is the one thing the consent model exists to
 * prevent.
 */
export async function memberMayBeCollected(db: D1Database, vin: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS permitted
         FROM tesla_vehicle v
         JOIN tesla_member m ON m.member_id = v.member_id
         JOIN tesla_consent c ON c.member_id = m.member_id AND c.revoked_at IS NULL
        WHERE v.vin = ?
        LIMIT 1`,
    )
    .bind(vin)
    .first<{ permitted: number }>()
  return Boolean(row)
}

/**
 * Record why datums were not stored (F04-R16 observability).
 *
 * Without this, "the consented subset is working correctly" and "the relay is
 * sending field names we have never catalogued" look identical from outside —
 * both are simply missing rows.
 */
export async function recordRejections(
  db: D1Database,
  options: {
    runId: string
    vin: string | null
    fieldKeys: string[]
    reason: 'unknown_field' | 'not_collected' | 'invalid_value' | 'bad_vin'
    observedAt: string | null
    createdAt: string
  },
): Promise<number> {
  const unique = [...new Set(options.fieldKeys)]
  if (!unique.length) return 0

  await db.batch(
    unique.map((fieldKey) =>
      db
        .prepare(
          `INSERT INTO tesla_ingest_rejection
             (rejection_id, run_id, vin, field_key, reason, value_kind, observed_at, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          newId(),
          options.runId,
          options.vin,
          fieldKey,
          options.reason,
          options.observedAt,
          options.createdAt,
        ),
    ),
  )
  return unique.length
}

/**
 * Constant-time string comparison for the relay's shared secret.
 *
 * A byte-by-byte early-exit comparison leaks the secret's prefix through timing,
 * which over enough requests is enough to recover it.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const left = enc.encode(a)
  const right = enc.encode(b)
  // Fold over a fixed number of iterations regardless of length, so the early
  // exit that would otherwise leak length never happens.
  let diff = left.length ^ right.length
  const max = Math.max(left.length, right.length)
  for (let i = 0; i < max; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}

/**
 * Find or create the member behind a Tesla identity.
 *
 * Keyed on `tesla_sub`, not email: email can change on the Tesla account and is
 * not a stable identifier. An existing member keeps their `toca_status` — a
 * reconnect must not silently reset a verified TOCA member to `unknown`.
 */
export async function upsertMember(
  db: D1Database,
  identity: MemberIdentity,
  nowIso = new Date().toISOString(),
): Promise<string> {
  if (!identity.teslaSub) {
    throw new Error('a Tesla `sub` claim is required to identify a member')
  }

  const existing = await db
    .prepare('SELECT member_id FROM tesla_member WHERE tesla_sub = ?')
    .bind(identity.teslaSub)
    .first<{ member_id: string }>()

  if (existing) {
    await db
      .prepare(
        `UPDATE tesla_member
            SET tesla_email = COALESCE(?, tesla_email),
                display_name = COALESCE(?, display_name),
                updated_at = ?
          WHERE member_id = ?`,
      )
      .bind(identity.teslaEmail ?? null, identity.displayName ?? null, nowIso, existing.member_id)
      .run()
    return existing.member_id
  }

  const memberId = newId()
  await db
    .prepare(
      `INSERT INTO tesla_member
         (member_id, toca_status, email, display_name, tesla_sub, tesla_email,
          created_at, updated_at, tier)
       VALUES (?, 'unknown', ?, ?, ?, ?, ?, ?, 'toca')`,
    )
    .bind(
      memberId,
      identity.teslaEmail ?? null,
      identity.displayName ?? null,
      identity.teslaSub,
      identity.teslaEmail ?? null,
      nowIso,
      nowIso,
    )
    .run()
  return memberId
}

/** Record the vehicles Tesla returned, without disturbing an existing owner. */
export async function upsertVehicles(
  db: D1Database,
  memberId: string,
  vehicles: Array<{ vin: string; displayName?: string; state?: string }>,
  nowIso = new Date().toISOString(),
): Promise<void> {
  for (const vehicle of vehicles) {
    if (!vehicle.vin) continue
    await db
      .prepare(
        `INSERT INTO tesla_vehicle
           (vin, member_id, display_name, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (vin) DO UPDATE SET
           display_name = COALESCE(excluded.display_name, tesla_vehicle.display_name),
           last_seen_at = excluded.last_seen_at`,
      )
      .bind(vehicle.vin, memberId, vehicle.displayName ?? null, nowIso, nowIso)
      .run()
  }
}

/**
 * Record a member's consent grant (F01-R02/R03, F01 AC1).
 *
 * `policy_sha256` is the hash of the exact text the member was shown, which is
 * what makes F01 AC5 mechanically checkable rather than a matter of trust.
 */
export async function recordConsent(
  db: D1Database,
  params: {
    memberId: string
    vin?: string | null
    scope: string
    ip?: string | null
    userAgent?: string | null
    nowIso?: string
  },
): Promise<{ consentId: string; policySha256: string }> {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const consentId = newId()
  const policySha256 = await sha256Hex(CONSENT_TEXT)

  await db
    .prepare(
      `INSERT INTO tesla_consent
         (consent_id, member_id, vin, scope_granted, policy_version, purposes,
          granted_at, policy_sha256, collected_fields, recipients, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      consentId,
      params.memberId,
      params.vin ?? null,
      params.scope,
      CONSENT_POLICY_VERSION,
      JSON.stringify(CONSENT_PURPOSES),
      nowIso,
      policySha256,
      JSON.stringify(CONSENTED_FIELDS),
      JSON.stringify([]),
      await hashIp(params.ip),
      params.userAgent ?? null,
    )
    .run()

  return { consentId, policySha256 }
}

/** Idempotently register the current consent policy text for audit (F01 AC5). */
export async function ensureConsentPolicy(
  db: D1Database,
  nowIso = new Date().toISOString(),
): Promise<string> {
  const policySha256 = await sha256Hex(CONSENT_TEXT)
  await db
    .prepare(
      `INSERT INTO tesla_consent_policy
         (policy_version, policy_sha256, policy_text, effective_from, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (policy_version) DO NOTHING`,
    )
    .bind(CONSENT_POLICY_VERSION, policySha256, CONSENT_TEXT, nowIso, nowIso)
    .run()
  return policySha256
}

/**
 * Store the member's encrypted refresh token (F02-R05).
 *
 * Tesla rotates refresh tokens. The outgoing token remains valid briefly, so it
 * is kept in `previous_*` rather than dropped: a refresh that succeeds at Tesla
 * but fails to persist here would otherwise strand the member.
 */
export async function storeTokens(
  db: D1Database,
  params: {
    memberId: string
    refreshToken: string
    scope: string
    expiresAt: string
    teslaSub?: string | null
    encryptionKey: string
    nowIso?: string
  },
): Promise<void> {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const sealed: SealedToken = await sealToken(params.refreshToken, params.encryptionKey)

  const existing = await db
    .prepare('SELECT refresh_token_enc, refresh_token_iv, key_version FROM tesla_oauth_token WHERE member_id = ?')
    .bind(params.memberId)
    .first<{ refresh_token_enc: string; refresh_token_iv: string; key_version: number }>()

  if (existing) {
    await db
      .prepare(
        `UPDATE tesla_oauth_token
            SET previous_token_enc = ?, previous_token_iv = ?, previous_rotated_at = ?,
                refresh_token_enc = ?, refresh_token_iv = ?, key_version = ?,
                access_token_expires_at = ?, scope = ?, tesla_sub = COALESCE(?, tesla_sub),
                updated_at = ?, last_refreshed_at = ?, last_error = NULL, revoked_at = NULL
          WHERE member_id = ?`,
      )
      .bind(
        existing.refresh_token_enc,
        existing.refresh_token_iv,
        nowIso,
        sealed.ciphertext,
        sealed.iv,
        sealed.keyVersion,
        params.expiresAt,
        params.scope,
        params.teslaSub ?? null,
        nowIso,
        nowIso,
        params.memberId,
      )
      .run()
    return
  }

  await db
    .prepare(
      `INSERT INTO tesla_oauth_token
         (member_id, refresh_token_enc, refresh_token_iv, key_version,
          access_token_expires_at, scope, tesla_sub, created_at, updated_at, last_refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.memberId,
      sealed.ciphertext,
      sealed.iv,
      sealed.keyVersion,
      params.expiresAt,
      params.scope,
      params.teslaSub ?? null,
      nowIso,
      nowIso,
      nowIso,
    )
    .run()
}

/** Read the member's consent state, for the dashboard and for collection gating. */
export async function activeConsent(
  db: D1Database,
  memberId: string,
): Promise<{ consent_id: string; policy_version: string; policy_sha256: string | null; granted_at: string } | null> {
  return db
    .prepare(
      `SELECT consent_id, policy_version, policy_sha256, granted_at
         FROM tesla_consent
        WHERE member_id = ? AND revoked_at IS NULL
        ORDER BY granted_at DESC
        LIMIT 1`,
    )
    .bind(memberId)
    .first()
}

/**
 * Revoke consent (F01-R04, F01 AC2).
 *
 * Sets `revoked_at` on the open row and appends a new one on re-grant — the
 * append-only trigger enforces that a revoked row can never be un-revoked.
 */
export async function revokeConsent(
  db: D1Database,
  memberId: string,
  reason: string,
  nowIso = new Date().toISOString(),
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE tesla_consent
          SET revoked_at = ?, revoke_reason = ?
        WHERE member_id = ? AND revoked_at IS NULL`,
    )
    .bind(nowIso, reason, memberId)
    .run()
  return result.meta.changes ?? 0
}

/** Append an audit event (F10-R06, F01 evidence). */
export async function audit(
  db: D1Database,
  params: {
    action: string
    actor?: string | null
    actorType?: 'member' | 'admin' | 'system' | 'tesla'
    subjectType?: string
    subjectId?: string
    detail?: unknown
    nowIso?: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tesla_audit_event
         (event_id, occurred_at, actor, actor_type, action, subject_type, subject_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      params.nowIso ?? new Date().toISOString(),
      params.actor ?? null,
      params.actorType ?? 'system',
      params.action,
      params.subjectType ?? null,
      params.subjectId ?? null,
      params.detail === undefined ? null : JSON.stringify(params.detail),
    )
    .run()
}

/** Record a browser session as a pointer, so the dashboard survives KV expiry. */
export async function createSession(
  db: D1Database,
  params: { sessionId: string; memberId: string; scope: string; expiresAt: string; userAgent?: string | null; nowIso?: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tesla_auth_session
         (session_id, member_id, scope, created_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.sessionId,
      params.memberId,
      params.scope,
      params.nowIso ?? new Date().toISOString(),
      params.expiresAt,
      params.userAgent ?? null,
    )
    .run()
}
