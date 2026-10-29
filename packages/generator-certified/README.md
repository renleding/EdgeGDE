# Certified Generator — Lattice Lamp

**Status**: This is the **only** generator that produces the certified product.
The Grasshopper definition (`lattice_lamp_final.gh`) does **not** produce the
certified geometry — it is a broken reference artifact.

## What this package contains

| Script | Purpose |
|--------|---------|
| `task034_engine.py` | Core field builder — signed distance field with gyroid lattice, twist, wall, collar, dome, bore. Returns mesh + gate metrics (volume, naked edges, features). |
| `task034_run.py` | Orchestrator — runs resolution study, parameter sweeps, stress cases. Appends JSONL results. |
| `task034_reports.py` | Generates certification reports from task034 output. |
| `task037_converge.py` | Convergence study — slabbed field build at multiple voxel resolutions (0.8 → 0.3 mm). Memory-lean. |
| `task037_export_ref.py` | Exports the 0.30 mm reference mesh to .3dm + raw arrays. |
| `task037_reports.py` | Generates TASK-037 convergence + fidelity reports. |

## Certified product numbers (from TASK-037 / TASK-040)

| Metric | Value |
|--------|-------|
| Volume | 1,423,008 mm³ ± 2 % |
| Reference mesh | 80,515,998 faces (0.30 mm voxel) |
| Production Candidate D | 5,000,000 faces, 250 MB STL, −0.145 % volume error |
| Dimensions | 151.85 × 151.77 × 375.996 mm |
| Features verified | hollow shell (r≥48.39 mm), collar bore (39.99 mm), dome (apex z=375.81), gyroid cell (8.00 mm), wall 1.66 mm |

## How to run

```bash
# Single build at 0.8 mm voxel
python task034_engine.py

# Resolution study (needs scipy, numpy, scikit-image)
python task037_converge.py 0.8
python task037_converge.py 0.3
```

## Provenance

These scripts lived in `.hermes/cache/scratch/` (gitignored) and were **never committed
to the repository**. They were recovered on 2026-10-29 and moved here to make the
certified generator reproducible.

The Grasshopper definition `lattice_lamp_final.gh` (and its forensic copy
`lattice_lamp_final_BROKEN_REFERENCE.gh`) does **not** generate this product — its
critical components (Twist, Populate 3D Grid, Gyroid IsoMesh, Union All) error out
with null-reference and type-mismatch failures.

## Gate

Any change to this package must pass:
- `watertight == true`
- `manifold == true`  
- `components == 1`
- `volume_mm3` within 1 % of 1,423,008
- All four feature probes true (hollow_shell, collar_bore, dome, lattice)