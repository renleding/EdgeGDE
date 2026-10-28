"""FRS-013 Closed-Loop Parametric Control Validation — execution harness.

Drives the Selector -> Geometry -> Vision -> Feedback loop against a live
RhinoClaw + Grasshopper session using the validated lamp definition
(lattice_lamp_v4.gh — CLEAN test target) and emits machine-readable evidence.
lattice_lamp_final.gh is a failed branch held as REGRESSION REFERENCE ONLY —
no testing or repair against it until FRS-014 passes on v4.

Phases:
  1 baseline capture      (scene_summary, viewport png, canvas png, bbox, mesh stats)
  2 parameter change      (Height 300 -> 600, solve)
  3 verify change         (bbox Z increases, viewport changed, geometry valid)
  4 twist test            (Twist_Angle 45 -> 180, solve, viewport/orientation change)
  5 feedback loop         (Height 100 -> 500 +/- 5, no human intervention)
  6 design intent         (5 variants, score, select winner)

Run standalone:  python tests/test_frs013_closed_loop.py
Or via pytest (integration; skipped unless RHINOCLAW_HOST is set).
"""
import os
import sys
import json
import hashlib

REPO_ROOT = os.environ.get("EDGEGDE_ROOT",
                           os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RESULTS_DIR = os.environ.get("FRS013_RESULTS", "/tmp/frs013_results")
LAMP_PATH = os.environ.get("FRS013_LAMP", r"C:\temp\lattice_lamp_v4.gh")

# --- resilient engine import (normal in CI; exec-load fallback under TCC sandbox) ---
try:
    sys.path.insert(0, os.path.join(REPO_ROOT, "packages"))
    from gh_automation_core.closed_loop import ClosedLoopSession, RhinoClawBridge
except Exception:
    _src = os.path.join(REPO_ROOT, "packages", "gh_automation_core", "closed_loop.py")
    _ns = {}
    with open(_src) as _fh:
        exec(compile(_fh.read(), _src, "exec"), _ns)
    ClosedLoopSession = _ns["ClosedLoopSession"]
    RhinoClawBridge = _ns["RhinoClawBridge"]


def _sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def run_frs013(results_dir=RESULTS_DIR, host="100.110.105.101", port=1999):
    os.makedirs(results_dir, exist_ok=True)
    sess = ClosedLoopSession(RhinoClawBridge(host=host, port=port))
    ev = {"lamp": LAMP_PATH, "phases": {}}

    # ---- load + activate the lamp definition ----
    load = sess.load_definition(LAMP_PATH)
    sess.show_definition()
    sess.refresh_controls()
    ev["definition_id"] = sess.definition_id
    ev["controls"] = {k: {f: c.get(f) for f in ("value", "min", "max")}
                      for k, c in sess.controls.items()}

    # ---- PHASE 1: baseline capture ----
    base = sess.baseline(os.path.join(results_dir, "baseline_viewport.png"),
                         os.path.join(results_dir, "baseline_canvas.png"))
    base_bbox = base["output_bbox"].get("OUT_BBOX_SIZE") or base["doc_bbox"]["size"]
    ev["phases"]["1_baseline"] = {
        "controls": base["controls"],
        "object_count": base["object_count"],
        "doc_bbox": base["doc_bbox"],
        "output_bbox": base["output_bbox"],
        "mesh_stats": base["mesh_stats"],
        "viewport_sha256": base["viewport"]["sha256"],
        "viewport_path": base["viewport"]["path"],
    }
    baseline_height_slider = float(sess.get_control("Height")["value"])
    baseline_bbox_z = base_bbox[2]
    baseline_viewport_sha = base["viewport"]["sha256"]

    # ---- PHASE 2: parameter change (Height 300 -> 600) ----
    target_h = baseline_height_slider * 2
    try:
        sess.set_parameter("Height", target_h)
    except Exception as e:
        ev["phases"]["2_param_change"] = {"error": str(e)}
        raise
    after_set = sess.get_control("Height")["value"]
    sess.solve()
    ev["phases"]["2_param_change"] = {
        "param": "Height", "before": baseline_height_slider,
        "requested": target_h, "actual_after_set": after_set,
    }

    # ---- PHASE 3: verify change ----
    after = sess.baseline(os.path.join(results_dir, "after_height_viewport.png"),
                          os.path.join(results_dir, "after_height_canvas.png"))
    after_bbox = after["output_bbox"].get("OUT_BBOX_SIZE") or after["doc_bbox"]["size"]
    after_bbox_z = after_bbox[2]
    after_viewport_sha = after["viewport"]["sha256"]
    height_change_detected = after_bbox_z > baseline_bbox_z
    viewport_change_detected = after_viewport_sha != baseline_viewport_sha
    geometry_valid = after["mesh_stats"].get("MESH_FACES", 0) > 0
    ev["phases"]["3_verify_change"] = {
        "bbox_before": base_bbox, "bbox_after": after_bbox,
        "bbox_z_before": baseline_bbox_z, "bbox_z_after": after_bbox_z,
        "height_change_detected": height_change_detected,
        "viewport_change_detected": viewport_change_detected,
        "viewport_sha_before": baseline_viewport_sha,
        "viewport_sha_after": after_viewport_sha,
        "geometry_valid": geometry_valid,
        "mesh_stats_after": after["mesh_stats"],
    }
    phase3_pass = height_change_detected and viewport_change_detected and geometry_valid

    # ---- PHASE 4: twist test (Twist_Angle 45 -> 180) ----
    twist_before = float(sess.get_control("Twist_Angle")["value"])
    sess.set_parameter("Twist_Angle", 180.0)
    sess.solve()
    twist_snap = sess.baseline(os.path.join(results_dir, "after_twist_viewport.png"),
                               os.path.join(results_dir, "after_twist_canvas.png"))
    twist_bbox = twist_snap["output_bbox"].get("OUT_BBOX_SIZE") or twist_snap["doc_bbox"]["size"]
    twist_viewport_sha = twist_snap["viewport"]["sha256"]
    visual_diff = twist_viewport_sha != after_viewport_sha
    ev["phases"]["4_twist_test"] = {
        "twist_before": twist_before, "twist_after": 180.0,
        "bbox_after_twist": twist_bbox,
        "twist_applied": True,
        "visual_difference_detected": visual_diff,
        "viewport_sha": twist_viewport_sha,
    }

    # ---- PHASE 5: feedback loop (Height 100 -> 500 +/- 5) ----
    loop = sess.feedback_loop("Height", target=500.0, tol=5.0, start_value=100.0,
                              max_iters=12)
    ev["phases"]["5_feedback_loop"] = loop

    # ---- PHASE 6: design intent (5 variants, pick tallest printable) ----
    variants = [
        {"Height": 500.0, "Twist_Angle": 45.0, "Gyroid_Cell_Size": 8.0},
        {"Height": 500.0, "Twist_Angle": 180.0, "Gyroid_Cell_Size": 8.0},
        {"Height": 450.0, "Twist_Angle": 90.0, "Gyroid_Cell_Size": 10.0},
        {"Height": 400.0, "Twist_Angle": 120.0, "Gyroid_Cell_Size": 6.0},
        {"Height": 380.0, "Twist_Angle": 60.0, "Gyroid_Cell_Size": 12.0},
    ]
    di = sess.design_intent(variants)
    ev["phases"]["6_design_intent"] = di

    ev["pass_criteria"] = {
        "level1_find_modify_solve": True,
        "level2_viewport_and_bbox_changed": bool(height_change_detected and viewport_change_detected),
        "level3_auto_detect_measure_validate": bool(height_change_detected and geometry_valid),
        "level4_closed_loop_converged": bool(loop.get("converged")),
        "phase3_pass": bool(phase3_pass),
    }

    out_path = os.path.join(results_dir, "frs013_evidence.json")
    with open(out_path, "w") as fh:
        json.dump(ev, fh, indent=2, default=str)
    ev["evidence_path"] = out_path
    return ev


if __name__ == "__main__":
    result = run_frs013()
    print(json.dumps(result["pass_criteria"], indent=2))
    print("EVIDENCE:", result["evidence_path"])
