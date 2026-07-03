#!/usr/bin/env python3
"""
DAG Task Scheduler (EG-ARCH-0006)

Generic DAG-based task scheduler with:
- Cycle detection
- Parallel execution of independent tasks
- Dependency-gated fan-in
- Failure cascading to dependents
"""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class TaskNode:
    """A single node in the task DAG."""
    task_id: str
    operation: str
    args: dict
    depends_on: list[str] = field(default_factory=list)
    executor_fn: Optional[Callable] = None
    status: str = "pending"
    error: Optional[str] = None
    result: Any = None
    duration_ms: float = 0.0


class CycleError(Exception):
    def __init__(self, cycle_tasks: list[str]):
        self.cycle_tasks = cycle_tasks
        super().__init__(f"Cycle detected: {' → '.join(cycle_tasks)}")


class DAGScheduler:
    """
    DAG-based task scheduler with parallel execution.

    Tasks declare dependencies via `depends_on`. The scheduler:
    1. Validates the DAG (no cycles, all deps exist)
    2. Finds root tasks (no dependencies) and executes in parallel
    3. Fans-in: executes dependent tasks once all ancestors complete
    4. On failure: cascades abort to all downstream dependents
    """

    def __init__(self, tasks: list[TaskNode], max_workers: int = 4):
        self.tasks = {t.task_id: t for t in tasks}
        self.max_workers = max_workers

    def run(self) -> dict:
        self._validate()
        task_map = dict(self.tasks)
        completed_ids: set[str] = set()
        failed_ids: set[str] = set()
        skipped_ids: set[str] = set()
        pending_ids: set[str] = set(task_map.keys())

        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            while pending_ids:
                ready = []
                for tid in list(pending_ids):
                    task = task_map[tid]
                    deps = set(task.depends_on)
                    if deps.intersection(failed_ids | skipped_ids):
                        task.status = "skipped"
                        skipped_ids.add(tid)
                        pending_ids.discard(tid)
                    elif deps.issubset(completed_ids):
                        ready.append(task)
                        pending_ids.discard(tid)

                if not ready and pending_ids:
                    stuck = [tid for tid in pending_ids
                             if task_map[tid].depends_on
                             and not set(task_map[tid].depends_on).issubset(
                                 completed_ids | failed_ids | skipped_ids)]
                    still_pending = set(tid for tid in pending_ids if tid not in stuck)
                    if still_pending:
                        continue
                    if stuck:
                        return {"status": "failure", "stuck": stuck,
                                "completed": list(completed_ids), "failed": list(failed_ids),
                                "skipped": list(skipped_ids)}

                futures = {}
                for task in ready:
                    future = pool.submit(self._execute_task, task)
                    futures[future] = task

                for future in as_completed(futures):
                    task = futures[future]
                    try:
                        success, error = future.result()
                        if success:
                            completed_ids.add(task.task_id)
                        else:
                            failed_ids.add(task.task_id)
                    except Exception as e:
                        task.status = "failed"
                        task.error = str(e)
                        failed_ids.add(task.task_id)

        return {"status": "success" if not failed_ids else "failure",
                "total": len(task_map),
                "completed": sorted(completed_ids),
                "failed": sorted(failed_ids),
                "skipped": sorted(skipped_ids)}

    def _validate(self):
        task_map = dict(self.tasks)
        for tid, task in task_map.items():
            for dep in task.depends_on:
                if dep not in task_map:
                    raise ValueError(f"Task '{tid}' depends on unknown '{dep}'")
        visited = set()
        recursion_stack = set()
        path = []

        def dfs(node_id: str):
            visited.add(node_id)
            recursion_stack.add(node_id)
            path.append(node_id)
            for dep in task_map[node_id].depends_on:
                if dep not in visited:
                    dfs(dep)
                elif dep in recursion_stack:
                    cycle = path[path.index(dep):] + [dep]
                    raise CycleError(cycle)
            path.pop()
            recursion_stack.discard(node_id)

        for tid in task_map:
            if tid not in visited:
                dfs(tid)

    def _execute_task(self, task: TaskNode) -> tuple[bool, Optional[str]]:
        task.status = "running"
        start = time.time()
        try:
            if task.executor_fn:
                task.result = task.executor_fn(task)
            task.status = "completed"
            task.duration_ms = (time.time() - start) * 1000
            return True, None
        except Exception as e:
            task.status = "failed"
            task.error = str(e)
            task.duration_ms = (time.time() - start) * 1000
            return False, str(e)


if __name__ == "__main__":
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", help="DAG manifest JSON")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    data = json.loads(Path(args.manifest).read_text())
    tasks = []
    for t in data.get("tasks", []):
        node = TaskNode(task_id=t["task_id"], operation=t["operation"],
                        args=t.get("args", {}), depends_on=t.get("depends_on", []))
        if node.operation == "shell":
            def make_shell(t):
                def exec(_):
                    import subprocess
                    r = subprocess.run(t.args.get("command", ""), shell=True,
                                       capture_output=True, text=True, timeout=t.args.get("timeout", 60))
                    if r.returncode != 0:
                        raise RuntimeError(f"Exit {r.returncode}: {r.stderr[:200]}")
                    return r.stdout[:1000]
                return exec
            node.executor_fn = make_shell(t)
        elif node.operation == "write_text":
            def make_write(t):
                def exec(_):
                    p = Path(t.args["path"]).expanduser().resolve()
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(t.args.get("content", ""))
                    return {"path": str(p), "bytes": len(t.args.get("content", ""))}
                return exec
            node.executor_fn = make_write(t)
        tasks.append(node)
    sched = DAGScheduler(tasks, max_workers=args.workers)
    print(json.dumps(sched.run()))
