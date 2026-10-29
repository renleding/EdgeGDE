"""TASK-034 runner - PHASE 2 resolution study, PHASE 4 sweeps, PHASE 5 stress.

Resumable: every case appends one JSON line to results.jsonl and is skipped on
re-run. Usage: task034_run.py <group> [voxel]
"""
import json
import os
import sys

sys.path.insert(0, "/Users/warren/Documents/_HQ_AI/EdgeGDE/.hermes/cache/scratch")
from task034_engine import build  # noqa: E402

OUT = "/Users/warren/Documents/_HQ_AI/EdgeGDE/.hermes/logs/missions/task-034"
os.makedirs(OUT, exist_ok=True)
RESULTS = os.path.join(OUT, "results.jsonl")

GROUP = sys.argv[1]
VOX = float(sys.argv[2]) if len(sys.argv) > 2 else 0.8

SWEEPS = {
    "height": (200.0, 300.0, 500.0),
    "diameter": (100.0, 150.0, 220.0),
    "twist": (0.0, 45.0, 180.0),
    "wall": (1.0, 1.6, 3.0),
    "cell": (6.0, 8.0, 16.0),
    "sheet": (0.8, 1.2, 2.0),
    "bore": (20.0, 40.0, 60.0),
    "dome": (1.0, 1.6, 3.0),
}
KEYMAP = {"height": "height", "diameter": "diameter", "twist": "twist_deg",
          "wall": "wall_mm", "cell": "gyroid_cell", "sheet": "sheet_mm",
          "bore": "bore_mm", "dome": "dome_mm"}

cases = []
if GROUP == "resolution":
    for v, tag in ((0.8, "100"), (1.1, "73"), (1.6, "50"), (2.4, "33"), (3.2, "25")):
        cases.append({"phase": "resolution", "case": "voxel_%s" % tag,
                      "params": {"voxel_mm": v}})
elif GROUP == "sweeps":
    for name, (lo, nom, hi) in SWEEPS.items():
        for label, val in (("min", lo), ("nominal", nom), ("max", hi)):
            cases.append({"phase": "sweep", "case": "%s_%s" % (name, label),
                          "param": name, "value": val,
                          "params": {KEYMAP[name]: val, "voxel_mm": VOX}})
elif GROUP == "stress":
    cases += [
        {"phase": "stress", "case": "small_dia_max_twist",
         "params": {"diameter": 100.0, "twist_deg": 180.0, "voxel_mm": VOX}},
        {"phase": "stress", "case": "max_dia_thin_wall",
         "params": {"diameter": 220.0, "wall_mm": 1.0, "voxel_mm": VOX}},
        {"phase": "stress", "case": "max_height_fine_cell",
         "params": {"height": 500.0, "gyroid_cell": 6.0, "voxel_mm": VOX}},
        {"phase": "stress", "case": "max_height_max_twist",
         "params": {"height": 500.0, "twist_deg": 180.0, "voxel_mm": VOX}},
        {"phase": "stress", "case": "worst_case",
         "params": {"height": 500.0, "diameter": 220.0, "twist_deg": 180.0,
                    "wall_mm": 1.0, "gyroid_cell": 6.0, "sheet_mm": 0.8, "voxel_mm": VOX}},
    ]

done = set()
if os.path.exists(RESULTS):
    for line in open(RESULTS):
        try:
            done.add(json.loads(line)["case"])
        except Exception:
            pass

for c in cases:
    if c["case"] in done:
        print("skip", c["case"], flush=True)
        continue
    r = build(c["params"])
    rec = {"phase": c["phase"], "case": c["case"],
           "param": c.get("param"), "value": c.get("value"), "result": r}
    with open(RESULTS, "a") as fh:
        fh.write(json.dumps(rec) + "\n")
    ok = r.get("gate_pass")
    print("%-26s voxel=%.2f %s faces=%s dim=%s comps=%s naked=%s feats=%s %.1fs" % (
        c["case"], c["params"].get("voxel_mm", VOX), "PASS" if ok else "FAIL",
        r.get("faces"), r.get("dim"), r.get("components"), r.get("naked_edges"),
        r.get("all_features"), r.get("seconds", 0)), flush=True)
print("GROUP DONE", GROUP, len(cases))
