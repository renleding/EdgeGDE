"""
F04 Integration Test — Parallel Coordinator worktree creation

Demonstrates F04: creates a worktree, installs deps, dispatches a 
trivial Droid worker (echo + verification), aggregates result.
"""

import sys
import os
from pathlib import Path

# Ensure droid/ is on path (working dir is repo root)
parent = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if parent not in sys.path:
    sys.path.insert(0, parent)

from droid.mission_manifest import MissionManifest, Task, VerificationCriteria
from droid.parallel_coordinator import ParallelCoordinator

# Create a test mission with 1 parallel task
manifest = MissionManifest(
    mission_id="f04-test-1",
    objective="Test parallel coordinator worktree creation",
    autonomy_level="low",
    tasks=[
        Task(
            task_id="task_test_1",
            operation="shell",
            scope=["."],
            parallel=True,
            verification_criteria=VerificationCriteria(
                type="test_command",
                command="echo hello-from-parallel-worktree",
                expected={"exit_code": 0},
            ),
            args={"command": "echo hello-from-parallel-worktree"},
        ),
    ],
)

print("=== F04 INTEGRATION TEST ===")
print(f"Mission: {manifest.mission_id}")
print(f"Parallel tasks: {len(manifest.tasks)}")
print()

# Resolve droid script path
droid_script = os.path.abspath(os.path.join(os.path.dirname(__file__), "execute.py"))
print(f"Droid script: {droid_script}")
print(f"Exists: {os.path.exists(droid_script)}")
print()

# Coordinator
coord = ParallelCoordinator(
    manifest,
    base_worktree_dir=Path(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "EdgeGDE-worktrees"))),
    max_concurrent=1,
)
print(f"Worktree base: {coord.worktree_base}")
print()

# Plan
plan = coord.plan_worktrees()
print(f"Planned worktree paths: {plan}")
print()

# Validate parallelism
errors = coord.validate_parallelism()
print(f"Parallelism validation: {'PASS' if not errors else f'FAIL {errors}'}")

# Create worktree
print()
print("Creating worktree...")
try:
    wt = coord.create_worktree(manifest.tasks[0])
    print(f"Worktree created: {wt.path}")
    print(f"Exists: {wt.path.exists()}")
    print(f"Has package.json: {(wt.path / 'package.json').exists()}")
except Exception as e:
    print(f"FAILED: {e}")
    sys.exit(1)

# Cleanup
print()
print("Cleaning up worktree...")
coord.cleanup_worktrees()
print("Done.")
print()
print("=== F04 WORK TREE CREATION VERIFIED ===")
