# FRS-010: Parametric Lattice Lamp Generator

**Status**: PROPOSED
**Version**: 0.3.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-008, FRS-009

---

## 1. Objective

Build a **parametric lattice lamp generator** as a Grasshopper definition driven by 12 explicit parameters, with verified parameter→recompute→geometry→bake→export flow. This is the **real design automation goal** — not the broken recipe system.

---

## 2. Current State

| Component | Status |
|-----------|--------|
| RhinoClaw TCP transport | ✅ Working (port 1999) |
| Auth & Hermes bridge | ✅ Working |
| Native GH commands | ✅ Working (`load_gh`, `run_gh`, `bake_gh`) |
| Recipe system (`build_and_bake_recipe`) | ❌ Broken (FRS-009) |
| **Parametric lamp definition** | **❌ Not built** |
| **Unified workspace inspection** | **❌ Not built** |

---

## 3. Parametric Requirements

### 3.1 Exposed Parameters (12 Required)

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `Height` | Float | 100–500 mm | 250 | Overall lamp height |
| `Diameter` | Float | 50–300 mm | 150 | Outer diameter at widest point |
| `Twist_Angle` | Float | 0–360° | 45 | Total helical twist from base to top |
| `Wave_Amplitude` | Float | 0–50 mm | 10 | Sine wave amplitude for surface undulation |
| `Wave_Frequency` | Float | 0.5–10 cycles | 3 | Number of wave cycles around circumference |
| `Gyroid_Cell_Size` | Float | 2–20 mm | 6 | TPMS gyroid unit cell dimension |
| `Gyroid_Thickness` | Float | 0.5–5 mm | 1.5 | Wall thickness of gyroid lattice |
| `Interference_Density` | Float | 0–1.0 | 0.3 | Moiré/interference pattern intensity |
| `Helical_Offset` | Float | 0–1.0 | 0.25 | Phase shift between lattice layers |
| `Top_Closure_Ratio` | Float | 0–1.0 | 0.8 | Aperture size at top (1=closed, 0=open) |
| `Bulb_Concealment` | Float | 0–1.0 | 0.6 | Internal baffle depth for light source |
| `Mount_Diameter` | Float | 10–60 mm | 25 | Neck diameter for socket/hardware |
| `Wall_Thickness` | Float | 1–10 mm | 3 | Structural wall thickness (non-lattice areas) |

---

## 4. Functional Requirements

### 4.1 Parameter Exposure

| ID | Requirement |
|----|-------------|
| FRS-010-01 | GH definition MUST expose all 12 parameters as named Number Sliders with proper ranges, defaults, and units |
| FRS-010-02 | Parameters MUST be grouped logically (Geometry, Lattice, Optical, Manufacturing) on GH canvas |
| FRS-010-03 | Parameter changes MUST trigger full recompute without manual intervention |
| FRS-010-04 | No hard-coded values in geometry pipeline — all driven by exposed parameters |

### 4.2 Geometry Pipeline

| ID | Requirement |
|----|-------------|
| FRS-010-05 | **Base form**: Tapered cylinder with twist (Helical_Offset drives phase) |
| FRS-010-06 | **Lattice**: TPMS Gyroid (Gyroid_Cell_Size, Gyroid_Thickness) with Interference_Density modulating density |
| FRS-010-07 | **Surface modulation**: Wave_Amplitude + Wave_Frequency sine deformation on lattice surface |
| FRS-010-08 | **Top closure**: Aperture controlled by Top_Closure_Ratio (0=fully open, 1=closed) |
| FRS-010-09 | **Internal optics**: Bulb_Concealment baffle inside neck to hide LED source |
| FRS-010-10 | **Mount interface**: Mount_Diameter neck with Wall_Thickness for socket hardware |
| FRS-010-11 | **Manufacturing**: Single watertight mesh, non-manifold edges < 0.1% |

### 4.3 Execution Flow (Verifiable)

| ID | Requirement |
|----|-------------|
| FRS-010-12 | Parameter change → Grasshopper recompute → Geometry update → Bake → Export STL must complete in < 30s |
| FRS-010-13 | Hermes MUST be able to drive full cycle via MCP: `load_gh` → `run_gh(inputs)` → `bake_gh` → export |
| FRS-010-14 | Definition MUST solve without errors for all parameter combinations within ranges |
| FRS-010-15 | Output STL MUST be valid (watertight, positive volume, no flipped normals) |

### 4.4 Unified Workspace Inspection

| ID | Requirement |
|----|-------------|
| FRS-010-16 | RhinoClaw Plugin MUST implement `inspect_workspace` — a unified multimodal inspection snapshot |
| FRS-010-17 | `inspect_workspace` MUST return a single coherent design audit in one call |
| FRS-010-18 | Snapshot MUST include: Scene metrics, Geometry metrics, GH status, GH outputs, Viewport capture, Canvas capture, Design validation |
| FRS-010-19 | Design validation MUST compare expected features vs. actual state (intent vs. reality) |
| FRS-010-20 | `inspect_workspace` MUST accept `expected_features` list and return compliance matrix |
| **FRS-010-21** | **Feature detection MUST return evidence-backed results (not just boolean) — include mesh counts, component counts, GH cluster IDs** |
| **FRS-010-22** | **Response MUST include a compliance score (0–100) with per-feature breakdown** |
| **FRS-010-23** | **`inspect_workspace` MUST support three inspection levels with configurable artifact generation** |

---

## 5. Acceptance Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| AC-01 | All 12 parameters exposed as sliders in GH definition |
| AC-02 | Hermes can load definition, set inputs, run, bake, export STL |
| AC-03 | Parameter sweep (5 values each) produces 5 distinct valid geometries |
| AC-04 | Gyroid lattice renders correctly with specified cell size/thickness |
| AC-05 | Wave deformation visible and controlled by Amplitude/Frequency |
| AC-06 | Twist Angle produces visible helical deformation |
| AC-07 | Top closure ratio changes aperture from open to closed |
| AC-08 | STL exports pass validation (netfabb/MeshLab: watertight, positive volume) |
| AC-09 | End-to-end cycle (param change → STL) < 30 seconds |
| AC-10 | Definition file saved as `lattice_lamp_v1.gh` in repo |
| AC-11 | `inspect_workspace(expected_features=[...])` returns compliance matrix |
| AC-12 | Single call returns: Scene metrics, Geometry metrics, GH status, GH outputs, Viewport image, Canvas image, Design validation |
| **AC-13** | **Feature detection returns evidence: `{"detected": false, "evidence": {"mesh_count": 0, "lattice_components": 0, "gh_clusters": []}}`** |
| **AC-14** | **Response includes `compliance_score` (0–100) with per-feature breakdown (e.g., "Gyroid lattice: 0/25, Parametric controls: 0/25, Mounting collar: 25/25, Printable mesh: 0/25 → Total: 25/100")** |
| **AC-15** | **`inspect_workspace(capture_images=True, save_report=True)` generates `inspection/` directory with `viewport.png`, `canvas.png`, `inspection.json`, `inspection.md`** |
| **AC-16** | **Three inspection levels documented and implemented (Level 1: Lightweight, Level 2: Visual, Level 3: Engineering Audit)** |

---

## 6. Non-Functional

| Requirement | Target |
|-------------|--------|
| Solve time | < 10s for typical params |
| STL file size | < 50 MB |
| Mesh quality | > 99% non-manifold free |
| Reproducibility | Same params → identical STL (bitwise) |
| Inspection latency | < 5s for full multimodal snapshot (Level 3) |

---

## 7. References

- FRS-008: Hermes ↔ RhinoClaw TCP Integration
- FRS-009: Grasshopper Recipe Catalog Fix
- Lamp reference image: cylindrical tube with flange base, helical lattice

---

## 8. Analysis Summary: Unified Workspace Inspection

### What This Adds

The proposed `inspect_workspace` capability collapses **7 separate inspection questions** into **one coherent design audit**:

| Old Way (7 calls) | New Way (1 call) |
|-------------------|------------------|
| `scene_summary` → What objects exist? | ✅ Scene metrics |
| `capture_viewport` → What does it look like? | ✅ Viewport image (1280×720) |
| `capture_grasshopper_canvas` → What does GH canvas look like? | ✅ Canvas image |
| `list_grasshopper_definitions` → GH loaded? | ✅ GH definitions |
| `get_grasshopper_outputs` → Did GH solve? | ✅ GH outputs |
| `scene_summary` → Geometry metrics | ✅ Geometry validation |
| Manual comparison → Design compliance | ✅ Intent vs. Reality |

### Example Usage

```python
snapshot = eyes.inspect_workspace(
    expected_features=[
        "gyroid_lattice",
        "parametric_controls",
        "mounting_collar",
        "printable_mesh"
    ]
)

# Returns compliance matrix:
# ✅ Grasshopper connected
# ✅ Definition loaded
# ✅ Geometry baked
# ❌ No gyroid lattice
# ❌ No exposed controls
# ❌ No parametric variation
# ❌ Not matching lamp specification
```

### Why This Matters

**Precision**: Instead of asking 7 separate questions and mentally correlating answers, Hermes gets a single coherent design audit with pass/fail against design intent.

**Efficiency**: One TCP round-trip instead of 7. Critical for iterative design loops.

**Verification**: The `validation` object provides explicit pass/fail against `expected_features`, enabling automated CI/CD gates.

---

### Enhanced Inspection Model (Per Review)

#### Evidence-Backed Feature Detection

Instead of opaque booleans, each feature returns evidence:

```json
{
  "gyroid_lattice": {
    "detected": false,
    "evidence": {
      "mesh_count": 0,
      "lattice_components": 0,
      "gh_clusters": [],
      "tpms_signature_present": false
    }
  },
  "parametric_controls": {
    "detected": false,
    "evidence": {
      "slider_count": 0,
      "exposed_parameters": [],
      "groups_present": []
    }
  },
  "mounting_collar": {
    "detected": true,
    "evidence": {
      "object_name": "Mount_Neck",
      "layer": "Lattice_Lamp_Output",
      "bbox": [[10,10,10], [20,20,20]]
    }
  },
  "printable_mesh": {
    "detected": false,
    "evidence": {
      "watertight": false,
      "volume": 0,
      "non_manifold_edges": 47
    }
  }
}
```

#### Compliance Scoring

```json
{
  "compliance_score": 25,
  "max_score": 100,
  "breakdown": {
    "gyroid_lattice": {"score": 0, "max": 25},
    "parametric_controls": {"score": 0, "max": 25},
    "mounting_collar": {"score": 25, "max": 25},
    "printable_mesh": {"score": 0, "max": 25}
  }
}
```

#### Three Inspection Levels

| Level | Trigger | Captures | Generates | Frequency |
|-------|---------|----------|-----------|-----------|
| **Level 1: Lightweight** | Every GH solve | `scene_summary()`, `get_grasshopper_outputs()` | None | Every iteration |
| **Level 2: Visual** | Major geometry change | `inspect_workspace(capture_images=True)` | `viewport.png`, `canvas.png` | Every 10–20 changes |
| **Level 3: Engineering Audit** | Milestones (commit, export, print) | Full inspection + `capture_images=True, save_report=True` | `inspection/{viewport.png, canvas.png, inspection.json, inspection.md}` | Milestones only |

#### Automatic Report Generation (Level 3)

```python
inspect_workspace(
    expected_features=["gyroid_lattice", "parametric_controls", "mounting_collar", "printable_mesh"],
    capture_images=True,
    save_report=True
)

# Generates:
inspection/
├── viewport.png        # 1280×720 rendered viewport
├── canvas.png          # 1920×1080 GH canvas
├── inspection.json     # Full snapshot + evidence + compliance
└── inspection.md       # Human-readable audit report
```

---

**End of FRS-010 v0.3.0**