/**
 * Member details collection (FRS-010 F01-R05).
 *
 * Why this module has to exist
 * ---------------------------
 * `tesla_member.mobile` and `.postcode` were added in migration 0005, but nothing
 * ever writes them. The Tesla OAuth handshake returns a subject, an email and a
 * name — none of which is a phone number or a postcode. So without this step every
 * member row stays incomplete, the insurer package (F07-R01) ships a blank where
 * the insurer expects contact details, and F06 group aggregates cannot segment on
 * postcode at all.
 *
 * The two failure modes this is written against
 * --------------------------------------------
 * 1. **A postcode losing its leading zero.** Australian postcodes include `0200`
 *    (ANU/ACT) and `0800` (NT). Stored through anything that coerces to a number,
 *    `0800` becomes `800`, which is not a postcode — it is a phantom bucket that
 *    silently aggregates Northern Territory members with nobody. Both normalisers
 *    therefore return `string`, never `number`, and there is a test pinning it.
 *
 * 2. **One human becoming two members.** `0412 345 678`, `+61 412 345 678` and
 *    `0412345678` are the same number. Stored as typed, one member's enquiries
 *    split across three spellings and the same person can be matched to two
 *    records. So input is normalised to one canonical form before storage.
 */

import type { D1Database } from '@cloudflare/workers-types'

/**
 * Canonical Australian mobile, or null if the input is not one.
 *
 * Accepts the spellings people actually type — `0412 345 678`, `0412-345-678`,
 * `+61 412 345 678`, `61412345678`, `(04) 1234 5678` — and returns `+61412345678`.
 * E.164 with the `+` is the one form that cannot be confused with a local number.
 *
 * Deliberately strict about the prefix: Australian mobile numbers are `04xx`.
 * `05xx` is not allocated to mobiles, and accepting it would store a number that
 * cannot receive an SMS, which is worse than rejecting it and saying so.
 */
export function normaliseMobileAu(input: string): string | null {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return null

  // Keep an explicit international prefix, drop every separator humans insert.
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^\d]/g, '')

  // National significant number: AU mobiles are 9 digits when the trunk zero is
  // dropped (412 345 678) and 10 when it is present (0412 345 678). Getting this
  // length wrong is how a valid international number gets rejected.
  let national: string
  if (hasPlus) {
    // +61 412 345 678 -> 412345678 ; +61412345678 -> same
    if (!digits.startsWith('61')) return null
    national = digits.slice(2)
  } else if (digits.startsWith('61') && digits.length === 11) {
    // 61412345678 without the plus: only treat as international when the length
    // proves it, otherwise a local number that happens to start 61 is mangled.
    national = digits.slice(2)
  } else {
    national = digits
  }

  // Accept both forms, then require the mobile prefix `4`.
  const local = national.startsWith('0') ? national.slice(1) : national
  if (local.length !== 9 || !local.startsWith('4')) return null

  return `+61${local}`
}

/**
 * Canonical Australian postcode, or null if the input is not one.
 *
 * Returns the 4-character string exactly as entered once validated — leading zero
 * preserved. Valid Australian postcodes run `0200`–`9999`; `0000`–`0199` are not
 * allocated, so a `0100` is a typo rather than a real location and is rejected
 * rather than stored as a bucket that will never be joined to a real place.
 */
export function normalisePostcodeAu(input: string): string | null {
  const trimmed = (input ?? '').trim()
  if (!/^\d{4}$/.test(trimmed)) return null

  const value = Number.parseInt(trimmed, 10)
  if (value < 200 || value > 9999) return null

  return trimmed
}

/** Reason a member's details are not yet usable for release or aggregation. */
export type DetailGap = 'mobile' | 'postcode'

/**
 * Which of the required details are still missing.
 *
 * Reads the stored values rather than trusting a submitted form, because the
 * dashboard and the release path both need to know the true state — and a member
 * can revoke or correct details at any time.
 */
export async function memberDetailGaps(
  db: D1Database,
  memberId: string,
): Promise<DetailGap[]> {
  const row = await db
    .prepare('SELECT mobile, postcode FROM tesla_member WHERE member_id = ?')
    .bind(memberId)
    .first<{ mobile: string | null; postcode: string | null }>()

  if (!row) return ['mobile', 'postcode']

  const gaps: DetailGap[] = []
  if (!row.mobile) gaps.push('mobile')
  if (!row.postcode) gaps.push('postcode')
  return gaps
}

/** Thrown when a submitted detail fails validation. Carries which field, for the form. */
export class InvalidDetail extends Error {
  constructor(public readonly field: DetailGap, public readonly value: string) {
    super(`invalid ${field}`)
    this.name = 'InvalidDetail'
  }
}

export interface SaveDetailsResult {
  mobile: string
  postcode: string
  changed: boolean
}

/**
 * Validate and persist a member's mobile and postcode.
 *
 * Both fields are required together: a half-completed profile is the state that
 * makes the release path ambiguous, so partial submission is refused rather than
 * stored. This does not overwrite a value with an identical one, so re-submitting
 * the same form does not churn the audit trail.
 */
export async function saveMemberDetails(
  db: D1Database,
  params: { memberId: string; mobile: string; postcode: string; nowIso?: string },
): Promise<SaveDetailsResult> {
  const mobile = normaliseMobileAu(params.mobile)
  if (!mobile) throw new InvalidDetail('mobile', params.mobile)

  const postcode = normalisePostcodeAu(params.postcode)
  if (!postcode) throw new InvalidDetail('postcode', params.postcode)

  const nowIso = params.nowIso ?? new Date().toISOString()

  const current = await db
    .prepare('SELECT mobile, postcode FROM tesla_member WHERE member_id = ?')
    .bind(params.memberId)
    .first<{ mobile: string | null; postcode: string | null }>()
  if (!current) throw new Error(`unknown member: ${params.memberId}`)

  const changed = current.mobile !== mobile || current.postcode !== postcode
  if (!changed) return { mobile, postcode, changed: false }

  await db
    .prepare('UPDATE tesla_member SET mobile = ?, postcode = ?, updated_at = ? WHERE member_id = ?')
    .bind(mobile, postcode, nowIso, params.memberId)
    .run()

  return { mobile, postcode, changed: true }
}
