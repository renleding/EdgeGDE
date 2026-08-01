"""FRS-007 FEATURE-01 acceptance tests — AC1..AC6, run in a temp dir.

AC1: chain intact after N actions
AC2: altered payload → exact entry index flagged
AC3: deleted entry → gap flagged
AC4: legacy entries → legacy_unverifiable, chain resumes
AC5: rotation → chain spans files
AC6: caller-supplied reserved fields → rejected at write
"""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from action_journal import ActionJournal, canonical_serialize, sha256_hex
from ledger_verify import verify

FAILURES = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def main():
    with tempfile.TemporaryDirectory() as td:
        journal_path = os.path.join(td, "actions.jsonl")

        # --- AC1: chain intact after N actions ---
        j = ActionJournal(journal_path, agent_id="droid:mission-42:step-3",
                          owner_attestation="gov:gate3:check-881")
        hashes = []
        for i in range(5):
            h = j.log({"action": "write_text", "target": f"file{i}.ts", "result": "ok"})
            hashes.append(h)
        check("AC1: all entries written with entry_hash", all(hashes))
        r = verify([journal_path])
        check("AC1: chain intact", r["integrity_ok"], str(r))
        check("AC1: 5 verified, 0 legacy", r["verified"] == 5 and r["legacy_unverifiable"] == 0, str(r))
        check("AC1: hashes differ per entry", len(set(hashes)) == 5)
        check("AC1: agent_id + attestation injected",
              all(e["agent_id"] == "droid:mission-42:step-3" and e["owner_attestation"] == "gov:gate3:check-881"
                  for e in j.get_recent(5)))

        # --- AC2: altered payload → exact index flagged ---
        with open(journal_path) as f:
            lines = f.readlines()
        modified = json.loads(lines[2])
        modified["result"] = "tampered"
        lines[2] = json.dumps(modified, sort_keys=True) + "\n"
        with open(journal_path, "w") as f:
            f.writelines(lines)
        r = verify([journal_path])
        check("AC2: integrity broken", not r["integrity_ok"], str(r))
        check("AC2: exact index 2 flagged", r["first_invalid_index"] == 2, str(r))
        check("AC2: reason payload_mismatch", r["failure_reason"] == "payload_mismatch", str(r))

        # restore for subsequent tests
        with open(journal_path, "w") as f:
            f.writelines([l if i != 2 else json.dumps(
                {**json.loads(l), "result": "ok"}, sort_keys=True) + "\n"
                for i, l in enumerate(lines)])
        r = verify([journal_path])
        check("AC2: restore verified", r["integrity_ok"], str(r))

        # --- AC3: deleted entry → gap flagged ---
        with open(journal_path) as f:
            lines = f.readlines()
        del lines[3]
        with open(journal_path, "w") as f:
            f.writelines(lines)
        r = verify([journal_path])
        check("AC3: gap detected", not r["integrity_ok"], str(r))
        check("AC3: chain_break reason", r["failure_reason"] == "chain_break", str(r))

        # --- AC4: legacy entries → legacy_unverifiable, chain resumes ---
        legacy_path = os.path.join(td, "legacy.jsonl")
        with open(legacy_path, "w") as f:
            f.write(json.dumps({"_timestamp": "2026-07-01T00:00:00Z", "action": "old", "result": "ok"}) + "\n")
            f.write(json.dumps({"_timestamp": "2026-07-02T00:00:00Z", "action": "older", "result": "ok"}) + "\n")
        jl = ActionJournal(legacy_path, agent_id="legacy-runner")
        jl.log({"action": "post_legacy", "result": "ok"})
        jl.log({"action": "post_legacy_2", "result": "ok"})
        r = verify([legacy_path])
        check("AC4: legacy classified", r["legacy_unverifiable"] == 2, str(r))
        check("AC4: chain resumes, new entries verified", r["verified"] == 2, str(r))
        check("AC4: integrity OK (legacy not tampered)", r["integrity_ok"], str(r))

        # --- AC5: rotation → chain spans files (fresh ledger) ---
        rot_path = os.path.join(td, "rot.jsonl")
        jr = ActionJournal(rot_path, agent_id="droid:rotation-test")
        jr.log({"action": "pre_rotate", "result": "ok"})
        jr.rotate()
        jr.log({"action": "post_rotate", "result": "ok"})
        rotated_files = sorted(Path(td).glob("rot.jsonl.*"))
        check("AC5: rotation created new file", len(rotated_files) == 1, str(rotated_files))
        # verify across both files in order: old rotated file(s) + active
        from ledger_verify import discover_ledger_files
        paths = discover_ledger_files(rot_path)
        check("AC5: both files discovered", len(paths) >= 2, str(paths))
        r = verify(paths)
        check("AC5: chain spans rotation", r["integrity_ok"], str(r))
        check("AC5: entries from both files verified",
              r["verified"] == 2 and r["total_entries"] == 2, str(r))

        # --- AC6: caller-supplied reserved fields rejected ---
        jr2 = ActionJournal(os.path.join(td, "forge.jsonl"), agent_id="droid:forge-test")
        rejected = 0
        for bad in ({"agent_id": "spoofed"}, {"entry_hash": "deadbeef"},
                    {"prev_hash": "deadbeef"}, {"owner_attestation": "spoofed"}):
            try:
                jr2.log({"action": "x", **bad})
            except ValueError:
                rejected += 1
        check("AC6: all 4 reserved-field attempts rejected", rejected == 4, f"{rejected}/4")
        r = verify([os.path.join(td, "forge.jsonl")])
        check("AC6: no forged entries written", r["total_entries"] == 0 and r["integrity_ok"], str(r))

    print()
    if FAILURES:
        print(f"RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
        return 1
    print("RESULT: ALL FRS-007 FEATURE-01 ACCEPTANCE TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
