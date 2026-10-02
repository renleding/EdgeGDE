/**
 * Consent policy text (FRS-010 F01-R02, F01-R03, F01 AC5, F01 AC6).
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
 *
 * WHY THIS TEXT IS BROAD (F01-R02a, owner decision 2026-10-03)
 * -----------------------------------------------------------
 * The authorisation covers the information made available through the member's
 * authorised Tesla connection, plus the products and services AFIRMICO offers —
 * it does not enumerate a closed list of fields. It previously said "Only two
 * numbers are collected" while the platform collected fourteen fields (F04-R01a),
 * so the disclosure was narrower than the collection. That was recorded as R-15
 * and resolved by the owner on 2026-10-03 in favour of a broad authorisation,
 * on the instruction that it "needs to be broad enough to cover any of the
 * fields" and that "we don't have to list specific fields".
 *
 * What this buys, operationally: changing which fields are collected — narrowing,
 * or widening back within the authorised connection — is NOT a change to the
 * consent members have already given, so it neither invalidates their consent nor
 * forces re-authorisation. A closed field list would have made every such change
 * a consent event.
 *
 * `CONSENTED_FIELDS` below is therefore NOT the consent scope. It is the set the
 * application currently collects, kept in sync with the catalog (`collected = 1`)
 * and asserted by F01 AC6, which fails the build if the two ever drift.
 *
 * OWNER-INSTRUCTED DELETION (2026-10-03): the "WHERE INFORMATION IS HELD" clause
 * names jurisdictions and Tesla but deliberately does NOT name Cloudflare. The
 * owner instructed the Cloudflare reference be removed from the text. The
 * underlying technical fact is unchanged — the Worker runs on Cloudflare
 * infrastructure in the United States — so this is a difference between what the
 * text says and where the data actually is, recorded here rather than left
 * implicit. The cross-border disclosure statement itself (APP 8) is retained.
 */

/** The current consent policy version. Bump on ANY change to CONSENT_TEXT. */
export const CONSENT_POLICY_VERSION = '2026-10-03.2'

/**
 * The consent the member grants. Deliberately modelled on a credit-assistance
 * style standing authorisation: no fixed expiry, revocable at any time (F01-R02).
 */
export const CONSENT_TEXT = `AFIRMICO Auto — Authorisation to Collect, Use and Disclose Data
PURPOSE

You authorise AFIRMICO Auto (AFIRMICO) to collect, use and disclose data obtained from your Tesla account, Tesla vehicle, associated Tesla services and related sources for the purpose of assessing eligibility for, obtaining, administering, renewing, improving, marketing and providing products, services, offers, benefits and programs.

This authorisation includes the provision of insurance, finance, energy, charging, automotive, membership, loyalty and other related products, services and benefits.

This is a standing authorisation. It has no fixed expiry and continues until you withdraw it.

WHAT INFORMATION MAY BE COLLECTED

AFIRMICO may collect information made available through your authorised connection with Tesla and related services, including information relating to your vehicle, vehicle configuration, ownership, usage, operation, energy products, charging, memberships and other connected services.

The information collected may vary from time to time as AFIRMICO's products and services evolve.

AFIRMICO will only collect information that is reasonably required to provide, evaluate, improve or administer products, services, offers, benefits and programs.

HOW INFORMATION IS COLLECTED

Information may be collected from Tesla APIs, Tesla-connected services, approved integrations, participating partners and other data sources authorised by you.

Collection may occur periodically, on request, automatically, or in connection with applications, quotes, renewals, products, services and benefits.

Your Tesla account and vehicle access must be authorised by you before information can be collected.

WHO INFORMATION MAY BE DISCLOSED TO

AFIRMICO may disclose information to participating third parties for purposes reasonably connected with the provision, evaluation, administration, renewal, marketing or delivery of products, services, offers, benefits and programs.

Participating third parties may include:

insurers;
brokers;
underwriting agencies;
underwriters;
finance providers;
lenders;
energy retailers;
electricity providers;
solar providers;
charging service providers;
automotive service providers;
membership organisations;
loyalty and affinity partners;
technology providers;
analytics providers; and
other current or future AFIRMICO partners.

Where practical, AFIRMICO may use aggregated, anonymised or de-identified information. Where personally identifiable information is required to obtain or administer a product, service, quote, renewal or benefit, AFIRMICO may disclose the information necessary for that purpose.

WHERE INFORMATION IS HELD

Information may be stored, processed or transmitted in Australia and overseas, including in jurisdictions in which Tesla and other participating service providers operate.

This may constitute a cross-border disclosure for the purposes of the Australian Privacy Principles.

YOUR RIGHTS
You may withdraw this authorisation at any time through AFIRMICO or by revoking access through your Tesla account.
Upon withdrawal, AFIRMICO will cease future collection of information associated with that authorisation.
You may request access to information held about you, subject to applicable laws and operational requirements.
You may request correction of inaccurate information.
AFIRMICO may retain information where reasonably necessary to comply with legal obligations, administer products or services, resolve disputes, prevent fraud, maintain audit records or satisfy regulatory requirements.
AFIRMICO may retain aggregated, anonymised or de-identified information that does not identify you.
CONSENT

By continuing, you acknowledge that you have read and understood this authorisation and expressly consent to AFIRMICO collecting, using and disclosing information as described above.`

/**
 * The field set the application CURRENTLY collects — NOT the consent scope.
 *
 * The authorisation above (F01-R02a) is deliberately broad and covers any field
 * in the enabled data stream, so this list is free to change without invalidating
 * anyone's consent. It exists to keep three representations in agreement: this
 * array, the catalog rows with `collected = 1` in `tesla_field_catalog`, and the
 * field set recorded on each consent row (`tesla_consent.collected_fields`).
 *
 * F01 AC6 (Must) fails the build when the first two disagree, and a stored
 * consent row created under the current policy version whose recorded set does
 * not match this one. That is the gate R-10 found missing.
 *
 * Must match `SELECT field_key FROM tesla_field_catalog WHERE collected = 1`.
 */
export const CONSENTED_FIELDS = [
  'Odometer',
  'MilesSinceReset',
  'SelfDrivingMilesSinceReset',
  'CarType',
  'Version',
  'EfficiencyPackage',
  'AutomaticBlindSpotCamera',
  'SpeedLimitMode',
  'SpeedLimitWarning',
  'SentryMode',
  'AutomaticEmergencyBrakingOff',
  'BlindSpotCollisionWarningChime',
  'EmergencyLaneDepartureAvoidance',
  'PinToDriveEnabled',
] as const

/** Purposes recorded on the consent row. */
export const CONSENT_PURPOSES = ['insurance'] as const

const encoder = new TextEncoder()

/** SHA-256 of a string, lowercase hex. Matches SQLite's sha256 hex form. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
