# SDD-011: Agentic Grasshopper Automation — Two-Layer System Design

**Status**: PROPOSED → **ARCHITECTURAL DECISION v1.0**
**Version**: 1.0.2
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-011, IDD-011, FRS-010, IDD-010, FRS-008, FRS-009
**Supersedes**: SDD-011 v0.1.0 (single-layer GH geometry automation)

---

## 1. System Overview (Two-Layer Architecture)

This document describes the system design for **two-layer agentic automation**:

| Layer | Technology | Role | Output |
|-------|------------|------|--------|
| **Layer 1: Design Studio** | Grasshopper (frozen definition) | Product DNA sliders, Preview Design, Publish Design | Design Intent Package (JSON) |
| **Layer 2: Certified Geometry Engine** | Python (`packages/generator-certified/`) | SDF composition, marching cubes, certification | Certified Geometry (3DM) |
| **Layer 3: Certification & Production** | Slicers + TASK-044 pipeline | Topology, slicer, envelope, readiness | Production certification |

**Catalog verification is RESOLVED** — no programmatic GH definition creation needed. GH definition is frozen; only parameter values change.

---

## 2. Component Design (Updated)

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES (Director)                                                           │
│  - Mission Planning → Task Decomposition                                    │
│  - Parameter Optimization → Design Validation                               │
│  - Layer 1 Mission → Layer 2 Mission → Layer 3 (TASK-044) Pipeline         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: rhinoclaw-bridge (MCP Server) → TCP 1999 → RhinoClaw Plugin       │
│  - 9 MCP Tools (load_gh, preview_design, publish_design, inspect_l1)       │
│  - Dynamic command catalog (list_commands at startup)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ RHINO PC (pc2) — Layer 1 Only                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ RhinoClaw v0.8.2+ Plugin                                           │    │
│  │  - Native GH: load_gh, preview_design, publish_design              │    │
│  │  - inspect_workspace (layer=1): GH Design Studio validation        │    │
│  │  - NO catalog verification needed (frozen GH definition)           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Rhino 8 + Grasshopper                                              │    │
│  │  ┌─────────────────────────────────────────────────────────────┐   │    │
│  │  │ lattice_lamp_v1_FROZEN.gh                                   │   │    │
│  │  │  - 12 Product DNA Sliders (aligned with Python BASE dict)  │   │    │
│  │  │  - Preview Design (fast 38³ grid)                          │   │    │
│  │  │  - Publish Design (Design Intent Package export)           │   │    │
│  │  │  - Current Design panel (read-only status)                 │   │    │
│  │  └─────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ Design Intent Package (JSON)
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: HERMES HOST (Local) — Python Certified Geometry Engine            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ packages/generator-certified/                                      │    │
│  │  - task034_engine.py: SDF composition + marching cubes (SOURCE)   │    │
│  │  - task034_run.py: CLI entry, reads Design Intent Package → writes │    │
│  │    Certified Geometry (3DM) + reports                              │    │
│  │  - task034_reports.py: topology, volume, dimension, feature val   │    │
│  │  - 90M voxel budget, convergence-validated at 0.30mm              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ Certified Geometry (3DM)
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ FEEDBACK LOOP: Certified Geometry → Rhino Viewport                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ RhinoClaw: execute_python3_code                                     │   │
│  │   import 3DM → add to "Lattice_Lamp_Certified" layer               │   │
│  │   Designer sees PRODUCTION geometry in viewport                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: MANUFACTURING PIPELINE (TASK-044+) — Certification & Production    │
│  - Phase 2: Slicer Validation (Orca/Bambu/Prusa)                            │
│  - Phase 3: Envelope Audit (375.996mm vs printer Z)                         │
│  - Phase 4: Manufacturing Readiness                                         │
│  - Phase 5: Production Certification                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. rhinoclaw-bridge (MCP Server) — Layer 1 Only

### 3.1 Module Structure

**Location**: `packages/rhinoclaw-bridge/src/rhinoclaw_bridge/`

| Module | Responsibility |
|--------|----------------|
| `server.py` | FastMCP stdio entry point, tool registration |
| `catalog.py` | Dynamic command discovery via `list_commands()` |
| `tools.py` | **9 Core tool definitions** (added `preview_design`, `publish_design`, updated `inspect_workspace`) |
| `auth.py` | Token management (env var, rotation) |
| `client.py` | RhinoClawClient wrapper (TCP framing, retry) |

### 3.2 Tool Registry (9 Tools — Updated)

| Tool | Type | Layer | Verification Bypass |
|------|------|-------|---------------------|
| `rhinoclaw_execute` | Generic | 1 | Pass-through to any TCP command |
| `scene_summary` | Convenience | 1 | Native, no catalog |
| `create_object` | Convenience | 1 | Native, no catalog |
| `batch_operations` | Convenience | 1 | Native, no catalog |
| `execute_python3_code` | Convenience | 1 | RhinoCode (RhinoCommon) |
| `load_grasshopper_definition` | Convenience | 1 | Native GH, no catalog |
| **`preview_design`** | **Convenience** | **1** | **NEW: Fast GH visual preview** |
| **`publish_design`** | **Convenience** | **1** | **NEW: Design Intent Package export + Layer 2 trigger** |
| `inspect_workspace` | Validation | 1+2 | Multi-modal audit (layer=1, 2, "both") |

**Key Design**: No hard-coded command mappings. All tools delegate to `client.execute(command_type, params)` with dynamic catalog validation.

---

## 4. Execution Paths (Priority Order — Updated)

Per the two-layer architecture:

```
Layer 1 (GH Design Studio):
  Priority 1: Typed Convenience Tools
    └─ load_grasshopper_definition, preview_design, publish_design
    └─ Best: typed args, validation, documentation
  
  Priority 2: inspect_workspace(layer=1)
    └─ GH Design Studio validation (Product DNA, Preview/Publish, Current Design)
  
  Priority 3: batch_operations
    └─ Atomic multi-step (load + preview + publish)

Layer 2 (Certified Geometry Engine):
  Priority 1: Direct Python Execution (Local)
    └─ python3 -m packages.generator_certified.task034_run
    └─ Full SDF composition + marching cubes
    └─ BYPASSES Grasshopper entirely
    └─ Source of truth for manufacturing geometry

Layer 3 (Certification & Production):
  Priority 1: Slicer CLI/API (Orca/Bambu/Prusa)
  Priority 2: Envelope audit scripts
  Priority 3: Production certification reports
```

---

## 5. Agentic Workflow Phases (Two-Layer)

### Phase 1: Layer 1 — GH Design Studio (Week 1) 🔄 **ACTIVE**

```
Hermes Mission (Layer 1)
    │
    ├─► preflight() → auth == "ready"
    ├─► load_grasshopper_definition("lattice_lamp_v1_FROZEN.gh")
    │       → 12 Product DNA sliders confirmed, ranges match Python BASE dict
    ├─► inspect_workspace(layer=1, level=3)
    │       → product_dna_sliders: 12/12 ✓
    │       → parameter_groups: 4/4 ✓ 
    │       → preview_design: functional ✓
    │       → publish_design: functional ✓
    │       → current_design_panel: functional ✓
    ├─► preview_design(resolution="fast")
    │       → 38³ grid, visual feedback in < 5s
    ├─► publish_design()
    │       → Design Intent Package: C:/temp/lattice_lamp_params.json
    │       → Triggers Layer 2 mission
    └─► validate_schema() → Design Intent Package matches Python BASE dict + product
```

**Data Flow**:
1. **Manual**: Create `lattice_lamp_v1_FROZEN.gh` with 12 Product DNA sliders + Preview/Publish Design buttons + Current Design panel
2. **Hermes**: Load definition → verify 12 Product DNA sliders + ranges
3. **Designer**: Move sliders → Preview Design (fast feedback)
4. **Designer**: Publish Design → Design Intent Package (JSON) + triggers Layer 2
5. **Hermes**: Validate Design Intent Package schema (exact BASE dict + product field)
6. **Hermes**: Trigger Layer 2 mission

**No catalog verification** — native commands use already-loaded proxy catalog.

---

### Phase 2: Layer 2 — Certified Geometry Engine (Week 1) ⏳

```
Hermes Mission (Layer 2)
    │
    ├─► Read: C:/temp/lattice_lamp_params.json (Design Intent Package)
    ├─► python3 -m packages.generator_certified.task034_run
    │       --params C:/temp/lattice_lamp_params.json
    │       --output C:/temp/lattice_lamp_certified.3dm
    │       --validate
    │       --load-into-rhino
    │
    ├─► task034_engine.py: SDF Composition
    │       d_wall = tapered cylinder with twist
    │       d_lat  = TPMS gyroid (K=2π/cell, thickness=sheet, band=band)
    │       d_col  = cylindrical bore (Z < collar_height)
    │       d_dome = spherical cap (Z > height - dome_height)
    │       field  = smin(smin(smin(d_wall, d_lat), d_col), d_dome)  KS=0.30
    │
    ├─► Marching Cubes at voxel_mm (0.30mm = 80.5M faces, within 90M budget)
    │
    ├─► Export: C:/temp/lattice_lamp_certified.3dm (rich geometry)
    │
    ├─► Validation (task034_reports.py):
    │       ✅ Topology: watertight + manifold + single-body
    │       ✅ Volume: ±2% vs reference (1,423,008 mm³)
    │       ✅ Dimensions: ±0.5mm height/dia
    │       ✅ Features: wall, gyroid, collar, dome detected
    │
    ├─► **FEEDBACK LOOP: Load Certified Geometry into Rhino**
    │       RhinoClaw: execute_python3_code → import 3DM → "Lattice_Lamp_Certified" layer
    │       Designer sees PRODUCTION geometry in viewport
    │
    └─► Reports: topology_report.json, volume_report.json, dimension_report.json
```

**Advantages over GH geometry**:
- **Deterministic**: Same params → bitwise identical 3DM
- **Certified**: Convergence-validated at 0.30mm (TASK-037)
- **Topology-correct**: No decimation needed (reference mesh is certified)
- **Fast**: ~45s at 0.30mm voxel (vs 300s+ GH solve + export)
- **No catalog issues**: Runs locally, no RhinoClaw dependency
- **Rich geometry**: 3DM for Rhino viewport (STL only for manufacturing exchange)
- **Designer feedback**: Certified geometry visible in Rhino within 5s

---

### Phase 3: Layer 3 — Certification & Production (Week 2-3) ⏳

*Defined in TASK-044 specification — consumes Layer 2 Certified Geometry*

```
TASK-044 Phase 2: Slicer Validation
    ├─► OrcaSlicer: import STL → repair_warnings → toolpaths
    ├─► Bambu Studio: import STL → repair_warnings → toolpaths 
    └─► PrusaSlicer: import STL → repair_warnings → toolpaths
    → slicer_validation_report.json

TASK-044 Phase 3: Envelope Audit
    ├─► Product: 375.996mm height (from reference mesh)
    ├─► Bambu X1/P1/A1: 256mm Z → FAIL
    ├─► Strategy: Split-part / Large-format / Commercial bureau
    → envelope_audit.json, production_strategy_report.json

TASK-044 Phase 4: Manufacturing Readiness
    ├─► Print time, material, supports, post-processing
    → manufacturing_readiness_report.json

TASK-044 Phase 5: Production Certification
    ├─► Verdict: CERTIFIED / CONDITIONALLY CERTIFIED / NOT CERTIFIED
    → production_representation_certification.json
```

---

### Phase 4: VisualARQ / Lands Design (Week 3) ⏳

**VisualARQ** (confirmed via `va_*` commands):
- Same pattern: GH definitions with VisualARQ components
- Product DNA sliders → Preview Design → Publish Design
- **Python Certified Geometry Engine handles geometry** (bypasses GH)

**Lands Design** (needs verification):
- Test `list_commands` for `ld_` prefix
- If available: terrain, plants, irrigation via same Design Studio pattern

---

## 6. Data Models (Updated for Two-Layer)

### 6.1 Layer 1: Design Intent Package (Exact Python BASE Dict Match + Product)

```json
{
  "product": "LatticeLamp",
  "height": 300,
  "diameter": 150,
  "twist_deg": 45,
  "wall_mm": 1.6,
  "gyroid_cell": 8.0,
  "sheet_mm": 1.2,
  "band_mm": 25.0,
  "bore_diameter": 35.0,
  "collar_height": 30.0,
  "dome_height": 20.0,
  "top_closure_ratio": 0.8,
  "voxel_mm": 0.30
}
```

### 6.2 Layer 2: Certified Geometry Engine Output

```json
{
  "success": true,
  "data": {
    "geometry_path": "C:/temp/lattice_lamp_certified.3dm",
    "stl_path": "C:/temp/lattice_lamp_certified.stl",
    "geometry_size_bytes": 2123746242,
    "vertices": 40171967,
    "faces": 80515998,
    "volume_mm3": 1420789.3,
    "volume_error_pct": 0.16,
    "watertight": true,
    "manifold": true,
    "single_body": true,
    "generation_time_s": 45.2,
    "validation": {
      "topology_pass": true,
      "volume_pass": true,
      "dimensions_pass": true,
      "features_pass": true
    },
    "rhino_feedback": {
      "loaded": true,
      "layer": "Lattice_Lamp_Certified",
      "load_time_ms": 1200
    }
  }
}
```

### 6.3 Inspection Result — Layer 1 (GH Design Studio)

```json
{
  "inspection_id": "uuid",
  "layer": 1,
  "compliance_score": 100,
  "breakdown": {
    "product_dna_sliders": {"score": 25, "max": 25},
    "parameter_groups": {"score": 25, "max": 25},
    "preview_design": {"score": 25, "max": 25},
    "publish_design": {"score": 25, "max": 25}
  },
  "evidence": { ... }
}
```

### 6.4 Inspection Result — Layer 2 (Certified Geometry)

```json
{
  "inspection_id": "uuid",
  "layer": 2,
  "compliance_score": 100,
  "breakdown": {
    "topology_certified": {"score": 25, "max": 25},
    "volume_certified": {"score": 25, "max": 25},
    "dimensions_certified": {"score": 25, "max": 25},
    "features_certified": {"score": 25, "max": 25}
  },
  "evidence": { ... },
  "certified": true
}
```

### 6.5 Combined Inspection (Layer="both")

```json
{
  "inspection_id": "uuid",
  "layers_validated": ["1", "2"],
  "layer_1": { "compliance_score": 100, ... },
  "layer_2": { "compliance_score": 100, "certified": true, ... },
  "unified_compliance_score": 100,
  "unified_max_score": 100,
  "artifacts": {
    "viewport_saved": "inspection/viewport.png",
    "canvas_saved": "inspection/canvas.png",
    "geometry_validation_saved": "inspection/geometry_validation.json",
    "report_saved": "inspection/inspection.md"
  }
}
```

---

## 7. Error Handling & Recovery (Updated)

| Error Type | Layer | Detection | Recovery |
|------------|-------|-----------|----------|
| `AUTH_REQUIRED` | 1 | `preflight.data.auth != "ready"` | Sync token, restart Rhino |
| `CONNECTION_REFUSED` | 1 | TCP connect fails | Check pc2, Tailscale, `mcpstart` |
| `TIMEOUT` | 1 | Command > 30s | Increase timeout |
| `PREVIEW_FAILED` | 1 | `preview_design` fails | Check GH script, reduce grid |
| `PUBLISH_FAILED` | 1 | `publish_design` fails | Check GH script, permissions |
| `PARAMS_SCHEMA_INVALID` | 2 | Design Intent Package ≠ BASE dict | Fix GH Publish Design to match exactly |
| `GENERATION_FAILED` | 2 | Python exception | Check generator logs |
| `TOPOLOGY_FAILED` | 2 | Output not watertight/manifold | Adjust voxel_mm or params |
| `VOLUME_TOLERANCE_FAILED` | 2 | Volume error > 2% | Check params, voxel resolution |
| `SLICER_IMPORT_FAILED` | 3 | Slicer cannot load STL | Check STL validity, slicer version |

---

## 8. Performance Targets (Updated)

| Operation | Target | Layer | Measurement |
|-----------|--------|-------|-------------|
| `preflight` | < 500ms | 1 | TCP RTT + auth |
| `load_grasshopper_definition` | < 5s | 1 | GH document parse |
| `preview_design` (fast) | < 5s | 1 | 38³ grid solve |
| `publish_design` | < 1s | 1 | Design Intent Package write |
| `inspect_workspace` (Layer 1) | < 5s | 1 | Multi-modal capture |
| **Layer 1 Total** | **< 20s** | 1 | End-to-end |
| `task034_run` (0.30mm voxel) | < 60s | 2 | SDF + marching cubes + export 3DM |
| `task034_run` (0.8mm voxel) | < 10s | 2 | Faster, lower fidelity |
| Validation reports | < 5s | 2 | Topology + volume + dims |
| **Feedback loop: Rhino 3DM load** | **< 5s** | **2** | 3DM import + viewport redraw |
| **Layer 2 Total** | **< 65s** | 2 | End-to-end (incl. feedback) |
| **Full Pipeline (L1+L2)** | **< 90s** | 1+2 | Param change → certified geometry + viewport |

---

## 9. Security (Unchanged)

| Control | Implementation |
|---------|----------------|
| Authentication | Token in env var (never logged), per-command |
| Transport | Tailscale encrypted mesh (no public exposure) |
| Authorization | Command allowlist in bridge (9 tools + generic) |
| Audit | Action journal (JSON-Lines) per request |
| Secrets | Bitwarden-managed `RHINOCLAW_AUTH_TOKEN` |

---

## 10. File Structure (Updated — Artifact-Based)

```
packages/
├── generator-certified/                    # Certified Geometry Engine
│   ├── pyproject.toml
│   ├── task034_engine.py       # SDF + marching cubes (SOURCE)
│   ├── task034_run.py          # CLI entry
│   ├── task034_reports.py      # Validation reports
│   ├── task037_converge.py     # Convergence study
│   ├── task037_export_ref.py   # Reference mesh export
│   └── task037_reports.py      # Fidelity reports
├── rhinoclaw-client/           # Layer 1: Transport
│   └── src/rhinoclaw_client/
│       ├── client.py           # TCP client
│       └── errors.py
├── rhinoclaw-bridge/           # Layer 1: MCP Server
│   └── src/rhinoclaw_bridge/
│       ├── server.py           # FastMCP entry
│       ├── catalog.py          # Dynamic discovery
│       ├── tools.py            # 9 tool defs
│       ├── auth.py             # Token mgmt
│       └── client.py           # Wrapper
├── hermes-rhino-gh/            # Agentic missions
│   └── src/hermes_rhino_gh/
│       ├── missions/           # Layer 1, 2, 3 missions
│       └── health.py
└── op-schema/                  # Shared schemas
```

---

## 11. Testing Strategy (Updated)

| Test Type | Tool | Coverage |
|-----------|------|----------|
| Unit | pytest | Client framing, auth, retry logic |
| Integration | pytest | Bridge ↔ Mock TCP server |
| Layer 1 E2E | Manual + scripted | GH Design Studio → Design Intent Package on pc2 |
| Layer 2 Unit | pytest | task034_engine, task034_reports |
| Layer 2 E2E | Scripted | Design Intent Package → 3DM → validation (local) |
| Layer 3 E2E | Manual | Slicer validation, envelope audit |
| Compliance | `inspect_workspace` | Automated dual-layer validation |

---

## 12. Migration from v0.1.0 (Single-Layer)

| v0.1.0 Concept | v1.0.0 Replacement | v1.0.1 Addition | v1.0.2 Addition |
|----------------|---------------------|------------------|------------------|
| GH generates final geometry | GH = Design Studio only | — | — |
| `bake_grasshopper` + STL export | `publish_design` → Certified Geometry Engine | — | — |
| RhinoCommon engine (Phase 3) | **Python generator is the engine** (certified) | — | — |
| Catalog verification workaround | **Not needed** (frozen GH) | — | — |
| `inspect_workspace` validates GH geometry | `inspect_workspace(layer=1)` validates GH Design Studio; `layer=2` validates Certified Geometry | — | — |
| — | — | **Feedback loop: Certified STL → Rhino viewport** | — |
| — | — | — | **Preview Design / Publish Design; Product DNA; Design Intent Package; Certified Geometry Engine; Certification & Production; 3DM for Rhino** |

---

**End of SDD-011 v1.0.2**
