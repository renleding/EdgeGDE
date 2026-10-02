#!/usr/bin/env python3
"""
Generate the consent-policy seed migration (FRS-010 F01-R03, F01 AC5).

Why generated rather than hand-written
--------------------------------------
The consent text lives in `src/consent-policy.ts` and must be byte-identical in
three places: the file, the `tesla_consent_policy` row, and the hash recorded on
each member's consent row. Hand-copying it into SQL guarantees eventual drift,
and drift here is not a cosmetic bug — F01 AC5 requires the member to be shown
the exact text they agreed to, so a drifted copy means the audit record no longer
proves what was agreed.

This script reads the TypeScript source, extracts the template literal, and emits
the INSERT with its hash computed from the same bytes. `verify-store.ts` then
asserts the round-trip, so a divergence fails CI rather than surfacing as an
unexplained STALE_TEXT_HASH in `/healthz`.

Usage:
  python3 scripts/build-consent-seed.py
"""

from __future__ import annotations

import hashlib
import pathlib
import re
import sys

HEADER = """-- Seed the current consent policy text (FRS-010 F01-R02/R03, F01 AC5).
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


"""


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    here = pathlib.Path(__file__).resolve().parent.parent
    src_path = here / "src" / "consent-policy.ts"
    src = src_path.read_text(encoding="utf-8")

    version = re.search(r"CONSENT_POLICY_VERSION\s*=\s*'([^']+)'", src)
    text = re.search(r"export const CONSENT_TEXT = `(.*?)`\n", src, re.S)
    if not version or not text:
        print("error: could not extract version/consent text from src/consent-policy.ts",
              file=sys.stderr)
        return 2

    policy_version = version.group(1)
    policy_text = text.group(1)
    sha = hashlib.sha256(policy_text.encode("utf-8")).hexdigest()

    out = [
        HEADER,
        "INSERT INTO tesla_consent_policy",
        "  (policy_version, policy_sha256, policy_text, effective_from, created_at)",
        "VALUES",
        f"  ({sql_str(policy_version)}, {sql_str(sha)}, {sql_str(policy_text)},",
        "   '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z')",
        "ON CONFLICT (policy_version) DO UPDATE SET",
        "  policy_sha256 = excluded.policy_sha256,",
        "  policy_text   = excluded.policy_text;",
        "",
    ]

    out_path = here / "migrations" / "0006_seed_consent_policy.sql"
    out_path.write_text("\n".join(out), encoding="utf-8")

    print(f"policy_version  {policy_version}")
    print(f"policy_sha256   {sha}")
    print(f"text bytes      {len(policy_text.encode('utf-8'))}")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
