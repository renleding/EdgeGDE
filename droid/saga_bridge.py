"""
Saga bridge — wires tools/saga.py into the Droid parallel
coordinator (gap #3, issue #258).

tools/saga.py is a standalone CLI (SagaCoordinator /
SagaManifest / Checkpoint) but tools/ is not a Python
package. This module loads it by file path so the
coordinator can trigger real compensation — restore-from-
checkpoint or new-file-deletion — instead of only logging
that compensation is needed (F04-R05).

Design notes:
- Loaded once, lazily, via importlib.util so tools/ stays
  importable without touching its layout.
- Checkpoints land under <repo>/.hermes/checkpoints (the
  saga.py convention), per worktree task — compensation
  restores exactly what the task mutated.
- Compensation strategy (reverse_order / parallel / manual)
  and partial failure policy come from the manifest's
  saga block, so the coordinator's behaviour matches the
  operator's declared intent.
"""

import importlib.util
import logging
import shutil
import sys
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("droid.saga_bridge")

# tools/saga.py lives at the repo root next to droid/
_TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"
_SAGA_PATH = _TOOLS_DIR / "saga.py"

_saga_module: Optional[Any] = None


def _load_saga_module():
    """Import tools/saga.py as a module (not a package member)."""
    global _saga_module
    if _saga_module is not None:
        return _saga_module
    if not _SAGA_PATH.exists():
        raise FileNotFoundError(
            f"saga.py not found at {_SAGA_PATH}"
        )
    spec = importlib.util.spec_from_file_location(
        "droid_saga", _SAGA_PATH
    )
    if spec is None or spec.loader is None:
        raise ImportError(
            f"Could not load saga.py from {_SAGA_PATH}"
        )
    module = importlib.util.module_from_spec(spec)
    # saga.py runs argparse only under __main__; safe to exec
    sys.modules["droid_saga"] = module
    spec.loader.exec_module(module)
    _saga_module = module
    return _saga_module


class SagaBridge:
    """Checkpoint + compensate a single task's worktree mutations.

    Usage in the coordinator:
        bridge = SagaBridge()
        # before a mutating task runs:
        bridge.checkpoint(task, worktree_path)
        # when the task fails:
        bridge.compensate(task)
    """

    def __init__(self):
        module = _load_saga_module()
        self._Checkpoint = module.Checkpoint
        self._SagaTask = module.SagaTask

    def checkpoint(self, task, worktree_path: Path) -> Any:
        """Snapshot the files a task will mutate, inside its
        worktree, BEFORE the task runs.

        task.scope lists the paths the task touches (relative
        to the worktree). Each is checkpointed individually so
        compensation restores exactly those files.

        Returns a {path: Checkpoint} dict (empty for read-only
        or unscoped tasks — nothing to compensate).
        """
        scope = task.scope or []
        checkpoints: dict[str, Any] = {}
        for rel in scope:
            target = (worktree_path / rel).resolve()
            # Only checkpoint inside the worktree (never the
            # shared checkout — worktree isolation is the point)
            try:
                target.relative_to(worktree_path.resolve())
            except ValueError:
                logger.warning(
                    "Skipping checkpoint outside worktree: %s",
                    target,
                )
                continue
            checkpoints[rel] = self._Checkpoint.create(target)
        logger.info(
            "Checkpointed %d path(s) for task %s",
            len(checkpoints), task.task_id,
        )
        return checkpoints

    def compensate(
        self, task, checkpoints: dict[str, Any],
    ) -> dict[str, Any]:
        """Restore a task's checkpointed files.

        For each checkpoint: existing files are restored from
        the backup; new files (is_new_file) are deleted —
        matching tools/saga.py's _comp_write_text semantics.

        Returns {restored: [...], deleted: [...], errors: [...]}.
        """
        restored: list[str] = []
        deleted: list[str] = []
        errors: list[str] = []
        for rel, cp in (checkpoints or {}).items():
            try:
                if cp.is_new_file:
                    if cp.path.exists():
                        cp.path.unlink()
                        deleted.append(rel)
                elif cp.backup_path.exists():
                    cp.path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(cp.backup_path, cp.path)
                    restored.append(rel)
            except Exception as e:
                errors.append(f"{rel}: {e}")
                logger.exception(
                    "Compensation failed for %s (%s)", rel, task.task_id
                )
        logger.info(
            "Compensated task %s: restored=%d deleted=%d errors=%d",
            task.task_id, len(restored), len(deleted), len(errors),
        )
        return {
            "restored": restored,
            "deleted": deleted,
            "errors": errors,
        }
