"""
Parallel Coordinator (FRS-012 FEATURE-04)

Full implementation: creates worktrees for parallel tasks,
manages Droid dispatch, aggregates results, enforces shared
mission budget.

Contract:
- Parallel tasks run in separate worktrees (F04-R02)
- Shared mission budget — aggregate accounting, no double counting (F04-R04,
  FRS-007 F02-R10); duration budget is a hard stop with reason
  budget_exhausted (F02-R03); per-task usage journaled in results (F02-R08)
- Saga compensation per failed task (F04-R05) — REAL via droid.saga_bridge:
  mutating tasks are checkpointed before execution and restored on failure
  (reverse_order per the manifest's saga block; gap #3)
- Max parallel tasks configurable (F04-N01, default 5) — dispatched via a
  thread pool bounded by max_concurrent
- Workers run droid/execute.py in each worktree

Usage:
    from droid.parallel_coordinator import ParallelCoordinator
    coord = ParallelCoordinator(manifest, base_worktree_dir="../EdgeGDE-worktrees")
    coord.dispatch_parallel_tasks()
    results = coord.aggregate_results()
"""

import logging
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Optional

from droid.mission_manifest import MissionManifest, Task
from droid.saga_bridge import SagaBridge

logger = logging.getLogger("droid.parallel_coordinator")

WORKTREE_BASE = Path.cwd().parent / "EdgeGDE-worktrees"


@dataclass
class Worktree:
    """A worktree created for one parallel task."""
    task_id: str
    path: Path
    manifest_mirror: MissionManifest  # task-authoritative copy for the worker
    create_duration_ms: int = 0      # worktree add + checkout
    install_duration_ms: int = 0     # bun install (0 if no package.json)


@dataclass
class TaskStatus:
    task_id: str
    status: Literal["pending", "running", "completed", "failed", "escalated"]
    worktree_path: Optional[str] = None
    result: Optional[dict[str, Any]] = None
    budget_used: int = 0


class WorktreeCreationError(Exception):
    pass


class ParallelCoordinator:
    """Coordinates parallel task execution across isolated worktrees.

    Flow:
    1. Identify parallel tasks (parallel:true, no depends_on)
    2. For each: create worktree from base repo, install deps
    3. Dispatch Droid sub-agent per worktree (synchronous for now)
    4. Aggregate results; Saga compensation on failure
    5. Cleanup worktrees on completion
    """

    def __init__(
        self,
        manifest: MissionManifest,
        base_worktree_dir: Optional[Path] = None,
        max_concurrent: int = 5,
        bun_command: str = "bun",
        droid_path: Optional[str] = None,
        saga_enabled: bool = True,
    ):
        self.manifest = manifest
        self.worktree_base = base_worktree_dir or WORKTREE_BASE
        self.max_concurrent = max(1, max_concurrent)
        self.bun_command = bun_command
        self.droid_path = droid_path
        self.saga_enabled = saga_enabled
        # Optional --adjust-cmd passed to every worker
        # (gap #4 integration — lets tests drive mutations)
        self.adjust_cmd: Optional[str] = None
        # Extra env vars for worker subprocesses
        self.worker_env: dict[str, str] = {}
        self._worktrees: dict[str, Worktree] = {}
        self._statuses: dict[str, TaskStatus] = {}
        # Gap #3: per-task checkpoints for real Saga compensation
        self._checkpoints: dict[str, dict[str, Any]] = {}
        self._compensations: dict[str, dict[str, Any]] = {}
        self._saga_bridge: Optional[SagaBridge] = None

    def resolve_droid_script(self) -> str:
        """Locate the Droid execution wrapper script.

        Tries in order:
        1. Explicit droid_path from constructor
        2. droid/execute.py relative to worktree base
        3. scripts/droid-execute.sh relative to worktree base
        4. Raises if none found.
        """
        if self.droid_path:
            if Path(self.droid_path).exists():
                return str(Path(self.droid_path).resolve())
            raise WorktreeCreationError(f"Droid script not found: {self.droid_path}")

        candidates = [
            self.worktree_base / "droid" / "execute.py",
            self.worktree_base / "scripts" / "droid-execute.sh",
        ]
        for candidate in candidates:
            if candidate.exists():
                return str(candidate.resolve())
        raise WorktreeCreationError(
            f"No Droid execution wrapper found in {self.worktree_base}. "
            "Expected one of: droid/execute.py, scripts/droid-execute.sh"
        )

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
        """Plan worktree paths for parallel tasks (not created)."""
        plan: dict[str, str] = {}
        for task in self.parallel_tasks():
            plan[task.task_id] = str(
                self.worktree_base
                / f"parallel-{self.manifest.mission_id}-{task.task_id}"
            )
        return plan

    def create_worktree(self, task: Task) -> Worktree:
        """Create an isolated worktree for a parallel task.

        Steps:
        1. Create worktree from current HEAD via git worktree add --no-checkout
        2. Sparse checkout of task.scope paths (falls back to full
           checkout when the task has no scope or the repo lacks
           sparse-checkout support) — materialises only the files
           the task touches instead of the whole repo
        3. Install dependencies (bun install) if package.json exists
        4. Return Worktree with task-authoritative manifest copy

        Raises WorktreeCreationError on failure.
        """
        started = time.monotonic()
        wt_dir = self.worktree_base / f"parallel-{self.manifest.mission_id}-{task.task_id}"

        # Ensure worktree base exists
        self.worktree_base.mkdir(parents=True, exist_ok=True)

        # Clean stale worktree if present
        if wt_dir.exists():
            try:
                subprocess.run(
                    ["git", "worktree", "remove", "--force", str(wt_dir)],
                    check=True, capture_output=True, timeout=60,
                )
            except subprocess.CalledProcessError:
                shutil.rmtree(wt_dir, ignore_errors=True)

        repo_root = Path.cwd()

        # Create worktree (--no-checkout to control checkout)
        try:
            subprocess.run(
                [
                    "git", "worktree", "add",
                    "--no-checkout", str(wt_dir),
                    "HEAD",
                ],
                check=True, capture_output=True, timeout=120,
                cwd=str(repo_root),
            )
        except subprocess.CalledProcessError as e:
            stderr = e.stderr.decode() if e.stderr else str(e)
            logger.error("git worktree add failed for %s: %s", wt_dir, stderr)
            raise WorktreeCreationError(
                f"Failed to create worktree at {wt_dir}: {stderr}"
            )

        # Checkout — sparse over task.scope when available, else full
        checkout_error: Optional[str] = None
        scope_paths = [p for p in (task.scope or []) if p and p != "."]
        if scope_paths:
            # Sparse checkout: materialise only the scoped paths
            sparse_ok = True
            for cmd in (
                ["git", "sparse-checkout", "init", "--cone"],
                ["git", "sparse-checkout", "set", *scope_paths],
                ["git", "checkout", "HEAD"],
            ):
                proc = subprocess.run(
                    cmd, capture_output=True, timeout=60,
                    cwd=str(wt_dir),
                )
                if proc.returncode != 0:
                    sparse_ok = False
                    checkout_error = (
                        proc.stderr.decode()[-200:] if proc.stderr else ""
                    )
                    break
            if sparse_ok:
                logger.info(
                    "Sparse checkout of %s in %s", scope_paths, wt_dir
                )
        if not scope_paths or checkout_error is not None:
            # Full checkout (no scope, or sparse failed mid-way)
            try:
                # Reset sparse config so a full checkout is complete
                subprocess.run(
                    ["git", "sparse-checkout", "disable"],
                    capture_output=True, timeout=30, cwd=str(wt_dir),
                )
                subprocess.run(
                    ["git", "checkout", "HEAD"],
                    check=True, capture_output=True, timeout=60,
                    cwd=str(wt_dir),
                )
            except subprocess.CalledProcessError as e:
                try:
                    subprocess.run(
                        ["git", "worktree", "remove", "--force", str(wt_dir)],
                        check=True, capture_output=True, timeout=60,
                    )
                except Exception:
                    shutil.rmtree(wt_dir, ignore_errors=True)
                raise WorktreeCreationError(
                    f"Failed to checkout HEAD in {wt_dir}: "
                    f"{e.stderr.decode() if e.stderr else str(e)}"
                )

        create_ms = int((time.monotonic() - started) * 1000)
        return self._finish_worktree(task, wt_dir, create_ms)

    def _finish_worktree(
        self, task: Task, wt_dir: Path, create_ms: int = 0,
    ) -> Worktree:
        """Register a created worktree: build the task-authoritative
        manifest mirror, record status, attach timing."""
        task_manifest = MissionManifest(
            mission_id=self.manifest.mission_id,
            objective=f"[{self.manifest.mission_id}] Task {task.task_id}: {self.manifest.objective}",
            autonomy_level=self.manifest.autonomy_level,
            budget=self.manifest.budget,
            saga=self.manifest.saga,
            tasks=[task],
        )
        task_manifest.validate()

        wt = Worktree(
            task_id=task.task_id,
            path=wt_dir,
            manifest_mirror=task_manifest,
            create_duration_ms=create_ms,
        )
        self._worktrees[task.task_id] = wt
        self._statuses[task.task_id] = TaskStatus(
            task_id=task.task_id,
            status="pending",
            worktree_path=str(wt_dir),
        )
        logger.info(
            "Created worktree %s for task %s (create %dms)",
            wt_dir, task.task_id, create_ms,
        )
        return wt

    def _install_deps(self, wt_dir: Path) -> int:
        """Run bun install in a worktree. Returns duration in ms.

        Non-fatal on failure — the worker may still run without
        deps (logged as a warning). Returns 0 when there is no
        package.json (nothing to install).
        """
        pkg_json = wt_dir / "package.json"
        if not pkg_json.exists():
            return 0
        started = time.monotonic()
        try:
            subprocess.run(
                [self.bun_command, "install"],
                check=True, capture_output=True, timeout=300,
                cwd=str(wt_dir),
            )
            ms = int((time.monotonic() - started) * 1000)
            logger.info("bun install complete in %s (%dms)", wt_dir, ms)
            return ms
        except subprocess.CalledProcessError as e:
            logger.warning(
                "bun install failed in %s — worker may lack deps: %s",
                wt_dir, e.stderr.decode()[-200:] if e.stderr else "",
            )
            return int((time.monotonic() - started) * 1000)

    def install_worktrees(self) -> dict[str, int]:
        """Install dependencies in all created worktrees in parallel.

        bun install against separate worktree dirs are independent
        processes, so they run concurrently (bounded by
        max_concurrent). Only `git worktree add` must be serial
        (single repo lock).

        Returns {task_id: install_duration_ms}.
        """
        results: dict[str, int] = {}

        def install_one(wt: Worktree) -> tuple[str, int]:
            ms = self._install_deps(wt.path)
            wt.install_duration_ms = ms
            return wt.task_id, ms

        with ThreadPoolExecutor(max_workers=self.max_concurrent) as pool:
            futures = {
                pool.submit(install_one, wt): wt.task_id
                for wt in self._worktrees.values()
            }
            for fut in as_completed(futures):
                task_id, ms = fut.result()
                results[task_id] = ms

        logger.info(
            "Worktree installs complete: %d worktrees, "
            "sum %dms, slowest %dms",
            len(results), sum(results.values()),
            max(results.values()) if results else 0,
        )
        return results

    def dispatch_parallel_tasks(
        self,
        droid_path: Optional[str] = None,
        droid_args: Optional[dict[str, Any]] = None,
    ) -> dict[str, TaskStatus]:
        """Create worktrees and dispatch Droid per parallel task.

        Phase 1 creates all worktrees (sequential — git worktree add
        holds a repo-wide lock). Phase 1b installs dependencies in
        parallel (independent processes). Phase 2 dispatches the
        workers in a thread pool bounded by max_concurrent (F04-N01).

        Budget: tasks share ONE mission budget (FRS-007 F02-R10, aggregate
        accounting — no double counting). Before each task starts the
        coordinator checks the aggregate elapsed time against
        budget.max_duration_seconds; at the limit dispatch stops with
        remaining tasks marked 'failed'/reason budget_exhausted
        (F02-R03 hard stop).

        Args:
            droid_path: Optional override for Droid script path
            droid_args: Extra args to pass to each Droid worker

        Returns:
            Dict of {task_id: TaskStatus} after all workers complete.
        """
        if droid_path:
            self.droid_path = droid_path

        # Gap #3: prepare the Saga bridge (loads tools/saga.py)
        if self.saga_enabled and self._saga_bridge is None:
            self._saga_bridge = SagaBridge()

        droid_script = self.resolve_droid_script()
        droid_args = droid_args or {}
        mission_started = time.monotonic()

        # Phase 1: create all worktrees
        wt_errors: list[str] = []
        for task in self.parallel_tasks():
            try:
                self.create_worktree(task)
            except WorktreeCreationError as e:
                wt_errors.append(f"{task.task_id}: {e}")
                st = self._statuses.get(task.task_id)
                if st:
                    st.status = "failed"
                    st.result = {"error": str(e)}

        if wt_errors:
            logger.warning(
                "Worktree creation had %d failures: %s", len(wt_errors), wt_errors
            )

        # Phase 1b: install dependencies in parallel
        self.install_worktrees()

        # Phase 1c: checkpoint files each mutating task will touch
        # (Saga compensation needs the pre-mutation state)
        for task in self.parallel_tasks():
            if self._saga_bridge is None:
                break
            wt = self._worktrees.get(task.task_id)
            if wt is None:
                continue
            self._checkpoints[task.task_id] = (
                self._saga_bridge.checkpoint(task, wt.path)
            )

        # Phase 2: dispatch workers in a thread pool
        pending = [
            t for t in self.parallel_tasks()
            if (st := self._statuses.get(t.task_id)) and st.status == "pending"
        ]

        def run_one(task: Task) -> tuple[TaskStatus, dict[str, Any], float]:
            st = self._statuses[task.task_id]
            # Budget hard stop (checked per-task start; aggregate, not per-task)
            elapsed = time.monotonic() - mission_started
            if elapsed >= self.manifest.budget.max_duration_seconds:
                return st, {
                    "status": "fail",
                    "error": "budget_exhausted",
                    "reason": "mission duration budget reached",
                }, 0.0

            st.status = "running"
            task_started = time.monotonic()
            try:
                result = self._run_droid_in_worktree(task, droid_script, droid_args)
            except Exception as e:
                result = {"status": "fail", "error": str(e)}
                logger.exception("Task %s worker crashed", task.task_id)
            duration_ms = int((time.monotonic() - task_started) * 1000)
            return st, result, float(duration_ms)

        with ThreadPoolExecutor(max_workers=self.max_concurrent) as pool:
            futures = {pool.submit(run_one, t): t for t in pending}
            for fut in as_completed(futures):
                st, result, duration_ms = fut.result()
                st.budget_used += int(duration_ms)
                st.result = result
                if result.get("error") == "budget_exhausted":
                    st.status = "failed"
                elif result.get("status") == "pass":
                    st.status = "completed"
                elif result.get("status") in ("escalated", "rejected"):
                    st.status = (
                        "escalated" if result.get("status") == "escalated"
                        else "failed"
                    )
                else:
                    st.status = "failed"

        # Phase 3: Saga compensation for failed tasks (gap #3).
        # reverse_order by default — the manifest's saga block
        # declares the strategy; failed tasks are compensated in
        # reverse completion order so later mutations are undone
        # before earlier ones.
        self._compensate_failed_tasks()

        return dict(self._statuses)

    def _compensate_failed_tasks(self) -> None:
        """Run Saga compensation for every failed task.

        Uses the pre-mutation checkpoints captured in Phase 1c.
        Restores existing files from backup; deletes files that
        were new before the task ran. Only mutating tasks with
        checkpointed scope paths are compensated — read-only
        tasks have no side effects to undo.
        """
        failed_ids = [
            tid for tid, st in self._statuses.items()
            if st.status == "failed"
        ]
        if not failed_ids:
            return
        if self._saga_bridge is None:
            logger.warning(
                "Saga disabled — %d failed task(s) NOT compensated: %s",
                len(failed_ids), failed_ids,
            )
            return

        # reverse_order: compensate in reverse task order
        ordered = list(reversed(self.parallel_tasks()))
        to_compensate = [
            t for t in ordered
            if t.task_id in failed_ids and t.task_id in self._checkpoints
        ]
        logger.warning(
            "Saga compensation: %d task(s) — %s",
            len(to_compensate),
            [t.task_id for t in to_compensate],
        )
        for task in to_compensate:
            checkpoints = self._checkpoints.get(task.task_id) or {}
            compensation = self._saga_bridge.compensate(task, checkpoints)
            self._compensations[task.task_id] = compensation
            logger.warning(
                "Compensated %s: restored=%s deleted=%s errors=%s",
                task.task_id,
                compensation["restored"],
                compensation["deleted"],
                compensation["errors"],
            )

    def _run_droid_in_worktree(
        self,
        task: Task,
        droid_script: str,
        droid_args: dict[str, Any],
    ) -> dict[str, Any]:
        """Run the Droid worker synchronously in the task's worktree.

        The worker gets:
        - The task's per-task manifest (written into the worktree)
        - The droid script to execute
        - The worktree as its working directory

        This runs in the current process for now. In a full multi-agent
        setup it would spawn a sub-agent via delegate_task or CLI.
        """
        wt = self._worktrees[task.task_id]
        worktree_path = wt.path

        # Write the task's manifest into the worktree for the worker to read
        manifest_path = worktree_path / f"mission-{task.task_id}.json"
        manifest_path.write_text(wt.manifest_mirror.to_json())

        # Build command
        cmd = [
            sys.executable, droid_script,
            "--mission", str(manifest_path),
            "--worktree", str(worktree_path),
        ]
        if self.adjust_cmd:
            cmd += ["--adjust-cmd", self.adjust_cmd]
        cmd.extend(f"--{k}" for k in droid_args)
        for k, v in droid_args.items():
            cmd.append(str(v))

        logger.info("Running Droid for task %s in %s", task.task_id, worktree_path)

        env = {**os.environ, **self.worker_env}
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
                cwd=str(worktree_path),
                env=env,
            )
            return {
                "status": "pass" if proc.returncode == 0 else "fail",
                "exit_code": proc.returncode,
                "stdout": proc.stdout[-2000:] if proc.stdout else "",
                "stderr": proc.stderr[-2000:] if proc.stderr else "",
            }
        except subprocess.TimeoutExpired:
            return {"status": "fail", "error": "timeout after 600s"}
        except Exception as e:
            return {"status": "fail", "error": str(e)}

    def mark_completed(self, task_id: str, result: dict[str, Any]) -> None:
        """Mark a parallel task as completed."""
        if task_id in self._statuses:
            self._statuses[task_id].status = "completed"
            self._statuses[task_id].result = result

    def mark_failed(self, task_id: str, result: dict[str, Any]) -> None:
        """Mark a parallel task as failed — triggers Saga compensation."""
        if task_id in self._statuses:
            self._statuses[task_id].status = "failed"
            self._statuses[task_id].result = result
        logger.warning("Task %s failed — Saga compensation per manifest", task_id)

    def aggregate_results(self) -> dict[str, Any]:
        """Aggregate results from all parallel tasks.

        Budget: per-task budget_used (ms) plus a mission-level aggregate
        total — shared budget, no double counting (FRS-007 F02-R10).

        Returns:
            {
                "mission_id": str,
                "all_passed": bool,
                "task_results": {task_id: TaskStatus.__dict__},
                "budget_used": {task_id: int},           # ms per task
                "budget_used_total_ms": int,             # aggregate
                "budget_limit_ms": int,                  # budget.max_duration_seconds
                "worktree_timing": {task_id: {create_ms, install_ms, total_ms}},
                "worktree_timing_total_ms": int,
                "worktree_slowest_ms": int,
                "compensations": {task_id: {restored, deleted, errors}},
                "compensated_task_ids": [str],
            }
        """
        all_passed = all(
            s.status == "completed" for s in self._statuses.values()
        )
        budget_used = {k: v.budget_used for k, v in self._statuses.items()}
        timing = {
            k: {
                "create_ms": wt.create_duration_ms,
                "install_ms": wt.install_duration_ms,
                "total_ms": wt.create_duration_ms + wt.install_duration_ms,
            }
            for k, wt in self._worktrees.items()
        }
        totals = [t["total_ms"] for t in timing.values()]
        return {
            "mission_id": self.manifest.mission_id,
            "all_passed": all_passed,
            "task_results": {k: v.__dict__ for k, v in self._statuses.items()},
            "budget_used": budget_used,
            "budget_used_total_ms": sum(budget_used.values()),
            "budget_limit_ms": self.manifest.budget.max_duration_seconds * 1000,
            "worktree_timing": timing,
            "worktree_timing_total_ms": sum(totals),
            "worktree_slowest_ms": max(totals) if totals else 0,
            "compensations": dict(self._compensations),
            "compensated_task_ids": list(self._compensations.keys()),
        }

    def cleanup_worktrees(self) -> None:
        """Remove all created worktrees (post-mission cleanup).

        Calls `git worktree prune` first to clear any stale-but-registered
        entries (e.g. force-removed dirs whose metadata still lingers), then
        removes the real worktrees.
        """
        subprocess.run(["git", "worktree", "prune"], capture_output=True, timeout=30)
        for wt in list(self._worktrees.values()):
            try:
                subprocess.run(
                    ["git", "worktree", "remove", "--force", str(wt.path)],
                    check=True, capture_output=True, timeout=60,
                )
                logger.info("Removed worktree %s", wt.path)
            except subprocess.CalledProcessError:
                shutil.rmtree(wt.path, ignore_errors=True)
                logger.warning("Forced-removed worktree %s", wt.path)
        self._worktrees.clear()
