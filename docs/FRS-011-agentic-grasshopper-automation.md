# FRS-011: Agentic Grasshopper Automation — Two-Layer Architecture

**Status**: PROPOSED → **ARCHITECTURAL DECISION v1.0**
**Version**: 1.0.2
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-008, FRS-009, FRS-010, IDD-010, IDD-011
**Supersedes**: FRS-011 v0.1.0 (single-layer GH geometry automation)

---

## 1. Problem Statement (Resolved)

**Previous Problem**: RhinoClaw v0.8.2 catalog verification blocked programmatic GH definition creation.

**Resolution**: Two-layer architecture eliminates need for programmatic GH definition creation:
- **Layer 1 (GH)**: Design Studio — manual authoring only; Product DNA sliders, Preview Design, Publish Design
- **Layer 2 (Python)**: Certified Geometry Engine — deterministic, topology-certified, manufacturing-validated

**No catalog verification needed** because GH definition is static (frozen) and only parameter values change.

---

## 2. Current State (Updated)

| Component | Status | Layer | Role |
|-----------|--------|-------|------|
| RhinoClaw TCP transport | ✅ Working (port 1999) | 1 | Transport |
| Auth & Hermes bridge | ✅ Working | 1 | Transport |
| Native GH commands | ✅ Working | 1 | Parameter injection, preview |
| Recipe system (`build_gh_definition`) | ❌ Blocked | — | **Not needed** |
| **GH Design Studio** | ✅ **Repaired (TASK-043)** | **1** | **Product DNA sliders + Preview/Publish Design** |
| **Python Certified Geometry Engine** | ✅ **Certified (TASK-037)** | **2** | **Authoritative geometry** |
| `inspect_workspace` | ⚠️ **Redefined** | 1+2 | Dual-layer validation |

---

## 3. Agentic Automation Architecture (Two-Layer with Feedback Loop)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES (Director)                                                           │
│  - Mission Planning                                                         │
│  - Parameter Optimization                                                   │
│  - Design Validation (inspect_workspace layer="both")                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ MCP stdio
┌─────────────────────────────────────────────────────────────────────────────┐
│ rhinoclaw-bridge (MCP)                                                      │
│  - load_grasshopper_definition                                              │
│  - preview_design (NEW — fast visual feedback)                              │
│  - publish_design (NEW — Design Intent Package export)                      │
│  - inspect_workspace (layer=1)                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ TCP 1999
┌─────────────────────────────────────────────────────────────────────────────┐
│ RHINO PC (pc2)                                                              │
│  ┌─────────────────────┐ ┌─────────────────────┐                          │
│  │ RhinoClaw v0.8.2    │ │ Grasshopper         │                          │
│  │ (TCP 1999)          │ │ DESIGN STUDIO       │                          │
│  │                     │ │  - 12 Product DNA   │                          │
│  │                     │ │    Sliders          │                          │
│  │                     │ │  - Preview Design   │                          │
│  │                     │ │  - Publish Design   │                          │
│  │                     │ │  - Current Design   │                          │
│  │                     │ └─────────────────────┘                          │
│  └─────────────────────┘                                                │
│                                    ↓ Design Intent Package (JSON)         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES HOST (Local / BRIDGE LAYER)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Python Certified Geometry Engine (packages/generator-certified/)    │   │
│  │  - task034_engine.py  ← SDF composition + marching cubes           │   │
│  │  - task034_run.py     ← reads Design Intent Package                │   │
│  │  - task034_reports.py ← Validation reports                         │   │
│  │                                                                    │   │
│  │  Input:  C:/temp/lattice_lamp_params.json                          │   │
│  │  Output: C:/temp/lattice_lamp_certified.3dm   (Rhino viewport)     │   │
│  │          C:/temp/lattice_lamp_certified.stl   (manufacturing)      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ Certified Geometry (3DM)
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ FEEDBACK LOOP: Certified Geometry → Rhino Viewport                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Bridge layer: import 3DM → "Lattice_Lamp_Certified" layer          │   │
│  │ Designer sees PRODUCTION geometry in viewport                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ MANUFACTURING PIPELINE (TASK-044+) — CERTIFICATION & PRODUCTION             │
│  - Topology Certification                                                   │
│  - Slicer Validation (Orca/Bambu/Prusa)                                     │
│  - Envelope Audit                                                           │
│  - Manufacturing Readiness                                                  │
│  - Production Certification                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Responsibility Split (Non-Negotiable)

| Component | Responsible For | NOT Responsible For |
|-----------|-----------------|---------------------|
| **Grasshopper (Design Studio)** | Preview Design, Publish Design, Export Design Intent Package | Geometry generation, Python execution, validation |
| **Python (Certified Geometry Engine)** | Generate geometry, validate geometry, produce 3DM, produce STL | Design authoring, viewport display |
| **Bridge Layer** | Read JSON, run `task034_engine.py`, load Certified 3DM, redraw viewport | Geometry decisions, design decisions |

**Rule**: The GH file MUST NOT execute Python or generate production geometry. GH declares intent; Python produces truth; the bridge connects them.

---

## 5. Phased Implementation Roadmap (Updated)

| Phase | Timeline | Deliverable | Status |
|-------|----------|-------------|--------|
| **1. Layer 1: GH Design Studio** | Week 1 | `lattice_lamp_v1_FROZEN.gh` — Product DNA sliders, Preview/Publish Design, Current Design panel | 🔄 **ACTIVE** |
| **2. Layer 2: Certified Geometry Engine Integration** | Week 1 | Hermes mission: Design Intent Package → Certified Geometry | ⏳ |
| **3. Layer 3: Certification & Production** | Week 2-3 | TASK-044 Phases 2-5 (Slicer → Envelope → Readiness → Cert) | ⏳ |
| **4. VisualARQ/Lands Design** | Week 3 | Parametric BIM/landscape via same Design Studio pattern | ⏳ |
| **5. Parametric Envelope (TASK-050)** | Week 4 | Safe parameter ranges for certified geometry | ⏳ |

---

## 6. Layer 1 Mission: GH Design Studio Validation

### 6.1 Mission Manifest (Agentic)

```json
{
  "mission_id": "lattice-lamp-layer1-001",
  "objective": "Validate GH Design Studio: Product DNA sliders, Preview Design, Publish Design, Current Design panel",
  "autonomy_level": "high",
  "tasks": [
    {"task_id": "load_def", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "load_grasshopper_definition", "params": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh"}}, "depends_on": [], "verification_criteria": ["definition_count > 0", "parameter_count == 12"]},
    {"task_id": "verify_ui", "operation": "inspect_workspace", "tool": "droid", "args": {"layer": 1, "expected_features": ["product_dna_sliders", "parameter_groups", "preview_design", "publish_design", "current_design_panel"], "level": 3, "capture_images": true, "save_report": true}, "depends_on": ["load_def"], "verification_criteria": ["layer_1.compliance_score == 100"]},
    {"task_id": "test_preview", "operation": "preview_design", "tool": "droid", "args": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh", "resolution": "fast"}, "depends_on": ["load_def"], "verification_criteria": ["previewed == true", "grid_size == '38³'", "solve_time_ms < 5000"]},
    {"task_id": "test_publish", "operation": "publish_design", "tool": "droid", "args": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh", "output_path": "C:/temp/lattice_lamp_params.json"}, "depends_on": ["test_preview"], "verification_criteria": ["published == true", "design_intent.product == 'LatticeLamp'", "design_intent.keys == 13", "triggered_layer2_mission == 'lattice-lamp-layer2-001'"]},
    {"task_id": "validate_schema", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "execute_python3_code", "params": {"code": "import json; d=json.load(open('C:/temp/lattice_lamp_params.json')); assert set(d.keys())=={'product','height','diameter','twist_deg','wall_mm','gyroid_cell','sheet_mm','band_mm','bore_diameter','collar_height','dome_height','top_closure_ratio','voxel_mm'}, sorted(d.keys()); print('SCHEMA_OK')"}}, "depends_on": ["test_publish"], "verification_criteria": ["exit_code == 0"]}
  ],
  "constraints": {"allow_shell": false, "allowed_paths": [".", "packages/"], "forbidden_paths": [".git/**", "**/.env"], "max_retries": 2}
}
```

---

## 7. Layer 2 Mission: Certified Geometry Engine (with Feedback Loop)

### 7.1 Direct Python Execution (No RhinoClaw)

```json
{
  "mission_id": "lattice-lamp-layer2-001",
  "objective": "Generate certified geometry from Design Intent Package and load into Rhino for designer preview",
  "autonomy_level": "high",
  "tasks": [
    {"task_id": "generate", "operation": "shell", "tool": "droid", "args": {"command": "python3 -m packages.generator_certified.task034_run --params C:/temp/lattice_lamp_params.json --output C:/temp/lattice_lamp_certified.3dm --stl C:/temp/lattice_lamp_certified.stl --validate"}, "depends_on": [], "verification_criteria": ["exit_code == 0", "file_exists == 'C:/temp/lattice_lamp_certified.3dm'"]},
    {"task_id": "validate_topology", "operation": "shell", "tool": "droid", "args": {"command": "python3 -c \"import trimesh; m=trimesh.load('C:/temp/lattice_lamp_certified.stl', force='mesh'); assert m.is_watertight; assert len(m.split(only_watertight=False))==1; print('TOPOLOGY_PASS')\""}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]},
    {"task_id": "validate_volume", "operation": "shell", "tool": "droid", "args": {"command": "python3 -c \"import trimesh; m=trimesh.load('C:/temp/lattice_lamp_certified.stl', force='mesh'); ref=1423008; err=abs(m.volume-ref)/ref*100; assert err < 2.0; print(f'VOLUME_PASS: {err:.2f}%')\""}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]},
    {"task_id": "feedback_loop", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "execute_python3_code", "params": {"code": "import Rhino; import Rhino.Geometry as rg; import scriptcontext as sc; m=rg.Mesh(); m.Import('C:/temp/lattice_lamp_certified.stl'); attrs=sc.doc.CreateDefaultAttributes(); attrs.Name='Certified_Lamp'; attrs.LayerIndex=sc.doc.Layers.Add('Lattice_Lamp_Certified', True); sc.doc.Objects.AddMesh(m, attrs); sc.doc.Views.Redraw(); print('FEEDBACK_LOOP_COMPLETE')"}}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]}
  ],
  "constraints": {"allow_shell": true, "allowed_paths": [".", "packages/", "/tmp", "C:/temp"], "forbidden_paths": [".git/**", "**/.env"], "max_retries": 1}
}
```

---

## 8. Layer 3 Mission: Manufacturing Pipeline (TASK-044 Phases 2-5) — Certification & Production

*To be defined after TASK-044 Phase 1 completes*

---

## 9. VisualARQ / Lands Design Integration (Design Studio Pattern)

Same Design Studio pattern applies:
1. Create GH definition with `va_*` / `ld_*` components
2. Expose Product DNA as sliders
3. Preview Design / Publish Design → Design Intent Package
4. **Python Certified Geometry Engine handles geometry** (bypasses GH entirely)

---

## 10. Success Criteria (Updated)

| Metric | Target | Layer |
|--------|--------|-------|
| GH Design Studio compliance | 100/100 | 1 |
| Design Intent Package schema match | Exact BASE dict keys + `product` field | 1 |
| Publish Design completes | published == true, no errors | 1 |
| Certified Geometry topology | Watertight + manifold + single-body | 2 |
| Volume tolerance | ±2% vs reference | 2 |
| Dimensional tolerance | ±0.5mm height/dia | 2 |
| End-to-end (param change → certified geometry) | < 60s | 1+2 |
| **Feedback loop: certified geometry in Rhino viewport** | **< 5s after export** | **2** |
| Slicer import (Orca/Bambu/Prusa) | Success, no critical repairs | 3 |

---

## 11. Artifact Classifications

| Artifact | Classification | Purpose |
|----------|----------------|---------|
| `lattice_lamp_v1_FROZEN.gh` | **Design Studio** | Parameter authoring, visual exploration, design intent declaration |
| `lattice_lamp_params.json` | **Design Intent Package** | Transfers Product DNA to Certified Geometry Engine |
| `task034_engine.py` | **Certified Geometry Engine** | Generates authoritative geometry (SDF + marching cubes) |
| `lattice_lamp_certified.3dm` | **Certified Geometry** | Rich geometry for Rhino viewport |
| `lattice_lamp_certified.stl` | **Manufacturing Exchange** | STL artifact for slicing only |
| TASK-044+ | **Certification & Production** | Slicer validation, envelope audit, production certification |

**Key Principle**: STL is manufacturing exchange format only. Rhino works with richer geometry (3DM). The feedback loop loads certified geometry as 3DM into the "Lattice_Lamp_Certified" layer.

---

## 12. Immediate Next Steps (Gogo)

1. **Freeze `lattice_lamp_v1_FROZEN.gh`** on pc2:
   - 12 Product DNA Sliders with exact ranges from FRS-010 v1.0
   - **Preview Design** button — fast 38³ grid visual feedback only
   - **Publish Design** button — writes Design Intent Package JSON, triggers Layer 2
   - **Current Design** read-only panel — values + READY/DRAFT status
   - NO geometry generation, NO Python execution inside GH
   - Save as `C:/temp/lattice_lamp_v1_FROZEN.gh`

2. **Run Layer 1 Mission** (above) — validate GH Design Studio + Design Intent Package

3. **Run Layer 2 Mission** (above) — generate certified geometry + feedback loop

4. **Verify feedback loop** — designer sees certified geometry in Rhino viewport

5. **Proceed to TASK-044 Phase 2** — Slicer Validation with certified geometry

---

**End of FRS-011 v1.0.2**
