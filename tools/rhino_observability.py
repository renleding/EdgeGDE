#!/usr/bin/env python3
"""
Rhino + Grasshopper Observability Wrapper (Option 2: inferred health)
Zero Rhino-side code. Uses existing RhinoClaw wire protocol signals.
"""

import json
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any

# Ensure rhinoclaw is importable (lives in scratch dir)
SCRATCH = Path("/Users/warren/.hermes/cache/scratch")
sys.path.insert(0, str(SCRATCH))

from rhinoclaw import send


# ──────────────────────────────────────────────────────────────────────
# Ring buffer for delta events (last 50)
# ──────────────────────────────────────────────────────────────────────
_EVENT_BUFFER = deque(maxlen=50)
_LAST_STATE = {}


def _emit_event(level: str, message: str):
    """Append a delta event to the ring buffer."""
    _EVENT_BUFFER.append({
        "ts": time.time(),
        "level": level,
        "msg": message
    })


def _check_delta(key: str, new_val: Any) -> bool:
    """Return True if value changed since last check."""
    old = _LAST_STATE.get(key)
    if old != new_val:
        _LAST_STATE[key] = new_val
        return True
    return False


# ──────────────────────────────────────────────────────────────────────
# Health inference from existing RhinoClaw commands
# ──────────────────────────────────────────────────────────────────────
def infer_rhino_health() -> dict:
    """Infer Rhino/RhinoClaw health from scene_summary call."""
    try:
        res = send("scene_summary", {}, timeout=10)
        if res.get("status") == "success":
            return {
                "rhino": "CONNECTED",
                "rhinoclaw": "RUNNING",
                "listener": "ACTIVE",
                "document": res.get("result", {}).get("document", "unknown"),
                "last_error": None
            }
    except Exception as e:
        pass
    return {
        "rhino": "DISCONNECTED",
        "rhinoclaw": "STOPPED",
        "listener": "FAILED",
        "document": None,
        "last_error": "scene_summary failed"
    }


def infer_gh_health(definition_id: str) -> dict:
    """Infer GH health from solve + outputs."""
    # Solve
    solve_res = send("solve_grasshopper", {"definition_id": definition_id}, timeout=120)
    solve_data = solve_res.get("result", {})
    solve_ms = solve_data.get("solution", {}).get("duration_ms", 0)
    runtime_msgs = solve_data.get("runtime_messages", [])
    errors = [m for m in runtime_msgs if m.get("level") == "error"]
    warnings = [m for m in runtime_msgs if m.get("level") == "warning"]

    # Outputs
    out_res = send("get_grasshopper_outputs", {"definition_id": definition_id}, timeout=30)
    outputs = out_res.get("result", {}).get("outputs", {})

    # Critical path status
    def comp_status(comp_name: str) -> str:
        for key, val in outputs.items():
            if comp_name in val.get("component", ""):
                if val.get("count", 0) > 0:
                    return "GREEN"
        return "RED"

    twist_ok = comp_status("Twist")
    populate_ok = comp_status("Populate 3D Grid")
    scalar_ok = comp_status("Gyroid Scalar Field")
    isomesh_ok = comp_status("Gyroid IsoMesh")

    # Points / faces
    points = 0
    faces = 0
    for key, val in outputs.items():
        if "Populate 3D Grid" in val.get("component", "") and val.get("type") == "Point":
            points = val.get("count", 0)
        if "Gyroid IsoMesh" in val.get("component", "") and val.get("type") == "Mesh":
            # sum faces across all mesh outputs
            vals = val.get("values", [])
            for v in vals:
                if isinstance(v, str) and "faces:" in v:
                    try:
                        faces += int(v.split("faces:")[1].split(")")[0].strip())
                    except:
                        pass

    return {
        "gh_loaded": True,
        "solve_ms": round(solve_ms, 1),
        "red": len(errors),
        "warnings": len(warnings),
        "errors": len(errors),
        "twist": twist_ok,
        "populate": populate_ok,
        "scalar": scalar_ok,
        "isomesh": isomesh_ok,
        "points": points,
        "faces": faces
    }


# ──────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────
def get_status(definition_id: str = "0846fdcc") -> dict:
    """
    Returns the unified health + critical path snapshot.
    Also emits delta events for anything that changed.
    """
    rhino = infer_rhino_health()
    gh = infer_gh_health(definition_id)

    # Merge
    status = {**rhino, **gh}

    # Emit delta events
    for key in ["rhino", "rhinoclaw", "listener", "solve_ms", "red", "warnings", "errors",
                "twist", "populate", "scalar", "isomesh", "points", "faces"]:
        if _check_delta(key, status.get(key)):
            _emit_event("INFO", f"{key}: {_LAST_STATE.get(key, 'UNKNOWN')} → {status.get(key)}")

    # Add event log
    status["events"] = list(_EVENT_BUFFER)
    return status


def clear_events():
    """Reset the event buffer."""
    _EVENT_BUFFER.clear()
    _LAST_STATE.clear()


# ──────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    def_id = sys.argv[1] if len(sys.argv) > 1 else "0846fdcc"
    result = get_status(def_id)
    print(json.dumps(result, indent=2))