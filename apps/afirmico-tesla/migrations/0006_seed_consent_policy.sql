-- Seed the current consent policy text (FRS-010 F01-R02/R03, F01 AC5).
--
-- GENERATED FILE - do not edit by hand.
-- Regenerate with: python3 scripts/build-consent-seed.py
--
-- The text below is extracted verbatim from src/consent-policy.ts. F01 AC5
-- requires the member portal to show the exact text the member agreed to, so
-- this copy exists to make the audit record self-contained: a consent row whose
-- text can only be recovered from git history is not evidence.
--
-- `execute-schema.sh` asserts this row's hash matches the hash computed from
-- src/consent-policy.ts, so the two cannot silently diverge.
--



INSERT INTO tesla_consent_policy
  (policy_version, policy_sha256, policy_text, effective_from, created_at)
VALUES
  ('2026-10-02.1', 'ccf9b5cd8f868339fca3e8aea5d761f7a6471205c5762c3412888cbc5da68fa6', 'AFIRMICO Auto — Authorisation to collect and disclose vehicle data

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
Data is pushed by your vehicle to AFIRMICO''s receiver on a 6-hour refresh. Your
vehicle key must be approved by you in the Tesla app before any data flows.

WHO IT IS DISCLOSED TO
Your data is disclosed to insurers and their underwriters for the purpose of
obtaining offers for you. It is disclosed only where you have asked AFIRMICO to
seek offers on your behalf. Where data identifies you, it is disclosed only to
underwriters considering your application; statistics shared more widely are
aggregated by residential postcode and contain no identifying information.

WHERE IT IS HELD
Data is held in Australia and in the United States (Tesla''s Fleet API and
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

By continuing you confirm you have read and agree to this authorisation.',
   '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z')
ON CONFLICT (policy_version) DO UPDATE SET
  policy_sha256 = excluded.policy_sha256,
  policy_text   = excluded.policy_text;
