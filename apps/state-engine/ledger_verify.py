"""Ledger integrity verification — FRS-007 FEATURE-01 (F01-R07, F01-R09, F01-R12).

Recomputes the hash chain across ledger files (including rotated files) and
reports: total entries, verified count, legacy-unverifiable count, the first
invalid entry index, and the failure reason (payload mismatch | chain break |
unparseable line).

Legacy entries (written before hash chaining) are classified legacy_unverifiable,
never tampered (F01-R09). The chain resumes at the first hashed entry.
"""
import glob
import json
import os
import sys
from typing import Optional

from action_journal import JOURNAL_PATH, canonical_serialize, sha256_hex


def discover_ledger_files(active_path: str = JOURNAL_PATH) -> list:
    """Return rotated files (oldest first) followed by the active file."""
    rotated = sorted(glob.glob(f"{active_path}.*"))
    active = [active_path] if os.path.exists(active_path) else []
    return rotated + active


def verify(paths: Optional[list] = None) -> dict:
    """Recompute the chain and return a LedgerReport dict.

    Report keys:
      total_entries, verified, legacy_unverifiable, first_invalid_index,
      failure_reason, integrity_ok
    """
    paths = paths if paths is not None else discover_ledger_files()

    total = 0
    verified = 0
    legacy = 0
    first_invalid_index: Optional[int] = None
    failure_reason: Optional[str] = None

    prev_entry_hash: Optional[str] = None  # entry_hash of the last verified entry

    for path in paths:
        try:
            with open(path) as f:
                lines = f.readlines()
        except FileNotFoundError:
            continue

        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                total += 1
                if first_invalid_index is None:
                    first_invalid_index = total - 1
                    failure_reason = "unparseable_line"
                continue

            total += 1
            idx = total - 1

            if not isinstance(entry, dict) or not entry.get("entry_hash"):
                # Legacy or malformed entry — classify legacy, never tampered (F01-R09)
                legacy += 1
                continue

            # Recompute entry_hash over canonical content excluding entry_hash (F01-R04)
            recomputed = sha256_hex(canonical_serialize(
                {k: v for k, v in entry.items() if k != "entry_hash"}))
            if recomputed != entry["entry_hash"]:
                if first_invalid_index is None:
                    first_invalid_index = idx
                    failure_reason = "payload_mismatch"
                continue

            # Chain link check (F01-R03, F01-R08)
            if prev_entry_hash is not None and entry.get("prev_hash") != prev_entry_hash:
                if first_invalid_index is None:
                    first_invalid_index = idx
                    failure_reason = "chain_break"
                continue

            verified += 1
            prev_entry_hash = entry["entry_hash"]

    return {
        "total_entries": total,
        "verified": verified,
        "legacy_unverifiable": legacy,
        "first_invalid_index": first_invalid_index,
        "failure_reason": failure_reason,
        "integrity_ok": first_invalid_index is None,
    }


def main() -> int:
    report = verify()
    print(json.dumps(report, indent=2))
    return 0 if report["integrity_ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
