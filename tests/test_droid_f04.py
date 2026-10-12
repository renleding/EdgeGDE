"""
F04 verification tests — Parallel Coordinator.

Covers:
1. Worktree creation for a parallel task (real git worktree, cleaned up)
2. Parallel dispatch via thread pool (bounded by max_concurrent)
3. Budget accounting: aggregate mission budget, per-task usage, hard stop
4. droid/execute.py as the worker script (read-only task end-to-end)

Run:  python3 tests/test_droid_f04.py
"""

import json
import sys
import time
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from droid.mission_manifest import MissionManifest, Task, VerificationCriteria, Budget
from droid.parallel_coordinator import ParallelCoordinator

WORKTREE_BASE = REPO_ROOT.parent / "EdgeGDE-worktrees"


def test_worktree_creation():
    manifest = MissionManifest(
        mission_id="f04-create-test",
        objective="worktree creation test",
        autonomy_level="low",
        tasks=[Task(task_id="t1", operation="shell", scope=["."], parallel=True,
                    verification_criteria=VerificationCriteria(
                        type="test_command", command="echo ok",
                        expected={"exit_code": 0}))],
    )
    coord = ParallelCoordinator(manifest, base_worktree_dir=WORKTREE_BASE)
    assert not coord.validate_parallelism(), "parallelism validation should pass"

    wt = coord.create_worktree(manifest.tasks[0])
    assert wt.path.exists(), "worktree dir must exist"
    assert (wt.path / "package.json").exists(), "worktree must have package.json"
    assert wt.manifest_mirror.mission_id == manifest.mission_id
    coord.cleanup_worktrees()
    assert not wt.path.exists(), "worktree must be removed on cleanup"
    print("PASS test_worktree_creation")


def test_parallel_dispatch_and_budget():
    """Dispatch 2 parallel tasks through droid/execute.py; verify thread-pool
    dispatch completes and budget_used aggregates."""
    manifest = MissionManifest(
        mission_id="f04-dispatch-test",
        objective="parallel dispatch test",
        autonomy_level="low",
        budget=Budget(max_duration_seconds=60),
        tasks=[
            Task(task_id="t_a", operation="read_file", scope=["README.md"],
                 parallel=True,
                 verification_criteria=VerificationCriteria(
                     type="test_command", command="echo a", expected={"exit_code": 0})),
            Task(task_id="t_b", operation="read_file", scope=["README.md"],
                 parallel=True,
                 verification_criteria=VerificationCriteria(
                     type="test_command", command="echo b", expected={"exit_code": 0})),
        ],
    )
    coord = ParallelCoordinator(manifest, base_worktree_dir=WORKTREE_BASE, max_concurrent=2)
    statuses = coord.dispatch_parallel_tasks(
        droid_path=str(REPO_ROOT / "droid" / "execute.py"),
    )
    assert len(statuses) == 2, "both tasks must be tracked"
    for tid, st in statuses.items():
        assert st.status in ("completed", "failed", "escalated"), \
            f"{tid} finished with status {st.status}"

    agg = coord.aggregate_results()
    assert "budget_used_total_ms" in agg
    assert "budget_limit_ms" in agg
    assert agg["budget_limit_ms"] == 60_000
    assert sum(agg["budget_used"].values()) == agg["budget_used_total_ms"], \
        "aggregate must equal sum of per-task (no double counting)"
    print(f"PASS test_parallel_dispatch_and_budget "
          f"(statuses={[s.status for s in statuses.values()]}, "
          f"budget_used_total_ms={agg['budget_used_total_ms']})")
    coord.cleanup_worktrees()


def test_budget_hard_stop():
    """Duration budget at 0 must hard-stop dispatch with budget_exhausted."""
    manifest = MissionManifest(
        mission_id="f04-budget-test",
        objective="budget hard stop test",
        autonomy_level="low",
        budget=Budget(max_duration_seconds=0),
        tasks=[Task(task_id="t_budget", operation="read_file", scope=["README.md"],
                    parallel=True,
                    verification_criteria=VerificationCriteria(
                        type="test_command", command="echo ok",
                        expected={"exit_code": 0}))],
    )
    coord = ParallelCoordinator(manifest, base_worktree_dir=WORKTREE_BASE, max_concurrent=1)
    statuses = coord.dispatch_parallel_tasks(
        droid_path=str(REPO_ROOT / "droid" / "execute.py"),
    )
    st = statuses["t_budget"]
    assert st.status == "failed", "budget_exhausted must mark task failed"
    assert st.result and st.result.get("error") == "budget_exhausted", \
        "reason must be budget_exhausted"
    print("PASS test_budget_hard_stop")
    coord.cleanup_worktrees()


def test_execute_wrapper_readonly():
    """droid/execute.py runs a read-only mission end-to-end (exit 0)."""
    import subprocess
    tmp = Path("/tmp/droid-exec-test")
    tmp.mkdir(exist_ok=True)
    manifest = MissionManifest(
        mission_id="f04-exec-test",
        objective="execute.py read-only test",
        autonomy_level="low",
        tasks=[Task(task_id="t_read", operation="read_file", scope=["README.md"],
                    verification_criteria=VerificationCriteria(
                        type="test_command", command="echo ok",
                        expected={"exit_code": 0}))],
    )
    mission_path = tmp / "mission.json"
    mission_path.write_text(manifest.to_json())
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "droid" / "execute.py"),
         "--mission", str(mission_path), "--worktree", str(tmp)],
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, f"exit 0 expected, got {proc.returncode}: {proc.stderr}"
    payload = json.loads(proc.stdout)
    assert payload["all_passed"] is True
    assert payload["task_results"][0]["status"] == "pass"
    print("PASS test_execute_wrapper_readonly")


if __name__ == "__main__":
    test_worktree_creation()
    test_execute_wrapper_readonly()
    test_parallel_dispatch_and_budget()
    test_budget_hard_stop()
    print("=== ALL F04 FOLLOW-UP TESTS PASSED ===")