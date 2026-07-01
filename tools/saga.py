#!/usr/bin/env python3
"""
Saga Coordinator — Compensating Transaction Pattern for EdgeGDE Droid.

Part of EG-ARCH-0003: Implements the Saga pattern for multi-step mission
execution with automatic compensation on failure.

Usage:
  python3 tools/saga.py run manifest.json
  python3 tools/saga.py run manifest.json --dry-run
  python3 tools/saga.py compensate mission_log.json
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


# ── Constants ─────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[1]
HERMES_DIR = REPO_ROOT / ".hermes"
CHECKPOINT_DIR = HERMES_DIR / "checkpoints"
LOG_DIR = HERMES_DIR / "logs" / "missions"


# ── Types ─────────────────────────────────────────────────────────────────────

class Checkpoint:
    """A snapshot of a file before mutation."""

    def __init__(self, path: Path, backup_path: Path, checksum: str,
                 is_new_file: bool = False):
        self.path = path
        self.backup_path = backup_path
        self.checksum = checksum
        self.is_new_file = is_new_file

    def restore(self) -> None:
        """Restore file from checkpoint, or delete if it was a new file."""
        if self.is_new_file:
            if self.path.exists():
                self.path.unlink()
        elif self.backup_path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.backup_path, self.path)

    @staticmethod
    def create(target_path: Path) -> "Checkpoint":
        """Create a checkpoint of target_path before mutation."""
        target_path = target_path.resolve()
        checkpoint_dir = CHECKPOINT_DIR / f"saga_{int(time.time())}"
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

        backup_path = checkpoint_dir / target_path.name
        if target_path.exists():
            shutil.copy2(target_path, backup_path)
            checksum = hashlib.sha256(target_path.read_bytes()).hexdigest()[:16]
            return Checkpoint(target_path, backup_path, checksum, is_new_file=False)
        else:
            return Checkpoint(target_path, backup_path, "new_file", is_new_file=True)


class SagaTask:
    """A single task within a Saga mission."""

    def __init__(self, task_id: str, operation: str, args: dict,
                 depends_on: Optional[list[str]] = None,
                 compensate: Optional[dict] = None,
                 verification_criteria: Optional[list[str]] = None):
        self.task_id = task_id
        self.operation = operation
        self.args = args
        self.depends_on = depends_on or []
        self.compensate = compensate or {}
        self.verification_criteria = verification_criteria or []
        self.checkpoint: Optional[Checkpoint] = None
        self.status: str = "pending"  # pending | running | completed | failed | compensated
        self.error: Optional[str] = None
        self.output: Any = None

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "operation": self.operation,
            "status": self.status,
            "error": self.error,
            "has_checkpoint": self.checkpoint is not None,
            "compensate": bool(self.compensate),
        }


class SagaManifest:
    """A parsed Mission Manifest with Saga support."""

    def __init__(self, data: dict):
        self.mission_id: str = data["mission_id"]
        self.objective: str = data.get("objective", "")
        self.autonomy_level: str = data.get("autonomy_level", "low")
        saga_config = data.get("saga", {})
        self.compensation_strategy: str = saga_config.get("compensation_strategy", "reverse_order")
        self.partial_failure_policy: str = saga_config.get("partial_failure_policy", "compensate_all")
        self.tasks: list[SagaTask] = [
            SagaTask(
                task_id=t["task_id"],
                operation=t["operation"],
                args=t.get("args", {}),
                depends_on=t.get("depends_on", []),
                compensate=t.get("compensate", {}),
                verification_criteria=t.get("verification_criteria", []),
            )
            for t in data.get("tasks", [])
        ]
        self.constraints = data.get("constraints", {})

    @staticmethod
    def from_json(path: Path) -> "SagaManifest":
        with open(path) as f:
            return SagaManifest(json.load(f))

    def to_dict(self) -> dict:
        return {
            "mission_id": self.mission_id,
            "objective": self.objective,
            "compensation_strategy": self.compensation_strategy,
            "partial_failure_policy": self.partial_failure_policy,
            "task_count": len(self.tasks),
        }


# ── Operation Executors ──────────────────────────────────────────────────────

def _exec_write_text(task: SagaTask) -> dict:
    """Execute write_text operation with checkpoint."""
    path = Path(task.args["path"])
    content = task.args.get("content", "")

    # Expand ~ and resolve
    path = path.expanduser().resolve()

    # Create checkpoint BEFORE mutation
    task.checkpoint = Checkpoint.create(path)

    # Execute
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)

    checksum = hashlib.sha256(content.encode()).hexdigest()[:16]
    return {
        "output": f"Wrote {len(content)} bytes to {path}",
        "path": str(path),
        "checksum": checksum,
        "checkpoint": str(task.checkpoint.backup_path),
    }


def _comp_write_text(task: SagaTask) -> dict:
    """Compensate a write_text by restoring from checkpoint or deleting new file."""
    if task.checkpoint:
        was_new = task.checkpoint.is_new_file
        task.checkpoint.restore()
        action = "Deleted new file" if was_new else "Restored"
        return {"output": f"{action} {task.checkpoint.path}"}
    return {"output": "No checkpoint — cannot compensate"}


def _exec_delete(task: SagaTask) -> dict:
    """Execute delete operation with checkpoint."""
    path = Path(task.args["path"]).expanduser().resolve()

    # Create checkpoint BEFORE deletion
    task.checkpoint = Checkpoint.create(path)

    # Execute
    if path.is_file():
        path.unlink()
        return {"output": f"Deleted file: {path}"}
    elif path.is_dir():
        shutil.rmtree(path)
        return {"output": f"Deleted directory: {path}"}
    else:
        return {"output": f"Path does not exist: {path}"}


def _comp_delete(task: SagaTask) -> dict:
    """Compensate a delete by restoring from checkpoint."""
    if task.checkpoint:
        task.checkpoint.restore()
        return {"output": f"Restored {task.checkpoint.path} from checkpoint"}
    return {"output": "No checkpoint — cannot compensate"}


def _exec_read_file(task: SagaTask) -> dict:
    """Read-only — no mutation, no checkpoint needed."""
    path = Path(task.args["path"]).expanduser().resolve()
    if path.exists():
        content = path.read_text()
        return {"output": content[:500], "size": len(content)}
    return {"output": "File not found", "size": 0, "error": f"{path} does not exist"}


def _exec_shell(task: SagaTask) -> dict:
    """Execute shell command. Relies on declared compensate for reversal."""
    command = task.args.get("command", "")
    timeout = task.args.get("timeout", 120)

    try:
        r = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return {
            "output": r.stdout[-2000:] if r.stdout else r.stderr[-2000:],
            "exit_code": r.returncode,
            "stdout_len": len(r.stdout or ""),
            "stderr_len": len(r.stderr or ""),
        }
    except subprocess.TimeoutExpired:
        return {"output": "Command timed out", "exit_code": -1, "error": "timeout"}
    except Exception as e:
        return {"output": str(e), "exit_code": -1, "error": str(e)}


# ── Operation Registry ───────────────────────────────────────────────────────

EXECUTORS = {
    "write_text": _exec_write_text,
    "delete": _exec_delete,
    "read_file": _exec_read_file,
    "shell": _exec_shell,
}

COMPENSATORS = {
    "write_text": _comp_write_text,
    "delete": _comp_delete,
    "read_file": lambda t: {"output": "Read-only — no compensation needed"},
    "shell": _exec_shell,  # Re-runs the declared compensate command
}


# ── Saga Coordinator ─────────────────────────────────────────────────────────

class SagaCoordinator:
    """Executes a Saga mission with automatic compensation on failure."""

    def __init__(self, manifest: SagaManifest, dry_run: bool = False):
        self.manifest = manifest
        self.dry_run = dry_run
        self.completed: list[SagaTask] = []
        self.failed: Optional[SagaTask] = None
        self.compensated: list[SagaTask] = []
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None

    def run(self) -> dict:
        """Execute all tasks in order. On failure, compensate."""
        self.start_time = time.time()
        print(f"Saga [{self.manifest.mission_id}]: {self.manifest.objective}")
        print(f"  Strategy: {self.manifest.compensation_strategy}")
        print(f"  Fail policy: {self.manifest.partial_failure_policy}")
        print(f"  Tasks: {len(self.manifest.tasks)}")

        if self.dry_run:
            print("\n[DRY RUN] Task order:")
            for i, task in enumerate(self.manifest.tasks):
                deps = f" (after: {', '.join(task.depends_on)})" if task.depends_on else ""
                comp = f" → compensate: {task.compensate.get('operation', 'none')}" if task.compensate else ""
                print(f"  [{i+1}] {task.task_id}: {task.operation} {comp}{deps}")
            print("[DRY RUN] No files modified.\n")
            return self._report()

        for task in self.manifest.tasks:
            success = self._execute_task(task)
            if not success:
                self.failed = task
                print(f"\n  ⚠️  Task {task.task_id} FAILED: {task.error}")
                break

        if self.failed:
            self._compensate()

        self.end_time = time.time()
        return self._report()

    def _execute_task(self, task: SagaTask) -> bool:
        """Execute a single task. Returns True on success."""
        executor = EXECUTORS.get(task.operation)
        if not executor:
            task.status = "failed"
            task.error = f"Unknown operation: {task.operation}"
            return False

        task.status = "running"
        print(f"\n  [{task.task_id}] {task.operation} ...", end=" ")

        try:
            result = executor(task)
            task.output = result

            if result.get("exit_code", 0) not in (0, None):
                task.status = "failed"
                task.error = result.get("error", f"Exit code: {result.get('exit_code')}")
                return False

            task.status = "completed"
            self.completed.append(task)
            print(f"OK ({result.get('output', '')[:60]})")
            return True

        except Exception as e:
            task.status = "failed"
            task.error = str(e)
            return False

    def _compensate(self) -> None:
        """Execute compensation for all completed tasks in reverse order."""
        print(f"\n  ═══ Saga Compensation ═══")
        print(f"  Strategy: {self.manifest.compensation_strategy}")
        print(f"  Compensating {len(self.completed)} completed task(s) in reverse order...")

        # Determine compensation order
        if self.manifest.compensation_strategy == "reverse_order":
            tasks_to_compensate = list(reversed(self.completed))
        elif self.manifest.compensation_strategy == "parallel":
            tasks_to_compensate = list(self.completed)
        else:
            print("  [manual] Tasks logged, no auto-compensation.")
            return

        for task in tasks_to_compensate:
            self._compensate_task(task)

    def _compensate_task(self, task: SagaTask) -> None:
        """Execute a single task's compensation."""
        compensate_config = task.compensate
        if not compensate_config:
            task.status = "compensated"
            self.compensated.append(task)
            print(f"    [{task.task_id}] No compensate defined — skipped")
            return

        comp_op = compensate_config.get("operation")
        compensator = COMPENSATORS.get(comp_op)
        if not compensator:
            print(f"    [{task.task_id}] No compensator for '{comp_op}' — manual recovery needed")
            return

        # Shell operations use their declared compensate command
        if comp_op == "shell" or task.operation == "shell":
            shell_cmd = compensate_config.get("args", {}).get("command", "")
            if shell_cmd:
                try:
                    subprocess.run(shell_cmd, shell=True, capture_output=True, text=True, timeout=60)
                    print(f"    [{task.task_id}] Compensated via shell: {shell_cmd[:60]}")
                    task.status = "compensated"
                    self.compensated.append(task)
                    return
                except Exception as e:
                    print(f"    [{task.task_id}] Shell compensation failed: {e}")
                    return

        # File operations: restore from checkpoint
        result = compensator(task)
        task.status = "compensated"
        self.compensated.append(task)
        print(f"    [{task.task_id}] {result.get('output', 'OK')}")

    def _report(self) -> dict:
        """Produce the structured execution report."""
        duration = (self.end_time - self.start_time) if self.end_time and self.start_time else 0
        status = "failure" if self.failed else "success"

        report = {
            "mission_id": self.manifest.mission_id,
            "objective": self.manifest.objective,
            "status": status,
            "compensation_strategy": self.manifest.compensation_strategy,
            "partial_failure_policy": self.manifest.partial_failure_policy,
            "compensation_used": self.failed is not None,
            "duration_seconds": round(duration, 2),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "tasks": {
                "total": len(self.manifest.tasks),
                "completed": len(self.completed),
                "failed": 1 if self.failed else 0,
                "compensated": len(self.compensated),
            },
            "task_details": [t.to_dict() for t in self.manifest.tasks],
            "errors": [t.error for t in self.manifest.tasks if t.error],
            "dry_run": self.dry_run,
        }

        return report


# ── CLI ──────────────────────────────────────────────────────────────────────

def cmd_run(args):
    """Execute a Saga mission from a Mission Manifest JSON file."""
    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        print(f"Error: manifest not found: {manifest_path}")
        sys.exit(1)

    manifest = SagaManifest.from_json(manifest_path)
    coordinator = SagaCoordinator(manifest, dry_run=args.dry_run)
    report = coordinator.run()

    # Write report
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    report_file = LOG_DIR / f"{manifest.mission_id}.report.json"
    with open(report_file, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n  Report: {report_file}")

    if report["status"] == "failure":
        print(f"  ❌ Mission FAILED. {report['tasks']['compensated']} task(s) compensated.")
        if report["errors"]:
            for err in report["errors"]:
                print(f"     Error: {err}")
        sys.exit(1)
    else:
        print(f"  ✅ Mission succeeded. {report['tasks']['completed']} task(s) completed.")
        sys.exit(0)


def cmd_compensate(args):
    """Manually trigger compensation from a saved report."""
    report_path = Path(args.report)
    if not report_path.exists():
        print(f"Error: report not found: {report_path}")
        sys.exit(1)

    with open(report_path) as f:
        report = json.load(f)

    print(f"Manual compensation for mission {report['mission_id']}")
    print(f"  Original status: {report['status']}")
    print(f"  Tasks completed: {report['tasks']['completed']}")
    print(f"  Tasks compensated: {report['tasks'].get('compensated', 0)}")
    print("(Manual compensation CLI — coordinate via checkpoints)")


def main():
    parser = argparse.ArgumentParser(
        description="Saga Coordinator — Compensating Transaction Pattern"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("run", help="Execute a Saga mission from a manifest")
    p.add_argument("manifest", help="Path to Mission Manifest JSON file")
    p.add_argument("--dry-run", action="store_true", help="Preview without executing")

    p = sub.add_parser("compensate", help="Manual compensation from a saved report")
    p.add_argument("report", help="Path to mission report JSON file")

    args = parser.parse_args()
    {"run": cmd_run, "compensate": cmd_compensate}[args.command](args)


if __name__ == "__main__":
    main()
