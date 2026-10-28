"""pytest config for the FRS-012 harness. CI-ready.

NOTE: in the dev sandbox a macOS TCC block denies importing packages under
~/Documents, so these tests cannot execute locally; they run in CI / the real
runtime where the repo is readable. Pure-logic assertions were verified offline
via exec-load (see session evidence)."""
import os
import sys

REPO_ROOT = os.environ.get("EDGEGDE_ROOT",
                           os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "packages"))

import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "integration: needs a live RhinoClaw session (RHINOCLAW_HOST)")
