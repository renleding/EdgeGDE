"""RhinoClaw bridge helper for the FRS-012 harness.

Reuses the closed_loop engine's transport (single source of truth for the TCP
protocol). Integration tests use get_session(); pure-logic tests do not need this.
"""
import os
import sys

REPO_ROOT = os.environ.get("EDGEGDE_ROOT",
                           os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "packages"))

from gh_automation_core.closed_loop import RhinoClawBridge, ClosedLoopSession


def get_bridge():
    return RhinoClawBridge(
        host=os.environ.get("RHINOCLAW_HOST", "100.110.105.101"),
        port=int(os.environ.get("RHINOCLAW_PORT", "1999")))


def get_session():
    return ClosedLoopSession(get_bridge())
