"""Shared pytest path setup for automation/automation_bridge.

automation/automation_bridge modules import Hermes state-engine internals
(action_engine, verification, state_diff, state_cache, cdp_connection,
failure_envelope, salestrekker_rules) straight from apps/state-engine —
the same layout the AutomationBridge Action Bridge demo used. Put both directories
on sys.path so `pytest automation/automation_bridge` works from the repo root.
"""
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_STATE_ENGINE_DIR = _REPO_ROOT / "apps" / "state-engine"

for _p in (str(Path(__file__).resolve().parent), str(_STATE_ENGINE_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)
