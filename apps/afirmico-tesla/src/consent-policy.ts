/**
 * Consent policy text (FRS-010 F01-R02, F01-R03, F01 AC5).
 *
 * This file is the consent text the member agrees to. It is versioned, committed
 * and reviewable — a change to it is a diff, which is the point. F01 AC5 requires
 * the portal to show the member the exact text they agreed to, byte-identical to
 * what was stored, so the text lives here and its SHA-256 is recorded on the
 * consent row (`tesla_consent.policy_sha256`) and in `tesla_consent_policy`.
 *
 * The hash below is asserted by a unit test against this file's contents. If the
 * text is edited without bumping the version and the hash, that test fails —
 * which is the only way to keep a consent history honest.
 */

/** The current consent policy version. Bump on ANY change to CONSENT_TEXT. */
export const CONSENT_POLICY_VERSION = '2026-10-02.1'

/**
 * The consent the member grants. Deliberately modelled on a credit-assistance
 * style standing authorisation: no fixed expiry, revocable at any time (F01-R02).
 */
export const CONSENT_TEXT = `AFIRMICO Auto — Authorisation to collect and disclose vehicle data

PURPOSE
You are authorising AFIRMICO Auto (AFIRMICO) to collect a limited set of data
from your Tesla vehicle and to disclose that data to insurers and their
underwriters for the purpose of obtaining motor insurance offers for you.

This is a standing authorisation. It has no fixed expiry and continues until you
withdraw it.

WHAT IS COLLECTED
Only two numbers are collected from your vehicle:
  - total kilometres driven (odometer); and
  - the number of those kilometres driven on Full Self-Driving (FSD).

No location, no speed, no driving behaviour, no media, no climate settings, and
no charging history is collected. AFIRMICO does not request, and cannot use, any
ability to send commands to your vehicle.

HOW IT IS COLLECTED
Data is pushed by your vehicle to AFIRMICO's receiver on a 6-hour refresh. Your
vehicle key must be approved by you in the Tesla app before any data flows.

WHO IT IS DISCLOSED TO
Your data is disclosed to insurers and their underwriters for the purpose of
obtaining offers for you. It is disclosed only where you have asked AFIRMICO to
seek offers on your behalf. Where data identifies you, it is disclosed only to
underwriters considering your application; statistics shared more widely are
aggregated by residential postcode and contain no identifying information.

WHERE IT IS HELD
Data is held in Australia and in the United States (Tesla's Fleet API and
Cloudflare infrastructure). This is a cross-border disclosure for the purposes of
Australian Privacy Principle 8.

YOUR RIGHTS
  - You may withdraw this authorisation at any time, from this site or from your
    Tesla account. Collection stops immediately.
  - If you hold no insurance policy obtained through AFIRMICO, your individual
    data is deleted when you withdraw.
  - If you hold a policy obtained through AFIRMICO, your data is retained until
    that policy expires, and then deleted.
  - You may ask to see the current state of this authorisation, the data
    collected, and the parties who have received it.
  - Anonymised postcode-level statistics are retained after deletion, as they
    contain no information that identifies you.

By continuing you confirm you have read and agree to this authorisation.`

/**
 * Field set covered by this consent, as `field_key` values from
 * `tesla_field_catalog` (F04-R01a: odometer + FSD only).
 */
export const CONSENTED_FIELDS = [
  'Odometer',
  'MilesSinceReset',
  'SelfDrivingMilesSinceReset',
] as const

/** Purposes recorded on the consent row. */
export const CONSENT_PURPOSES = ['insurance'] as const

const encoder = new TextEncoder()

/** SHA-256 of a string, lowercase hex. Matches SQLite's sha256 hex form. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
