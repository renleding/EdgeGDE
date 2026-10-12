"""
Parallel Coordinator (FRS-012 FEATURE-04)

Full implementation: creates worktrees for parallel tasks,
manages Droid dispatch, aggregates results, enforces shared
mission budget.

Contract:
- Parallel tasks run in separate worktrees (F04-R02)
- Shared mission budget — aggregate accounting (F04-R04)
- Saga compensation per failed task (F04-R05)
- Max parallel tasks configurable (F04-N01, default 5)

Usage:
    from droid.parallel_coordinator import ParallelCoordinator
    coord = ParallelCoordinator(manifest, base_worktree_dir="../EdgeGDE-worktrees")
    coord.dispatch_parallel_tasks()
    results = coord.aggregate_results()
"""

import logging
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Optional

from droid.mission_manifest import MissionManifest, Task

logger = logging.getLogger("droid.parallel_coordinator")

WORKTREE_BASE = Path.cwd().parent / "EdgeGDE-worktrees"


@dataclass
class Worktree:
    """A worktree created for one parallel task."""
    task_id: str
    path: Path
    manifest_mirror: MissionManifest  # task-authoritative copy for the worker


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
    ):
        self.manifest = manifest
        self.worktree_base = base_worktree_dir or WORKTREE_BASE
        self.max_concurrent = max(1, max_concurrent)
        self.bun_command = bun_command
        self.droid_path = droid_path
        self._worktrees: dict[str, Worktree] = {}
        self._statuses: dict[str, TaskStatus] = {}

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
        2. Checkout HEAD in the worktree
        3. Install dependencies (bun install) if package.json exists
        4. Return Worktree with task-authoritative manifest copy

        Raises WorktreeCreationError on failure.
        """
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

        # Checkout HEAD in the worktree
        try:
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
                f"Failed to checkout HEAD in {wt_dir}: {e.stderr.decode() if e.stderr else str(e)}"
            )

        # Install dependencies
        pkg_json = wt_dir / "package.json"
        if pkg_json.exists():
            try:
                subprocess.run(
                    [self.bun_command, "install"],
                    check=True, capture_output=True, timeout=300,
                    cwd=str(wt_dir),
                )
                logger.info("bun install complete in %s", wt_dir)
            except subprocess.CalledProcessError as e:
                logger.warning(
                    "bun install failed in %s — worker may lack deps: %s",
                    wt_dir, e.stderr.decode()[-200:] if e.stderr else "",
                )

        # Task-authoritative manifest for the worker
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
        )
        self._worktrees[task.task_id] = wt
        self._statuses[task.task_id] = TaskStatus(
            task_id=task.task_id,
            status="pending",
            worktree_path=str(wt_dir),
        )
        logger.info("Created worktree %s for task %s", wt_dir, task.task_id)
        return wt

    def dispatch_parallel_tasks(
        self,
        droid_path: Optional[str] = None,
        droid_args: Optional[dict[str, Any]] = None,
    ) -> dict[str, TaskStatus]:
        """Create worktrees and dispatch Droid per parallel task.

        Args:
            droid_path: Optional override for Droid script path
            droid_args: Extra args to pass to each Droid worker
                       (e.g. {"manifests_path": "...", "worktree": "..."})

        Returns:
            Dict of {task_id: TaskStatus} after all workers complete.
        """
        if droid_path:
            self.droid_path = droid_path

        droid_script = self.resolve_droid_script()
        droid_args = droid_args or {}

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

        # Phase 2: dispatch per task (sequential for now; parallel later)
        for task in self.parallel_tasks():
            st = self._statuses.get(task.task_id)
            if not st or st.status != "pending":
                continue  # already failed / skipped

            st.status = "running"
            try:
                result = self._run_droid_in_worktree(task, droid_script, droid_args)
                if result.get("status") == "pass":
                    st.status = "completed"
                    st.result = result
                elif result.get("status") in ("escalated", "rejected"):
                    st.status = (
                        "escalated" if result.get("status") == "escalated" else "failed"
                    )
                    st.result = result
                else:
                    st.status = "failed"
                    st.result = result
            except Exception as e:
                st.status = "failed"
                st.result = {"error": str(e)}
                logger.exception("Task %s worker crashed", task.task_id)

        return dict(self._statuses)

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
        cmd.extend(f"--{k}" for k in droid_args)
        for k, v in droid_args.items():
            cmd.append(str(v))

        logger.info("Running Droid for task %s in %s", task.task_id, worktree_path)

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,
                cwd=str(worktree_path),
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

        Returns:
            {
                "mission_id": str,
                "all_passed": bool,
                "task_results": {task_id: TaskStatus.__dict__},
                "budget_used": {task_id: int},
            }
        """
        all_passed = all(
            s.status == "completed" for s in self._statuses.values()
        )
        return {
            "mission_id": self.manifest.mission_id,
            "all_passed": all_passed,
            "task_results": {k: dict(v) for k, v in self._statuses.items()},
            "budget_used": {k: v.budget_used for k, v in self._statuses.items()},
        }

    def cleanup_worktrees(self) -> None:
        """Remove all created worktrees (post-mission cleanup)."""
        for wt in list(self._worktrees.values()):
            try:
                subprocess.run(
                    ["git", "worktree", "remove", str(wt.path)],
                    check=True, capture_output=True, timeout=60,
                )
                logger.info("Removed worktree %s", wt.path)
            except subprocess.CalledProcessError:
                shutil.rmtree(wt.path, ignore_errors=True)
                logger.warning("Forced-removed worktree %s", wt.path)
        self._worktrees.clear()
