-- Seed consent policy version 2026-10-03.2 (FRS-010 F01-R02/R03, F01 AC5, F01 AC6).
--
-- GENERATED FILE - do not edit by hand.
-- Regenerate with: python3 scripts/build-consent-seed.py
--
-- The text below is extracted verbatim from src/consent-policy.ts. F01 AC5
-- requires the member portal to show the exact text the member agreed to, so
-- this copy exists to make the audit record self-contained: a consent row whose
-- text can only be recovered from git history is not evidence.
--
-- `verify-store.ts` asserts this row's hash matches the hash computed from
-- src/consent-policy.ts, so the two cannot silently diverge.
--
-- Earlier versions are superseded, not deleted: a member who consented under
-- 2026-10-02.1 must remain auditable against the text they actually agreed to.
--



INSERT INTO tesla_consent_policy
  (policy_version, policy_sha256, policy_text, effective_from, created_at)
VALUES
  ('2026-10-03.2', '8a3781566209596a240ce4e643dbcbb3719272ec2fac72a47b1f23b7c1587c90', 'AFIRMICO Auto — Authorisation to Collect, Use and Disclose Data
PURPOSE

You authorise AFIRMICO Auto (AFIRMICO) to collect, use and disclose data obtained from your Tesla account, Tesla vehicle, associated Tesla services and related sources for the purpose of assessing eligibility for, obtaining, administering, renewing, improving, marketing and providing products, services, offers, benefits and programs.

This authorisation includes the provision of insurance, finance, energy, charging, automotive, membership, loyalty and other related products, services and benefits.

This is a standing authorisation. It has no fixed expiry and continues until you withdraw it.

WHAT INFORMATION MAY BE COLLECTED

AFIRMICO may collect information made available through your authorised connection with Tesla and related services, including information relating to your vehicle, vehicle configuration, ownership, usage, operation, energy products, charging, memberships and other connected services.

The information collected may vary from time to time as AFIRMICO''s products and services evolve.

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

By continuing, you acknowledge that you have read and understood this authorisation and expressly consent to AFIRMICO collecting, using and disclosing information as described above.',
   '2026-10-03T00:00:00Z', '2026-10-03T00:00:00Z')
ON CONFLICT (policy_version) DO UPDATE SET
  policy_sha256 = excluded.policy_sha256,
  policy_text   = excluded.policy_text;

-- Supersede every earlier version that is not already marked superseded.
UPDATE tesla_consent_policy
   SET superseded_at = '2026-10-03T00:00:00Z'
 WHERE policy_version <> '2026-10-03.2'
   AND superseded_at IS NULL;
