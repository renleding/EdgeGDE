"""
Droid Execution Wrapper — runs a single mission's tasks
inside a worktree.

Called by droid/parallel_coordinator.py per parallel task.
Designed for `python3 droid/execute.py --mission <path> --worktree <path>`.

Flow per task in the mission manifest:
1. Pre-mutation governance gate (droid.governance_gate)
2. Code→Validate loop (droid.code_validate_loop) for mutating tasks
3. Verification criteria run (droid.verification_runner) for every task
4. Report per-task status as JSON to stdout

Exit codes:
  0 — all tasks passed verification
  1 — any task failed verification
  2 — governance rejection or manifest invalid
"""

import argparse
import json
import sys
from pathlib import Path

# Allow running directly from the repo root without installation
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from droid.code_validate_loop import CodeValidateLoop
from droid.governance_gate import GovernanceGate
from droid.mission_manifest import MissionManifest
from droid.verification_runner import VerificationRunner


def run_task(task, worktree_dir: Path, governance: GovernanceGate,
             runner: VerificationRunner) -> dict:
    """Execute one task and return its result record."""
    record: dict = {"task_id": task.task_id, "operation": task.operation,
                    "status": "pending", "iterations": 0}

    # Read-only operations: run verification criteria directly if provided
    if not task.is_mutating():
        if task.verification_criteria:
            result = runner.run(task.verification_criteria)
            record["status"] = result.status
            record["result"] = result.result
        else:
            record["status"] = "pass"
            record["result"] = {"note": "read-only, no criteria"}
        return record

    # Mutating operations: governance gate → code→validate loop
    gate_allowed, gate_report = governance.can_apply_mutation(
        task.scope[0] if task.scope else ""
    )
    if not gate_allowed:
        record["status"] = "rejected"
        record["governance"] = gate_report.to_dict() if gate_report else None
        return record

    initial_content = ""
    content_path = worktree_dir / (task.scope[0] if task.scope else "")
    if content_path.exists():
        initial_content = content_path.read_text(errors="replace")

    loop = CodeValidateLoop(
        task_id=task.task_id,
        file_path=str(task.scope[0]) if task.scope else "",
        criteria=task.verification_criteria,
    )
    loop_result = loop.execute(
        initial_content=initial_content,
        adjust=lambda content, failure: content,  # caller-provided agent step
    )
    record["status"] = loop_result.status
    record["iterations"] = loop_result.iterations
    if loop_result.last_failure:
        record["last_failure"] = loop_result.last_failure.result
    if loop_result.governance_report:
        record["governance"] = loop_result.governance_report.to_dict() if loop_result.governance_report else None
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="droid/execute.py",
        description="Run one mission manifest's tasks inside a worktree",
    )
    parser.add_argument("--mission", required=True,
                        help="path to the per-task mission manifest JSON")
    parser.add_argument("--worktree", required=True,
                        help="path to the worktree the mission runs in")
    args = parser.parse_args(argv)

    manifest_path = Path(args.mission)
    worktree_dir = Path(args.worktree)

    if not manifest_path.exists():
        print(json.dumps({"error": f"manifest not found: {manifest_path}"}),
              file=sys.stderr)
        return 2

    manifest = MissionManifest.from_json(manifest_path.read_text())
    errors = manifest.validate()
    if errors:
        print(json.dumps({"error": "manifest invalid", "details": errors}),
              file=sys.stderr)
        return 2

    governance = GovernanceGate(source_dir=str(worktree_dir))
    runner = VerificationRunner()

    task_results = []
    failed = False
    for task in manifest.tasks:
        record = run_task(task, worktree_dir, governance, runner)
        task_results.append(record)
        if record["status"] not in ("pass", "completed"):
            failed = True

    payload = {
        "mission_id": manifest.mission_id,
        "autonomy_level": manifest.autonomy_level,
        "task_results": task_results,
        "all_passed": not failed,
    }
    print(json.dumps(payload, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
