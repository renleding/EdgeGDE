"""
Gap #5 verification — worktree creation at scale.

Sparse checkout: tasks with scoped paths materialise only
those paths (not the whole repo). Parallel install: bun
install runs concurrently across worktrees. Timing: every
worktree reports create_ms + install_ms.

Benchmark: 10 parallel tasks, scoped to 1 file each.
Target: create+install < 10s per worktree (logged, not
asserted — the benchmark measures; the doc's escalation
rule (>30s at 10 parallel) triggers the bigger mitigations).

Run:  python3 tests/test_droid_f05_scale.py
"""

import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from droid.mission_manifest import MissionManifest, Task, VerificationCriteria, Budget
from droid.parallel_coordinator import ParallelCoordinator

WORKTREE_BASE = REPO_ROOT.parent / "EdgeGDE-worktrees"


def test_sparse_checkout_scoped():
    """Scoped task materialises only the scoped path."""
    manifest = MissionManifest(
        mission_id="f05-sparse-test",
        objective="sparse checkout test",
        autonomy_level="low",
        tasks=[Task(
            task_id="t_sparse",
            operation="write_text",
            scope=["droid/mission_manifest.py"],
            parallel=True,
            verification_criteria=VerificationCriteria(
                type="test_command", command="echo ok",
                expected={"exit_code": 0}),
        )],
    )
    coord = ParallelCoordinator(manifest, base_worktree_dir=WORKTREE_BASE)
    wt = coord.create_worktree(manifest.tasks[0])
    assert wt.path.exists()
    # scoped file present
    assert (wt.path / "droid" / "mission_manifest.py").exists(), \
        "scoped path must exist"
    # non-scoped file absent (sparse checkout in cone mode)
    assert not (wt.path / "apps" / "edge-runtime" / "package.json").exists(), \
        "non-scoped path should not be materialised"
    print(f"PASS test_sparse_checkout_scoped "
          f"(create_ms={wt.create_duration_ms})")
    coord.cleanup_worktrees()


def test_parallel_install_10_worktrees():
    """10 scoped worktrees; installs run concurrently.

    Measures wall time vs sum of per-worktree install time:
    with parallel installs, wall < sum (overlap) unless
    installs are trivially fast. Also asserts the timing
    fields are present and totals reconcile.
    """
    n = 10
    tasks = []
    for i in range(n):
        tasks.append(Task(
            task_id=f"t_scale_{i}",
            operation="write_text",
            scope=[f"droid/module_{i}.py"],  # scoped, distinct paths
            parallel=True,
            verification_criteria=VerificationCriteria(
                type="test_command", command="echo ok",
                expected={"exit_code": 0}),
        ))
    manifest = MissionManifest(
        mission_id="f05-scale-test",
        objective="scale benchmark: 10 worktrees",
        autonomy_level="low",
        budget=Budget(max_duration_seconds=600),
        tasks=tasks,
    )
    coord = ParallelCoordinator(
        manifest, base_worktree_dir=WORKTREE_BASE, max_concurrent=5,
    )

    started = time.monotonic()
    for task in tasks:
        coord.create_worktree(task)
    create_wall = time.monotonic() - started

    started = time.monotonic()
    install_times = coord.install_worktrees()
    install_wall = time.monotonic() - started

    agg = coord.aggregate_results()
    timing = agg["worktree_timing"]

    assert len(timing) == n, f"expected {n} worktrees tracked"
    assert agg["worktree_timing_total_ms"] == sum(
        t["total_ms"] for t in timing.values()
    )
    assert agg["worktree_slowest_ms"] == max(
        t["total_ms"] for t in timing.values()
    )

    create_ms_total = sum(t["create_ms"] for t in timing.values())
    install_ms_total = sum(t["install_ms"] for t in timing.values())

    print(f"PASS test_parallel_install_10_worktrees")
    print(f"  worktrees:          {n}")
    print(f"  create wall:        {create_wall:.2f}s "
          f"(sum {create_ms_total/1000:.2f}s)")
    print(f"  install wall:       {install_wall:.2f}s "
          f"(sum {install_ms_total/1000:.2f}s)")
    print(f"  slowest worktree:   {agg['worktree_slowest_ms']}ms")
    print(f"  target:             <10s/worktree create+install")

    # Reconciliation (not performance — perf is measured, not asserted)
    assert agg["worktree_timing_total_ms"] >= agg["worktree_slowest_ms"]

    coord.cleanup_worktrees()


if __name__ == "__main__":
    test_sparse_checkout_scoped()
    test_parallel_install_10_worktrees()
    print("=== ALL GAP #5 TESTS PASSED ===")
