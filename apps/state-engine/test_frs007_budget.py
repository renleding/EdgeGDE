"""FRS-007 FEATURE-02 acceptance tests — budget guardrails in the Droid wrapper.

AC1: hard stop at max_tool_calls; remaining tasks skipped; budget_exhausted journaled
AC1b: ledger entry carries budget_used vs budget_limit (F02-R08)
AC2: over-ceiling budget rejected at preflight unless approved_override (F02-R04/R05)
AC2b: approved_override permits the run
AC4: report surfaces budget_used vs budget_limit per dimension (F02-R09)
AC5: defaults applied by autonomy level when no budget declared (F02-R02)
AC6: aggregate accounting — exactly N operations for N tasks, no double count (F02-R10)
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DROID = ROOT / ".hermes" / "bin" / "droid.py"
MISSIONS = ROOT / ".hermes" / "missions"

FAILURES = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def run_droid(manifest: dict, journal_path: str) -> dict:
    """Write manifest under .hermes/missions/, run droid, return report JSON."""
    MISSIONS.mkdir(parents=True, exist_ok=True)
    mpath = MISSIONS / f"{manifest['mission_id']}.manifest.json"
    mpath.write_text(json.dumps(manifest, indent=2))
    env = dict(os.environ)
    env["DROID_JOURNAL_PATH"] = journal_path
    proc = subprocess.run(
        [sys.executable, str(DROID), str(mpath)],
        capture_output=True, text=True, timeout=60, env=env,
    )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"status": "failure", "stdout": proc.stdout[-2000:], "stderr": proc.stderr[-2000:]}


def read_manifest(mission_id: str) -> dict:
    return json.loads((MISSIONS / f"{mission_id}.manifest.json").read_text())


def base_manifest(mission_id: str, autonomy: str = "medium", tasks=None, budget=None) -> dict:
    return {
        "mission_id": mission_id,
        "objective": "FRS-007 FEATURE-02 test",
        "autonomy_level": autonomy,
        "tasks": tasks or [
            {"task_id": f"t{i}", "operation": "read_file", "args": {"path": "AGENTS.md"},
             "scope": ["./"], "idempotent": True, "verification_criteria": ["file read"]}
            for i in range(3)
        ],
        "constraints": {"allowed_paths": [".", "AGENTS.md"], "forbidden_paths": [".git/**", "**/.env"],
                        "stop_on_first_failure": False},
        "budget": budget,
    }


def main():
    # .hermes/bin/ is gitignored (local operational runtime) — skip when absent
    # so CI stays green; local runs fully verify the budget guardrails.
    if not DROID.exists():
        print("SKIP: .hermes/bin/droid.py not present (gitignored local runtime) — budget tests skipped")
        return 0

    with tempfile.TemporaryDirectory() as td:
        journal_path = os.path.join(td, "actions.jsonl")

        # --- AC1: hard stop at max_tool_calls ---
        tasks4 = [
            {"task_id": f"t{i}", "operation": "read_file", "args": {"path": "AGENTS.md"},
             "scope": ["./"], "idempotent": True, "verification_criteria": []} for i in range(4)
        ]
        m1 = base_manifest("frs007-ac1", tasks=tasks4, budget={"max_tool_calls": 2})
        r1 = run_droid(m1, journal_path)
        check("AC1: status failure on hard stop", r1.get("status") == "failure", str(r1.get("violations")))
        check("AC1: budget exhausted flagged",
              r1.get("budget", {}).get("exhausted") is True and r1.get("budget", {}).get("reason_code") == "budget_exhausted",
              str(r1.get("budget")))
        ops = r1.get("operations", [])
        check("AC1: 2 executed + 2 skipped", len(ops) == 4 and
              sum(1 for t in ops if t["status"] == "success") == 2 and
              sum(1 for t in ops if t["status"] == "skipped") == 2, str([t["status"] for t in ops]))
        check("AC1: budget_used.operations == 2", r1.get("budget", {}).get("operations") == 2, str(r1.get("budget")))

        # --- AC1b: ledger entry with budget_used vs budget_limit (F02-R08) ---
        sys.path.insert(0, str(ROOT / "apps" / "state-engine"))
        from ledger_verify import verify
        lr = verify([journal_path])
        check("AC1b: ledger intact", lr["integrity_ok"], str(lr))
        check("AC1b: budget_exhausted entry journaled", lr["verified"] == 1, str(lr))
        with open(journal_path) as f:
            entry = json.loads(f.readlines()[-1])
        check("AC1b: entry carries budget_used + budget_limit",
              entry.get("action") == "budget_exhausted" and
              entry.get("budget_used", {}).get("operations") == 2 and
              entry.get("budget_limit", {}).get("max_tool_calls") == 2, str(entry))

        # --- AC2: over-ceiling budget rejected at preflight (F02-R04/R05) ---
        m2 = base_manifest("frs007-ac2", budget={"max_cost_usd": 50.0})
        r2 = run_droid(m2, journal_path)
        check("AC2: preflight rejection",
              r2.get("status") == "failure" and
              r2.get("budget", {}).get("reason_code") == "budget_rejected_preflight", str(r2.get("budget")))
        check("AC2: zero operations executed", r2.get("operations", []) == [], str(r2.get("operations")))
        check("AC2: violation names the ceiling",
              any("ceiling" in v for v in r2.get("violations", [])), str(r2.get("violations")))

        # --- AC2b: approved_override permits over-ceiling run ---
        m2b = base_manifest("frs007-ac2b", budget={"max_cost_usd": 50.0, "approved_override": "gov:gate3:check-999"})
        r2b = run_droid(m2b, journal_path)
        check("AC2b: override approved, mission runs",
              r2b.get("status") == "success" and r2b.get("budget", {}).get("exhausted") is False, str(r2b.get("budget")))

        # --- AC4: report surfaces budget_used vs budget_limit per dimension (F02-R09) ---
        m4 = base_manifest("frs007-ac4", budget={"max_tool_calls": 3, "max_tokens": 5000})
        r4 = run_droid(m4, journal_path)
        b = r4.get("budget", {})
        check("AC4: limit section present", b.get("limit", {}).get("max_tool_calls") == 3, str(b))
        check("AC4: used section present", "operations" in b and "elapsed_seconds" in b, str(b))
        check("AC4: used <= limit enforced", b.get("operations", 99) <= b.get("limit", {}).get("max_tool_calls", 0), str(b))

        # --- AC5: defaults applied by autonomy level (F02-R02) ---
        m5 = base_manifest("frs007-ac5", autonomy="low")  # no budget block
        r5 = run_droid(m5, journal_path)
        lim5 = r5.get("budget", {}).get("limit", {})
        check("AC5: low defaults applied",
              lim5.get("max_tool_calls") == 50 and lim5.get("max_duration_seconds") == 900 and
              lim5.get("max_cost_usd") == 0.10, str(lim5))
        check("AC5: declared=False for implicit defaults", r5.get("budget", {}).get("declared") is False, str(r5.get("budget")))
        check("AC5: run succeeded under defaults", r5.get("status") == "success", str(r5.get("violations")))

        # --- AC6: aggregate accounting — exact count, no double count (F02-R10) ---
        m6 = base_manifest("frs007-ac6", budget={"max_tool_calls": 3})  # exactly 3 tasks
        r6 = run_droid(m6, journal_path)
        check("AC6: all 3 tasks ran within budget", r6.get("status") == "success", str(r6.get("violations")))
        check("AC6: operations == 3 (aggregate, no double count)",
              r6.get("budget", {}).get("operations") == 3, str(r6.get("budget")))
        check("AC6: not exhausted at exact limit boundary",
              r6.get("budget", {}).get("exhausted") is False, str(r6.get("budget")))

    print()
    if FAILURES:
        print(f"RESULT: {len(FAILURES)} FAILURE(S): {FAILURES}")
        return 1
    print("RESULT: ALL FRS-007 FEATURE-02 ACCEPTANCE TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
