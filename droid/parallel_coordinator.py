"""
Parallel Coordinator (FRS-012 FEATURE-04)

Design-level implementation: tracks parallel task status,
creates worktrees for isolation, aggregates results.

NOTE: Full implementation requires worktree creation.
This module is the design/stub — actual worktree creation
waits until fleet is idle (per user gating).

Contract:
- Parallel tasks run in separate worktrees (F04-R02)
- Shared mission budget — aggregate accounting (F04-R04)
- Saga compensation per failed task (F04-R05)
- Max parallel tasks configurable (F04-N01)

Usage:
    from droid.parallel_coordinator import ParallelCoordinator
    coord = ParallelCoordinator(manifest)
    coord.dispatch_parallel_tasks()
    results = coord.aggregate_results()
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from droid.mission_manifest import MissionManifest, Task

logger = logging.getLogger("droid.parallel_coordinator")


@dataclass
class TaskStatus:
    task_id: str
    status: str = "pending"  # pending | running | completed | failed | escalated
    worktree_path: Optional[str] = None
    result: Optional[dict[str, Any]] = None


@dataclass
class AggregationResult:
    mission_id: str
    all_passed: bool
    task_results: dict[str, TaskStatus]
    budget_used: dict[str, int]


class ParallelCoordinator:
    """Coordinates parallel task execution across worktrees.

    DESIGN-LEVEL IMPLEMENTATION.

    Full worktree creation is gated until fleet is idle:
    - Each new worktree needs `bun install` before dev commands
    - Port registration if any server binds
    - Must not conflict with active agents

    This module provides:
    - Task status tracking
    - Worktree path planning (not creation)
    - Result aggregation
    - Budget aggregation (with FRS-007 integration)
    """

    def __init__(self, manifest: MissionManifest, max_parallel: int = 5):
        self.manifest = manifest
        self.max_parallel = max_parallel
        self._statuses: dict[str, TaskStatus] = {}

    def parallel_tasks(self) -> list[Task]:
        """Return tasks marked parallel: true."""
        return [t for t in self.manifest.tasks if t.parallel]

    def validate_parallelism(self) -> list[str]:
        """Validate that parallel tasks have no depends_on."""
        errors: list[str] = []
        for task in self.parallel_tasks():
            if task.depends_on:
                errors.append(
                    f"parallel task {task.task_id} must not have depends_on"
                )
        return errors

    def plan_worktrees(self) -> dict[str, str]:
        """Plan worktree paths for parallel tasks.

        Returns {task_id: planned_worktree_path} — NOT created.
        Creation is gated until fleet is idle.
        """
        plan: dict[str, str] = {}
        base = Path.cwd().parent
        for task in self.parallel_tasks():
            plan[task.task_id] = str(
                base / f"EdgeGDE-worktrees/parallel-{self.manifest.mission_id}-{task.task_id}"
            )
        return plan

    def dispatch_parallel_tasks(self) -> dict[str, TaskStatus]:
        """Dispatch parallel tasks.

        DESIGN-LEVEL: Returns planned worktree paths.
        Actual worktree creation + Droid spawn waits until fleet is idle.
        """
        plan = self.plan_worktrees()
        for task_id, worktree_path in plan.items():
            self._statuses[task_id] = TaskStatus(
                task_id=task_id,
                status="pending",
                worktree_path=worktree_path,
            )
        logger.info(
            "Planned %d parallel tasks for mission %s",
            len(plan), self.manifest.mission_id,
        )
        return dict(self._statuses)

    def mark_completed(self, task_id: str, result: dict[str, Any]) -> None:
        """Mark a parallel task as completed."""
        if task_id in self._statuses:
            self._statuses[task_id].status = "completed"
            self._statuses[task_id].result = result

    def mark_failed(self, task_id: str, result: dict[str, Any]) -> None:
        """Mark a parallel task as failed.

        Triggers Saga compensation for that task only (F04-R05).
        """
        if task_id in self._statuses:
            self._statuses[task_id].status = "failed"
            self._statuses[task_id].result = result
        logger.warning("Task %s failed — Saga compensation per manifest", task_id)

    def aggregate_results(self) -> AggregationResult:
        """Aggregate results from all parallel tasks."""
        all_passed = all(
            s.status == "completed" for s in self._statuses.values()
        )
        return AggregationResult(
            mission_id=self.manifest.mission_id,
            all_passed=all_passed,
            task_results=dict(self._statuses),
            budget_used={},  # FRS-007 integration — aggregate accounting
        )
