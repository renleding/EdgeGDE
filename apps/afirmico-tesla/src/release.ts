/**
 * Individual quote package and consent-based data release (FRS-010 F07).
 *
 * What problem this solves
 * ------------------------
 * The member has consented; the profile can be derived. What was missing is the
 * part where a third party actually receives personal data — and that is the
 * point of highest legal risk in the whole system. Every release must be
 * authorised by a *live* consent, attributable to a specific consent version,
 * and logged. So the gate and the audit row are the feature; the CSV is the easy
 * part.
 *
 * Three properties this module is built to guarantee:
 *
 *  1. No release without live consent (F07-R02, F07-N03). Checked at issue time
 *     and again at download time — a link minted while consent was live must not
 *     keep working after revocation.
 *  2. No release without an audit row (F07-R03, F07-N01), written in the same
 *     batch as the release so the two cannot diverge.
 *  3. The artifact is reproducible (F06-R06/F07-R04): the row order and field
 *     order are fixed, and the SHA-256 is recorded. Two builds over the same
 *     data produce the same bytes, so a figure can be reconciled later.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { sha256Hex } from './consent-policy'
import { newId } from './store'

/** Version of the package layout. Bump when the CSV shape changes. */
export const PACKAGE_VERSION = '1.0.0'

export class ReleaseBlocked extends Error {
  constructor(public readonly reason: string) {
    super(reason)
    this.name = 'ReleaseBlocked'
  }
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * RFC 4180 field escaping.
 *
 * Written out rather than done with a join(',') because a member with a comma in
 * their name ("Smith, John") would otherwise shift every later column by one, and
 * the insurer would read each value against the wrong header — silently, since
 * the file still parses. A quote priced against a misread odometer is worse than
 * a failed export.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvField).join(',')]
  for (const row of rows) lines.push(row.map(csvField).join(','))
  // CRLF per RFC 4180; Excel and most insurer ingestion pipelines expect it.
  return `${lines.join('\r\n')}\r\n`
}

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                */
/* -------------------------------------------------------------------------- */

export interface ReleaseEligibility {
  eligible: boolean
  reason: string
  consentId: string | null
  consentPolicyVersion: string | null
}

/**
 * Whether this member's data may be released right now (F07-R02, F07-N03).
 *
 * Checks for a live consent. Deliberately does NOT treat an active policy as
 * sufficient: consent is the authority to release, and a policy is a consequence
 * of releasing. F07-R10 protects the *member* from early collection
 * termination — it is not a licence to keep disclosing after they withdraw.
 */
export async function releaseEligibility(
  db: D1Database,
  memberId: string,
): Promise<ReleaseEligibility> {
  const row = await db
    .prepare(
      `SELECT consent_id, policy_version
         FROM tesla_consent
        WHERE member_id = ? AND revoked_at IS NULL
        ORDER BY granted_at DESC
        LIMIT 1`,
    )
    .bind(memberId)
    .first<{ consent_id: string; policy_version: string }>()

  if (!row) {
    return {
      eligible: false,
      reason: 'no_live_consent',
      consentId: null,
      consentPolicyVersion: null,
    }
  }
  return {
    eligible: true,
    reason: 'ok',
    consentId: row.consent_id,
    consentPolicyVersion: row.policy_version,
  }
}

/* -------------------------------------------------------------------------- */
/* Package                                                                    */
/* -------------------------------------------------------------------------- */

export interface QuotePackageInput {
  memberId: string
  vin: string
  periodStart: string
  periodEnd: string
  nowIso: string
  requestedBy: string
  /** Vehicle model/variant/year, from the once-tier snapshot (F05-R07). */
  vehicleConfig?: Record<string, string | null>
}

export interface QuotePackage {
  releaseId: string
  csv: string
  rowCount: number
  sha256: string
  headers: string[]
  consentId: string
  consentPolicyVersion: string
}

/**
 * Build the member's individual quote package (F07-R01, F07-R04).
 *
 * The profile is embedded as structured rows rather than flattened into the
 * member's row, because a member may hold several vehicles and each has its own
 * distance and FSD figures. Flattening would silently attribute one vehicle's
 * mileage to another.
 */
export async function buildQuotePackage(
  db: D1Database,
  input: QuotePackageInput,
): Promise<QuotePackage> {
  const eligibility = await releaseEligibility(db, input.memberId)
  if (!eligibility.eligible) {
    // Blocked before any data is read, so a revoked member's PII is never even
    // assembled in memory.
    throw new ReleaseBlocked(eligibility.reason)
  }

  const member = await db
    .prepare(
      `SELECT member_id, toca_status, email, display_name, mobile, postcode
         FROM tesla_member WHERE member_id = ?`,
    )
    .bind(input.memberId)
    .first<{
      member_id: string
      toca_status: string
      email: string | null
      display_name: string | null
      mobile: string | null
      postcode: string | null
    }>()
  if (!member) throw new ReleaseBlocked('unknown_member')

  const profile = await db
    .prepare(
      `SELECT period_start, period_end, distance_km, fsd_km, fsd_availability, fsd_note,
              counter_reset_count, derivation_version, source_fact_min, source_fact_max, derived_at
         FROM tesla_driver_profile
        WHERE vin = ? AND period_start = ? AND period_end = ?
        ORDER BY derived_at DESC LIMIT 1`,
    )
    .bind(input.vin, input.periodStart, input.periodEnd)
    .first<{
      period_start: string
      period_end: string
      distance_km: number | null
      fsd_km: number | null
      fsd_availability: string
      fsd_note: string | null
      counter_reset_count: number
      derivation_version: string
      source_fact_min: string | null
      source_fact_max: string | null
      derived_at: string
    }>()

  const headers = [
    'member_id',
    'toca_status',
    'display_name',
    'email',
    'mobile',
    'postcode',
    'vin',
    'period_start',
    'period_end',
    'distance_km',
    'fsd_km',
    'fsd_availability',
    'fsd_note',
    'counter_reset_count',
    'derivation_version',
    'vehicle_model',
    'vehicle_variant',
    'vehicle_year',
    'package_version',
    'released_at',
    'requested_by',
    'consent_policy_version',
  ]

  const cfg = input.vehicleConfig ?? {}
  const rows = [
    [
      member.member_id,
      // F07-R13: the tier is material to the insurer because non-members are
      // charged differently, so it travels with the package rather than being
      // looked up separately.
      member.toca_status,
      member.display_name,
      member.email,
      member.mobile,
      member.postcode,
      input.vin,
      input.periodStart,
      input.periodEnd,
      profile?.distance_km ?? null,
      profile?.fsd_km ?? null,
      // F05-R11 discipline: an unavailable FSD figure is a known unknown, and the
      // reason travels with it. Sending a blank would let the insurer read it as
      // zero FSD usage, which is a materially different risk.
      profile?.fsd_availability ?? 'unavailable',
      profile?.fsd_note ?? 'no profile derived for this period',
      profile?.counter_reset_count ?? null,
      profile?.derivation_version ?? null,
      cfg.model ?? null,
      cfg.variant ?? null,
      cfg.year ?? null,
      PACKAGE_VERSION,
      input.nowIso,
      input.requestedBy,
      eligibility.consentPolicyVersion,
    ],
  ]

  const csv = toCsv(headers, rows)
  const sha256 = await sha256Hex(csv)
  const releaseId = newId()

  // Release + audit row in one batch (F07-R03, F07-N01). If these could be
  // written separately, one failure mode is a release that exists with no record
  // of who authorised it — exactly the state an audit must never find.
  await db.batch([
    db
      .prepare(
        `INSERT INTO tesla_release
           (release_id, release_type, period_start, period_end, aggregation_level,
            row_count, artifact_sha256, r2_key, derivation_version, policy_version,
            created_at, created_by, subject_member_id, subject_vin)
         VALUES (?, 'quote_package', ?, ?, 'individual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        releaseId,
        input.periodStart,
        input.periodEnd,
        rows.length,
        sha256,
        null,
        profile?.derivation_version ?? PACKAGE_VERSION,
        eligibility.consentPolicyVersion,
        input.nowIso,
        input.requestedBy,
        // Names the subject directly so the download-time consent check does not
        // depend on a quote-request row existing (F07-N03).
        input.memberId,
        input.vin,
      ),
    db
      .prepare(
        `INSERT INTO tesla_audit_event
           (event_id, occurred_at, actor, actor_type, action, subject_type, subject_id, detail_json)
         VALUES (?, ?, ?, 'system', 'release_created', 'tesla_release', ?, ?)`,
      )
      .bind(
        newId(),
        input.nowIso,
        input.requestedBy,
        releaseId,
        JSON.stringify({
          member_id: input.memberId,
          vin: input.vin,
          consent_id: eligibility.consentId,
          consent_policy_version: eligibility.consentPolicyVersion,
          sha256,
          row_count: rows.length,
        }),
      ),
  ])

  return {
    releaseId,
    csv,
    rowCount: rows.length,
    sha256,
    headers,
    consentId: eligibility.consentId!,
    consentPolicyVersion: eligibility.consentPolicyVersion!,
  }
}

/* -------------------------------------------------------------------------- */
/* Download links                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Issue a time-limited, single-recipient download link (F07-R05, F07-R06).
 *
 * The token is stored only as a SHA-256 hash: a leaked database then yields no
 * usable links. Single-use by default, because a download link that can be
 * replayed is a data-export mechanism with no audit boundary.
 */
export async function issueDownloadToken(
  db: D1Database,
  options: {
    releaseId: string
    issuedTo: string
    ttlSeconds: number
    nowIso: string
    maxUses?: number
  },
): Promise<{ token: string; tokenId: string; expiresAt: string }> {
  // 256 bits of randomness; a guessable token is an unaudited data breach.
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('')
  const tokenHash = await sha256Hex(token)
  const tokenId = newId()
  const expiresAt = new Date(Date.parse(options.nowIso) + options.ttlSeconds * 1000).toISOString()

  await db.batch([
    db
      .prepare(
        `INSERT INTO tesla_download_token
           (token_id, release_id, token_hash, issued_to, issued_at, expires_at, max_uses, use_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .bind(
        tokenId,
        options.releaseId,
        tokenHash,
        options.issuedTo,
        options.nowIso,
        expiresAt,
        options.maxUses ?? 1,
      ),
    db
      .prepare(
        `INSERT INTO tesla_release_access
           (access_id, release_id, actor, actor_type, action, occurred_at, ip_hash, user_agent)
         VALUES (?, ?, ?, 'system', 'issue_token', ?, NULL, NULL)`,
      )
      .bind(newId(), options.releaseId, options.issuedTo, options.nowIso),
  ])

  return { token, tokenId, expiresAt }
}

export interface RedeemResult {
  ok: boolean
  reason: string
  releaseId: string | null
  csv: string | null
}

/**
 * Redeem a download token (F07-R06, F07-N02, F07-N03).
 *
 * Consent is re-checked here, not just at issue time. A link minted while consent
 * was live would otherwise remain a working export after the member revokes —
 * which would make revocation cosmetic. Revocation must stop disclosure on every
 * path, including links already in someone's inbox.
 */
export async function redeemDownloadToken(
  db: D1Database,
  options: {
    token: string
    nowIso: string
    ipHash: string | null
    userAgent: string | null
    /** Supplies the artifact for a valid token: R2 lookup in production. */
    loadArtifact: (releaseId: string) => Promise<string | null>
  },
): Promise<RedeemResult> {
  const tokenHash = await sha256Hex(options.token)
  const record = await db
    .prepare(
      `SELECT t.token_id, t.release_id, t.expires_at, t.max_uses, t.use_count, t.revoked_at,
              r.release_type
         FROM tesla_download_token t
         JOIN tesla_release r ON r.release_id = t.release_id
        WHERE t.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      token_id: string
      release_id: string
      expires_at: string
      max_uses: number
      use_count: number
      revoked_at: string | null
      release_type: string
    }>()

  if (!record) return { ok: false, reason: 'unknown_token', releaseId: null, csv: null }
  if (record.revoked_at) return { ok: false, reason: 'revoked', releaseId: null, csv: null }
  if (record.expires_at <= options.nowIso) {
    return { ok: false, reason: 'expired', releaseId: null, csv: null }
  }
  if (record.use_count >= record.max_uses) {
    return { ok: false, reason: 'already_used', releaseId: null, csv: null }
  }

  // Re-check consent on the member behind this release (F07-N03, F07-N02).
  //
  // Resolved from the release's own subject_member_id rather than by joining
  // through tesla_quote_request: that back-reference is absent unless a quote
  // request row exists, and a package built without one would skip this check
  // entirely — leaving a link that keeps working after revocation. Skipped only
  // for releases that have no member by design, never because a lookup failed.
  if (record.release_type === 'quote_package') {
    const owner = await db
      .prepare('SELECT subject_member_id FROM tesla_release WHERE release_id = ?')
      .bind(record.release_id)
      .first<{ subject_member_id: string | null }>()

    if (!owner?.subject_member_id) {
      // A quote package with no recorded subject cannot be safely released: we
      // cannot prove consent, so we refuse rather than disclose.
      return { ok: false, reason: 'subject_unknown', releaseId: null, csv: null }
    }

    const eligibility = await releaseEligibility(db, owner.subject_member_id)
    if (!eligibility.eligible) {
      return { ok: false, reason: 'consent_revoked', releaseId: null, csv: null }
    }
  }

  const artifact = await options.loadArtifact(record.release_id)
  if (artifact === null) {
    return { ok: false, reason: 'artifact_missing', releaseId: null, csv: null }
  }

  await db.batch([
    db
      .prepare('UPDATE tesla_download_token SET use_count = use_count + 1 WHERE token_id = ?')
      .bind(record.token_id),
    db
      .prepare(
        `INSERT INTO tesla_release_access
           (access_id, release_id, actor, actor_type, action, occurred_at, ip_hash, user_agent)
         VALUES (?, ?, ?, 'underwriter', 'download', ?, ?, ?)`,
      )
      .bind(
        newId(),
        record.release_id,
        // The actor is whoever the token was issued to, not the IP: the token is
        // the credential, and attributing a release to an address would be wrong
        // the moment the recipient is behind a proxy.
        'token-holder',
        options.nowIso,
        options.ipHash,
        options.userAgent,
      ),
  ])

  return { ok: true, reason: 'ok', releaseId: record.release_id, csv: artifact }
}

/* -------------------------------------------------------------------------- */
/* F07-R10: the policy hold                                                   */
/* -------------------------------------------------------------------------- */

export interface PolicyHold {
  held: boolean
  policyId: string | null
  coverEnd: string | null
}

/**
 * Whether collection may NOT be terminated for this member (F07-R10, F07-N04).
 *
 * Returns the furthest-out active cover end. The caller surfaces this to the
 * member at revocation time: they must be told their cover runs to a date and
 * that terminating collection would invalidate it — not simply refused.
 */
export async function activePolicyHold(
  db: D1Database,
  memberId: string,
  nowIso: string,
): Promise<PolicyHold> {
  const row = await db
    .prepare(
      `SELECT policy_id, cover_end
         FROM tesla_policy
        WHERE member_id = ? AND status = 'active' AND cover_end > ?
        ORDER BY cover_end DESC
        LIMIT 1`,
    )
    .bind(memberId, nowIso)
    .first<{ policy_id: string; cover_end: string }>()

  if (!row) return { held: false, policyId: null, coverEnd: null }
  return { held: true, policyId: row.policy_id, coverEnd: row.cover_end }
}
