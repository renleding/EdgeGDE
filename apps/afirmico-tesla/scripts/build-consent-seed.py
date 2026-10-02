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

Why a NEW migration per version (not an edit to the old one)
------------------------------------------------------------
A migration that has already been applied is history. `0006_seed_consent_policy.sql`
seeded version `2026-10-02.1` and IS APPLIED in production; editing it would change
a fresh database but change nothing in the deployed one, so `/healthz` would report
`STALE_TEXT_HASH` forever while CI stayed green. Each new consent version therefore
gets its own migration, and the previous text is left exactly as it was — which is
also the correct audit behaviour: the superseded text stays recoverable.

This script therefore:
  1. reads the current version + text from src/consent-policy.ts,
  2. reuses the migration file that already carries this version (idempotent
     regeneration), or allocates the next free NNNN,
  3. emits the INSERT plus a supersede UPDATE for every earlier version.

`verify-store.ts` then asserts the round-trip, so a divergence fails CI rather
than surfacing as an unexplained STALE_TEXT_HASH in `/healthz`.

Usage:
  python3 scripts/build-consent-seed.py
"""

from __future__ import annotations

import hashlib
import pathlib
import re
import sys

HEADER = """-- Seed consent policy version {version} (FRS-010 F01-R02/R03, F01 AC5, F01 AC6).
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


"""


def sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _is_tracked(path: pathlib.Path, repo_root: pathlib.Path) -> bool:
    """A tracked migration is (or will be) applied; an untracked one is not yet."""
    import subprocess

    return (
        subprocess.run(
            ["git", "ls-files", "--error-unmatch", str(path.relative_to(repo_root))],
            cwd=repo_root,
            capture_output=True,
        ).returncode
        == 0
    )


def target_migration(migdir: pathlib.Path, policy_version: str) -> pathlib.Path:
    """Pick the migration file this version's INSERT belongs in.

    Order matters, and getting it wrong silently creates dead migrations:

    1. Reuse a file that already carries THIS exact version (idempotent re-run).
    2. Else reuse the highest-numbered UNTRACKED `*_seed_consent_policy.sql`.
       An untracked migration has never been pushed, so it has never been applied
       on main — it is still this change's own file, and editing it is correct.
       Allocating a new number instead would leave the previous one behind as a
       second, contradictory seed for the same slot (and CI would apply both).
    3. Else allocate the next free NNNN.
    """
    existing = sorted(migdir.glob("*_seed_consent_policy.sql"))
    for path in existing:
        if sql_str(policy_version) in path.read_text(encoding="utf-8"):
            return path

    repo_root = migdir.resolve().parent.parent.parent
    untracked = [p for p in existing if not _is_tracked(p, repo_root)]
    if untracked:
        return untracked[-1]

    numbers = [int(m.group(1)) for p in migdir.glob("*.sql") if (m := re.match(r"(\d{4})_", p.name))]
    return migdir / f"{max(numbers, default=0) + 1:04d}_seed_consent_policy.sql"


def main() -> int:
    here = pathlib.Path(__file__).resolve().parent.parent
    migdir = here / "migrations"
    src_path = here / "src" / "consent-policy.ts"
    src = src_path.read_text(encoding="utf-8")

    version = re.search(r"CONSENT_POLICY_VERSION\s*=\s*'([^']+)'", src)
    text = re.search(r"export const CONSENT_TEXT = `(.*?)`\n", src, re.S)
    if not version or not text:
        print(
            "error: could not extract version/consent text from src/consent-policy.ts",
            file=sys.stderr,
        )
        return 2

    policy_version = version.group(1)
    policy_text = text.group(1)
    sha = hashlib.sha256(policy_text.encode("utf-8")).hexdigest()

    out_path = target_migration(migdir, policy_version)

    out = [
        HEADER.format(version=policy_version),
        "INSERT INTO tesla_consent_policy",
        "  (policy_version, policy_sha256, policy_text, effective_from, created_at)",
        "VALUES",
        f"  ({sql_str(policy_version)}, {sql_str(sha)}, {sql_str(policy_text)},",
        "   '2026-10-03T00:00:00Z', '2026-10-03T00:00:00Z')",
        "ON CONFLICT (policy_version) DO UPDATE SET",
        "  policy_sha256 = excluded.policy_sha256,",
        "  policy_text   = excluded.policy_text;",
        "",
        "-- Supersede every earlier version that is not already marked superseded.",
        "UPDATE tesla_consent_policy",
        "   SET superseded_at = '2026-10-03T00:00:00Z'",
        " WHERE policy_version <> " + sql_str(policy_version),
        "   AND superseded_at IS NULL;",
        "",
    ]

    out_path.write_text("\n".join(out), encoding="utf-8")

    print(f"policy_version  {policy_version}")
    print(f"policy_sha256   {sha}")
    print(f"text bytes      {len(policy_text.encode('utf-8'))}")
    print(f"wrote {out_path.relative_to(here)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
