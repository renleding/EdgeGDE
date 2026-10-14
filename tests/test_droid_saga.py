"""
Gap #3 verification — Saga compensation wired into
ParallelCoordinator.

Proves the full loop:
1. Shell task creates a NEW file, verification fails →
   Saga deletes the new file via declared compensation.
2. Mutating task OVERWRITES an existing file, verification
   fails → Saga restores the original content from checkpoint.
3. Successful task is NOT compensated.
4. saga_enabled=False disables compensation (opt-out).

Run:  python3 tests/test_droid_saga.py
"""

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from droid.mission_manifest import (
    MissionManifest, Task, VerificationCriteria, Budget, Saga,
)
from droid.parallel_coordinator import ParallelCoordinator

WORKTREE_BASE = REPO_ROOT.parent / "EdgeGDE-worktrees"


def _make_manifest(mission_id: str, tasks: list) -> MissionManifest:
    return MissionManifest(
        mission_id=mission_id,
        objective=f"saga test {mission_id}",
        autonomy_level="low",
        budget=Budget(max_duration_seconds=600),
        saga=Saga(
            compensation_strategy="reverse_order",
            partial_failure_policy="compensate_all",
        ),
        tasks=tasks,
    )


def _coord(manifest: MissionManifest, env: dict | None = None,
           saga_enabled: bool = True) -> ParallelCoordinator:
    """Build a coordinator whose worker uses the writing
    adjuster to apply args.content to the scoped file.

    The writing adjuster (tests/fixtures/writing_adjuster.py)
    reads ADJUSTER_CONTENT from env and prints it — so the
    CodeValidateLoop's adjust callback performs the mutation,
    letting verification fail and Saga compensate.
    """
    coord = ParallelCoordinator(
        manifest, base_worktree_dir=WORKTREE_BASE,
        droid_path=str(REPO_ROOT / "droid" / "execute.py"),
        saga_enabled=saga_enabled,
    )
    coord.adjust_cmd = (
        f"python3 {REPO_ROOT / 'tests' / 'fixtures' / 'writing_adjuster.py'}"
    )
    coord.worker_env = env or {}
    return coord


def test_shell_new_file_deleted_on_failure():
    """Shell task creates a new file, verification
    fails → Saga deletes the new file via shell
    compensation (declared compensate.rm)."""
    manifest = _make_manifest("saga-shell-new", [Task(
        task_id="t_shell_new",
        operation="shell",
        scope=["src/shell_generated.txt"],
        parallel=True,
        args={"command": "echo 'created by shell' > src/shell_generated.txt"},
        compensate={
            "operation": "shell",
            "args": {"command": "rm -f src/shell_generated.txt"},
        },
        verification_criteria=VerificationCriteria(
            type="test_command",
            command="test -f src/shell_generated.txt",
            expected={"exit_code": 1},  # expect missing → fails if file exists
        ),
    )])
    coord = ParallelCoordinator(
        manifest, base_worktree_dir=WORKTREE_BASE,
        droid_path=str(REPO_ROOT / "droid" / "execute.py"),
    )
    coord.dispatch_parallel_tasks()
    agg = coord.aggregate_results()

    wt = coord._worktrees["t_shell_new"]
    target = wt.path / "src" / "shell_generated.txt"

    assert agg["task_results"]["t_shell_new"]["status"] == "failed"
    assert "t_shell_new" in agg["compensated_task_ids"]
    # The shell compensation ran rm -f; file should be gone
    assert not target.exists(), \
        "Saga shell compensation must delete the new file"
    print("PASS test_shell_new_file_deleted_on_failure "
          f"(file exists after compensation={target.exists()})")
    coord.cleanup_worktrees()


def test_existing_file_restored_on_failure():
    """Task mutates an existing repo file via the writing
    adjuster, verification never passes → loop escalates
    → task fails → Saga restores the ORIGINAL content
    from the checkpoint.

    Flow: original file passes governance but FAILS
    verification (grep demands a token that isn't there);
    the adjuster writes MUTATED_CONTENT (also fails); the
    loop escalates after the iteration limit; Saga then
    restores the pre-mutation content."""
    manifest = _make_manifest("saga-restore", [Task(
        task_id="t_overwrite",
        operation="write_text",
        scope=["droid/mission_manifest.py"],
        parallel=True,
        args={"path": "droid/mission_manifest.py",
              "content": "MUTATED_CONTENT"},
        # verification demands a token the file never has —
        # fails on original AND on adjusted content
        verification_criteria=VerificationCriteria(
            type="test_command",
            command="grep -q 'TOKEN_NEVER_PRESENT' droid/mission_manifest.py",
            expected={"exit_code": 0},
        ),
    )])
    # ADJUSTER_CONTENT is what the writing adjuster writes
    # after the first failed verification
    coord = _coord(manifest, env={"ADJUSTER_CONTENT": "MUTATED_CONTENT"})
    coord.dispatch_parallel_tasks()
    agg = coord.aggregate_results()

    wt = coord._worktrees["t_overwrite"]
    target = wt.path / "droid" / "mission_manifest.py"

    assert agg["task_results"]["t_overwrite"]["status"] == "failed"
    assert "t_overwrite" in agg["compensated_task_ids"]
    content = target.read_text()
    assert "MUTATED_CONTENT" not in content, \
        "Saga must restore original content"
    assert "Mission Manifest" in content, \
        f"original content must be back, got: {content[:80]!r}"
    comp = agg["compensations"]["t_overwrite"]
    assert "droid/mission_manifest.py" in comp["restored"]
    print("PASS test_existing_file_restored_on_failure "
          f"(restored={comp['restored']})")
    coord.cleanup_worktrees()


def test_success_not_compensated():
    """Passing tasks are never compensated."""
    manifest = _make_manifest("saga-success", [Task(
        task_id="t_ok",
        operation="read_file",
        scope=["README.md"],
        parallel=True,
        verification_criteria=VerificationCriteria(
            type="test_command", command="echo ok",
            expected={"exit_code": 0},
        ),
    )])
    coord = ParallelCoordinator(
        manifest, base_worktree_dir=WORKTREE_BASE,
        droid_path=str(REPO_ROOT / "droid" / "execute.py"),
    )
    coord.dispatch_parallel_tasks()
    agg = coord.aggregate_results()
    assert agg["task_results"]["t_ok"]["status"] == "completed"
    assert agg["compensated_task_ids"] == [], \
        "successful task must not be compensated"
    print("PASS test_success_not_compensated")
    coord.cleanup_worktrees()


def test_saga_disabled():
    """saga_enabled=False → failed tasks are NOT compensated
    (opt-out for read-only missions)."""
    manifest = _make_manifest("saga-disabled", [Task(
        task_id="t_disabled",
        operation="write_text",
        scope=["droid/mission_manifest.py"],
        parallel=True,
        args={"path": "droid/mission_manifest.py",
              "content": "LEFT BEHIND"},
        verification_criteria=VerificationCriteria(
            type="test_command",
            command="grep -q 'TOKEN_NEVER_PRESENT' droid/mission_manifest.py",
            expected={"exit_code": 0},
        ),
    )])
    coord = _coord(
        manifest,
        env={"ADJUSTER_CONTENT": "LEFT BEHIND"},
        saga_enabled=False,
    )
    coord.dispatch_parallel_tasks()
    agg = coord.aggregate_results()
    assert agg["task_results"]["t_disabled"]["status"] == "failed"
    assert agg["compensated_task_ids"] == [], \
        "saga_enabled=False must skip compensation"
    wt = coord._worktrees["t_disabled"]
    # Without compensation the LAST written content remains
    # (the adjuster's LEFT BEHIND, since the loop escalates)
    assert "LEFT BEHIND" in (wt.path / "droid" / "mission_manifest.py").read_text(), \
        "without compensation the mutation remains"
    print("PASS test_saga_disabled")
    coord.cleanup_worktrees()


if __name__ == "__main__":
    test_shell_new_file_deleted_on_failure()
    test_existing_file_restored_on_failure()
    test_success_not_compensated()
    test_saga_disabled()
    print("=== ALL SAGA WIRING TESTS PASSED ===")
