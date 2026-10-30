# SDD-010: Parametric Lattice Lamp Generator — Two-Layer System Design

**Status**: DRAFT → **ARCHITECTURAL DECISION v1.0**
**Version**: 1.2.0
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-010, IDD-010, FRS-011, IDD-011
**Supersedes**: SDD-010 v0.3.0 (single-layer GH geometry engine)

---

## 1. System Overview (Two-Layer Architecture)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES (Director)                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ rhinoclaw-bridge (MCP Server) — Layer 1 Transport                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Python Certified Generator (packages/generator-certified/) — Layer 2│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼ TCP 1999 (Tailscale)         ▼ Direct Python Execution (Local)
┌─────────────────────────────────────────────────────────────────────────────┐
│ RHINO PC (pc2) — Layer 1: Design Authoring                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ RhinoClaw Plugin v0.8.2+                                            │   │
│  │  - TCP Listener: 1999                                               │   │
│  │  - Native GH: load_grasshopper_definition, run_grasshopper,        │   │
│  │    preview_design, publish_design, inspect_workspace               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Rhino 8 + Grasshopper                                               │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ lattice_lamp_v1_FROZEN.gh                                   │   │   │
│  │  │  - 12 Parameter Sliders (aligned with Python BASE dict)    │   │   │
│  │  │  - Visual Preview Geometry (NON-CERTIFIED)                 │   │   │
│  │  │  - JSON Export Button/Component                             │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ JSON (params)
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES HOST (Local) — Layer 2: Certified Geometry Engine                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Python Generator (packages/generator-certified/)                    │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ task034_engine.py  ← SDF composition + marching cubes       │   │   │
│  │  │  - Wall SDF: Tapered cylinder with twist                   │   │   │
│  │  │  - Gyroid SDF: TPMS sin(Kx)cos(Ky)+... thickness=sheet_mm  │   │   │
│  │  │  - Collar SDF: Cylindrical bore (bore_diameter)            │   │   │
│  │  │  - Dome SDF: Spherical cap (dome_height)                   │   │   │
│  │  │  - Field Composition: smin(smin(smin(d_wall, d_lat),       │   │   │
│  │  │                        d_col), d_dome)  KS=0.30             │   │   │
│  │  │  - Marching Cubes extraction at voxel_mm resolution        │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ task034_run.py     ← CLI entry, reads params JSON          │   │   │
│  │  │ task034_reports.py ← Validation reports (topology, volume) │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ STL (certified)
┌─────────────────────────────────────────────────────────────────────────────┐
│ MANUFACTURING PIPELINE (TASK-044+) — Layer 3                                │
│  - Topology Certification (watertight, manifold, single-body)              │
│  - Slicer Validation (OrcaSlicer, Bambu Studio, PrusaSlicer)               │
│  - Envelope Audit (375.996mm height vs printer Z)                          │
│  - Manufacturing Readiness (time, material, supports)                      │
│  - Production Certification (CERTIFIED / CONDITIONAL / NOT CERTIFIED)      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture (Updated)

### 2.1 Components

| Component | Layer | Role |
|-----------|-------|------|
| **Hermes** | All | Parameter orchestration, mission planning, verification |
| **rhinoclaw-bridge** | 1 | MCP↔TCP translation, auth, framing |
| **RhinoClaw Plugin** | 1 | GH definition loading, execution, parameter export, unified inspection |
| **Grasshopper** | 1 | **Parameter UI only** — 12 sliders, visual preview, JSON export |
| **Python Generator** | 2 | **Authoritative geometry** — SDF composition, marching cubes, certification |
| **Manufacturing Pipeline** | 3 | Slicer validation, envelope audit, production certification |

### 2.2 Data Flow — Layer 1: GH Parameter Authoring (Design Studio)

```
Hermes Mission (Layer 1)
      │
      ▼
MCP: load_grasshopper_definition(file_path="lattice_lamp_v1_FROZEN.gh")
      │
      ▼
Designer Actions:
      ├─► Move Sliders → "Preview Design" (fast, 38³ grid, visual feedback)
      └─► "Publish Design" 
            │
            ▼
      MCP: publish_design(file_path, output_path)  ← Design Intent Package export
            │
            ▼
      JSON File: C:/temp/lattice_lamp_params.json
            │
            ▼
      Hermes: Triggers Layer 2 Mission
```

### 2.3 Data Flow — Layer 2: Certified Geometry Generation (with Feedback Loop)

```
Hermes Mission (Layer 2)
      │
      ▼
Read: C:/temp/lattice_lamp_params.json
      │
      ▼
Python: task034_run.py --params ... --output ... --validate --load-into-rhino
      │
      ├─► Parse JSON → BASE dict (exact key match required)
      ├─► SDF Composition:
      │     d_wall  = tapered cylinder with twist (twist_deg phase)
      │     d_lat   = TPMS gyroid K=2π/gyroid_cell, thickness=sheet_mm, band=band_mm
      │     d_col   = cylindrical bore (bore_diameter) for Z < collar_height
      │     d_dome  = spherical cap for Z > height - dome_height
      │     field   = smin(smin(smin(d_wall, d_lat), d_col), d_dome)  KS=0.30
      │
      ├─► Marching Cubes at voxel_mm resolution
      │
      ├─► Export: C:/temp/lattice_lamp_certified.stl (binary)
      │
      ├─► Validation:
      │     ✅ Watertight (IsClosed)
      │     ✅ Manifold (no non-manifold edges)
      │     ✅ Single body (one connected component)
      │     ✅ Volume: ±2% vs reference (1,420,789 mm³)
      │     ✅ Dimensions: ±0.5mm height/dia, ±0.05mm sheet/cell
      │     ✅ Features: wall, gyroid, collar, dome all present
      │
      ├─► **FEEDBACK LOOP (NEW): Load Certified Mesh into Rhino**
      │     RhinoClaw: execute_python3_code → import STL → add to "Lattice_Lamp_Certified" layer
      │     Designer sees production geometry immediately in viewport
      │
      ▼
Reports: topology_report.json, volume_report.json, dimension_report.json
      │
      ▼
Hermes: Layer 2 Complete → Triggers Layer 3 (TASK-044)
```

### 2.4 Data Flow — Layer 3: Manufacturing Pipeline (TASK-044)

```
Layer 2 Output: Certified STL
      │
      ▼
TASK-044 Phase 2: Slicer Validation
      ├─► OrcaSlicer import → repair_warnings → toolpath generation
      ├─► Bambu Studio import → repair_warnings → toolpath generation
      ├─► PrusaSlicer import → repair_warnings → toolpath generation
      │
      ▼
TASK-044 Phase 3: Envelope Audit
      ├─► Product: 375.996mm height (known from reference)
      ├─► Bambu X1/P1/A1: 256mm Z → FAIL
      ├─► Strategy: Split-part / Large-format / Commercial bureau
      │
      ▼
TASK-044 Phase 4: Manufacturing Readiness
      ├─► Print time, material, supports, post-processing
      │
      ▼
TASK-044 Phase 5: Production Certification
      ├─► Verdict: CERTIFIED / CONDITIONALLY CERTIFIED / NOT CERTIFIED
```

---

## 3. Layer 1: GH Definition Architecture (Frozen — Design Studio)

### 3.1 Canvas Organization (Product Configurator)

```
lattice_lamp_v1_FROZEN.gh
├── Group: PRODUCT_DNA (12 CERTIFIED sliders — aligned with Python BASE dict)
│   ├── Geometry: Height, Diameter, Twist_Angle
│   ├── Lattice: Gyroid_Cell_Size, Gyroid_Thickness, Band_Width
│   ├── Manufacturing: Wall_Thickness, Bore_Diameter, Collar_Height, Dome_Height
│   └── Resolution: Top_Closure_Ratio, Voxel_Resolution
│
├── Group: STUDIO_PARAMETERS (6 sliders — NOT in certified engine)
│   ├── Wave_Amplitude, Wave_Frequency
│   ├── Interference_Density, Helical_Offset
│   ├── Bulb_Concealment, Mount_Diameter
│   ├── Visual treatment: muted/greyed, physically separated from PRODUCT_DNA
│   └── Excluded from Design Intent Package and from certified_fp
│
├── Group: PREVIEW_DESIGN (Fast Visual Feedback)
│   ├── Base Geometry Preview (cylinder + taper + twist)
│   ├── Gyroid Lattice Preview (TPMS isosurface at 38³ grid)
│   ├── Boolean Preview (lattice ∩ base)
│   └── Mount/Cap Preview
│   └── Button: "Preview Design" → fast local solve
│
├── Group: PUBLISH_DESIGN (Design Intent Package Export)
│   ├── Python Script Component: "Publish Design"
│   │   Inputs: All 12 slider values
│   │   Code: Write Design Intent Package JSON to configurable path
│   │   Output: published (bool), output_path (str), triggered_layer2_mission (str)
│   └── Trigger: Button (designer-initiated)
│
├── Group: CURRENT_DESIGN (Read-Only Product Configurator Dashboard)
│   ├── GH Panel (single, monospaced, no input ports)
│   │   └── Renders 8 fixed blocks: Status, Published, Design Package,
│   │       Product DNA, Preview Quality, Certified Geometry,
│   │       Current Layer, Architecture
│   ├── Driven by: 12 live slider values + publish state sidecar
│   └── Renders DRAFT | READY | PUBLISHED
│
└── Group: INSPECTION_HOOKS
    └── (RhinoClaw inspect_workspace reads canvas/sliders directly)
```

**Required canvas order (top to bottom)**

```
[ PRODUCT DNA ]
      ↓
[ PREVIEW DESIGN ]
      ↓
[ CURRENT DESIGN ]      ← immediately above PUBLISH_DESIGN
      ↓
[ PUBLISH DESIGN ]
```

The Current Design panel sits directly above the Publish Design group so the designer reads state, then acts on it. Panel content and formatting are normative in IDD-010 §3.5; FRS-010 §4.5 and §4.6 define the requirements and state machine.

### 3.2 Publish Design Implementation (Design Intent Package)

```python
# GH Python Script Component: "Publish Design"
# Inputs: Height, Diameter, Twist_Angle, Wall_Thickness, 
#         Gyroid_Cell_Size, Gyroid_Thickness, Band_Width,
#         Bore_Diameter, Collar_Height, Dome_Height,
#         Top_Closure_Ratio, Voxel_Resolution
# Output: published (bool), output_path (str), triggered_layer2_mission (str)

import json
import os

design_intent = {
    "product": "LatticeLamp",
    "height": Height,
    "diameter": Diameter,
    "twist_deg": Twist_Angle,
    "wall_mm": Wall_Thickness,
    "gyroid_cell": Gyroid_Cell_Size,
    "sheet_mm": Gyroid_Thickness,
    "band_mm": Band_Width,
    "bore_diameter": Bore_Diameter,
    "collar_height": Collar_Height,
    "dome_height": Dome_Height,
    "top_closure_ratio": Top_Closure_Ratio,
    "voxel_mm": Voxel_Resolution
}

output_path = "C:/temp/lattice_lamp_params.json"  # Configurable via extra input
os.makedirs(os.path.dirname(output_path), exist_ok=True)

with open(output_path, 'w') as f:
    json.dump(design_intent, f, indent=2)

published = True
triggered_layer2_mission = "lattice-lamp-layer2-001"
```

### 3.3 Preview Design Implementation (Fast Visual Feedback)

```python
# GH Python Script Component: "Preview Design"
# Inputs: All 12 slider values, resolution (fast/medium/high)
# Output: previewed (bool), grid_size (str), solve_time_ms (int)

# Runs fast local GH solve at 38³ grid for immediate visual feedback
# Does NOT export JSON or trigger Layer 2
# Purpose: Designer exploration without certification overhead
```

### 3.4 Current Design Panel Implementation

#### 3.4.1 Component composition

```
12 certified sliders ──┐
6 studio sliders ──────┼─► [ Python 3 Script: Compose Panel Text ] ─► [ Panel ]
Publish Design --------┘            ▲                                   (read-only)
  (published, path)                 │
                                    │
Preview Design ─────────────────────┘
  (previewed, grid)
```

Three components, no geometry code:

| Component | Role |
|-----------|------|
| `Compose Panel Text` (Python 3 Script) | Reads the 12 certified values, the 6 studio values, the publish-state sidecar, and the preview/publish pulse inputs; returns one formatted string |
| `Panel` (GH native) | Displays the string; must have **no input ports exposed to the designer** |
| `File Read` (native or inside the script) | Loads `lattice_lamp_publish_state.json` each solve |

Composing display text is presentation, not geometry, so this does not violate the FRS-010 §4.4 boundary. No certified geometry is produced here.

The studio sliders feed the panel for display only. They must not be wired into Publish Design's JSON payload — only into the sidecar write.

#### 3.4.2 Refresh mechanics (the non-obvious part)

A GH Panel only re-evaluates when one of its upstream inputs changes. Two cases must both refresh it:

1. **Slider moved** → all 12 values are inputs to the script, so any change forces recompute. Handled automatically.
2. **Publish or Preview pressed with unchanged values** → nothing upstream changed, so the panel would go stale. Therefore the `published` boolean from Publish Design and the `previewed` boolean from Preview Design MUST be wired as inputs to `Compose Panel Text`, acting as refresh pulses.

Omitting the pulses is the most likely implementation defect: the panel would show `DRAFT` immediately after a successful publish until some slider is touched.

#### 3.4.3 State derivation

```python
CERT_KEYS = ("height","diameter","twist_deg","wall_mm","gyroid_cell","sheet_mm",
             "band_mm","bore_diameter","collar_height","dome_height",
             "top_closure_ratio","voxel_mm")
STUDIO_KEYS = ("wave_amplitude","wave_frequency","interference_density",
               "helical_offset","bulb_concealment","mount_diameter")

def fingerprint(p, keys) -> str:
    canon = json.dumps(
        {k: round(float(p[k]), 4) for k in keys},
        sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canon.encode()).hexdigest()

cert_fp   = fingerprint(current, CERT_KEYS)
studio_fp = fingerprint(current, STUDIO_KEYS)

state = load_sidecar() or {}          # missing/unparseable -> {}

# Status is governed by certified_fp ONLY.
status = "DRAFT"
if state.get("certified_fingerprint") == cert_fp:
    status = "PUBLISHED"
elif state.get("preview_fingerprint") == cert_fp:
    status = "READY"

published_txt = (state.get("published_at","").replace("T"," ")[:16]
                 if status == "PUBLISHED" else
                 ("Pending" if status == "READY" else "Not Published"))
package_txt   = (os.path.basename(state.get("design_package",""))
                 if status == "PUBLISHED" else "Pending")

# Studio marker is advisory and never touches status.
studio_marker = ("matches published"
                 if state.get("published_studio_fingerprint") == studio_fp
                 else "changed since publish")
```

Degradation is explicit: absent or corrupt sidecar yields `DRAFT` / `Not Published` / `Pending`, never an exception on the canvas.

**Why two fingerprints**: the six studio parameters never reach the generator. If they contributed to `cert_fp`, editing Wave Amplitude would flip a published design to DRAFT and invite a republish that writes a byte-identical package — destroying the meaning of "published". Splitting the fingerprints keeps the certification signal exact while still surfacing that studio intent has drifted.

#### 3.4.4 Write path

| Action | Writes to sidecar |
|--------|-------------------|
| Preview Design succeeds | `preview_fingerprint`, `preview_grid` |
| Publish Design succeeds | `status`, `published_at` (ISO-8601 local), `design_package`, `certified_fingerprint`, `preview_*`, `studio_fingerprint`, `published_studio_fingerprint`, `studio_parameters`, `certified_engine`, `current_layer` |

`published_at` is captured at publish time and never recomputed on subsequent solves — otherwise the "Published" line would drift every time the file is reopened.

`studio_parameters` is written to the sidecar only. Publish Design's Design Intent Package must remain exactly `product` plus the 12 certified keys; adding studio keys would break schema equality with the certified engine and fail Layer 2 validation.

#### 3.4.5 Known risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pulse not wired to the panel script | Status stale after publish | Include `published`/`previewed` as inputs (3.4.2); assert in `inspect_workspace` |
| Float noise flips PUBLISHED → DRAFT | False "unpublished" warning | 4 dp rounding in fingerprint (IDD-010 §3.5.4) |
| Sidecar path drift between Preview and Publish | Panel reads wrong state | Single shared path constant |
| Designer edits the panel text | Panel no longer authoritative | Panel has no input ports; `inspect_workspace` asserts `read_only` |
| Studio params leaked into the Design Intent Package | Layer 2 schema check fails; generator rejects the package | Keep studio keys out of the publish payload; assert exactly 13 keys in `validate_schema` |
| Studio params folded into `cert_fp` | Published design flips to DRAFT on a studio-only edit | Two fingerprints (3.4.3); assert studio edit leaves status PUBLISHED |
| Studio block not visually distinct | Designer believes Wave/Interference affect the manufactured part | Separate heading, separator, `(Not in Certified Engine)` sub-header, closing note; assert `studio_block_labelled` |
| Parameters rendered in the wrong block | Dashboard misstates what is manufactured | `inspect_workspace` reports `crossover_violations`; non-empty is a failure |

---

## 4. Layer 2: Python Generator Architecture (Authoritative)

### 4.1 Module Structure

```
packages/generator-certified/
├── task034_engine.py      # Core SDF + Marching Cubes (single source of truth)
├── task034_run.py         # CLI entry: reads JSON → writes STL + reports
├── task034_reports.py     # Validation: topology, volume, dimensions, features
├── task037_converge.py    # Convergence study (0.8mm → 0.30mm reference)
├── task037_export_ref.py  # Reference mesh export (0.30mm, 80.5M faces)
└── task037_reports.py     # Convergence analysis, fidelity reports
```

### 4.2 Core Algorithm: SDF Composition (task034_engine.py)

```python
def build_field(params: dict) -> callable:
    """Return SDF field function f(x,y,z) → distance."""
    
    # Extract params (validated against schema)
    H = params["height"]
    R = params["diameter"] / 2
    twist = params["twist_deg"] * pi / 180
    wall = params["wall_mm"]
    cell = params["gyroid_cell"]
    sheet = params["sheet_mm"]
    band = params["band_mm"]
    bore = params["bore_diameter"] / 2
    collar_h = params["collar_height"]
    dome_h = params["dome_height"]
    
    K = 2 * pi / cell
    
    def sdf(x, y, z):
        r = sqrt(x*x + y*y)
        th = atan2(y, x)
        phase = twist * z / H
        
        # Wall: tapered cylinder with twist
        R_eff = R * (1 - 0.1 * cos(3*th - phase))
        d_wall = r - R_eff + wall
        
        # Gyroid lattice (within band)
        gyroid = sin(K*x)*cos(K*y) + sin(K*y)*cos(K*z) + sin(K*z)*cos(K*x)
        d_lat = smax(abs(gyroid) - sheet/2, -(r - R_eff + band))
        
        # Collar (bore)
        d_col = bore - r if z < collar_h else inf
        
        # Dome
        d_dome = z - (H - dome_h) if z > H - dome_h else inf
        
        # Field composition: KS=0.30
        return smin(smin(smin(d_wall, d_lat), d_col), d_dome)
    
    return sdf
```

### 4.3 Marching Cubes Extraction

```python
def extract_mesh(field: callable, params: dict) -> trimesh.Trimesh:
    """Marching cubes at voxel_mm resolution."""
    voxel = params["voxel_mm"]
    H = params["height"]
    R = params["diameter"] / 2
    
    # Bounding box with padding
    padding = 10.0
    bounds = [[-R-padding, -R-padding, -padding], 
              [R+padding, R+padding, H+padding]]
    
    # Grid dimensions
    nx = int((bounds[1][0] - bounds[0][0]) / voxel) + 1
    ny = int((bounds[1][1] - bounds[0][1]) / voxel) + 1
    nz = int((bounds[1][2] - bounds[0][2]) / voxel) + 1
    
    # Voxel budget check (90M limit)
    if nx * ny * nz > 90_000_000:
        raise ValueError(f"Voxel budget exceeded: {nx*ny*nz} > 90M")
    
    # Evaluate field on grid
    values = evaluate_field_on_grid(field, bounds, (nx, ny, nz))
    
    # Marching cubes (skimage.measure.marching_cubes)
    verts, faces, _, _ = marching_cubes(values, level=0, spacing=(voxel,)*3)
    verts += np.array(bounds[0])  # Translate to world coords
    
    return trimesh.Trimesh(vertices=verts, faces=faces, process=False)
```

---

## 5. Hermes Mission Specifications (Two-Layer)

### 5.1 Layer 1 Mission: GH Design Studio Validation

```json
{
  "mission_id": "lattice-lamp-layer1-001",
  "objective": "Validate GH Design Studio: Product DNA sliders, Preview Design, Publish Design",
  "tasks": [
    {"task_id": "preflight", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "preflight", "params": {}}, "depends_on": [], "verification_criteria": ["auth == 'ready'"]},
    {"task_id": "load_def", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "load_grasshopper_definition", "params": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh"}}, "depends_on": ["preflight"], "verification_criteria": ["definition_count > 0", "parameter_count == 12"]},
    {"task_id": "verify_ui", "operation": "inspect_workspace", "tool": "droid", "args": {"layer": 1, "expected_features": ["parameter_sliders", "parameter_groups", "publish_design", "preview_design", "current_design_panel"], "level": 3, "capture_images": true, "save_report": true}, "depends_on": ["load_def"], "verification_criteria": ["layer_1.compliance_score == 100"]},
    {"task_id": "test_preview", "operation": "preview_design", "tool": "droid", "args": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh", "resolution": "fast"}, "depends_on": ["load_def"], "verification_criteria": ["previewed == true", "grid_size == '38³'", "solve_time_ms < 5000"]},
    {"task_id": "test_publish", "operation": "publish_design", "tool": "droid", "args": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh", "output_path": "C:/temp/lattice_lamp_params.json"}, "depends_on": ["test_preview"], "verification_criteria": ["published == true", "design_intent.keys == 12", "design_intent.product == 'LatticeLamp'", "triggered_layer2_mission == 'lattice-lamp-layer2-001'"]}
  ]
}
```

### 5.2 Layer 2 Mission: Certified Geometry Generation

```json
{
  "mission_id": "lattice-lamp-layer2-001",
  "objective": "Generate certified STL from parameter JSON",
  "tasks": [
    {"task_id": "generate", "operation": "shell", "tool": "droid", "args": {"command": "python3 -m packages.generator_certified.task034_run --params C:/temp/lattice_lamp_params.json --output C:/temp/lattice_lamp_certified.stl --validate"}, "depends_on": [], "verification_criteria": ["exit_code == 0", "file_exists == 'C:/temp/lattice_lamp_certified.stl'"]},
    {"task_id": "validate_topo", "operation": "shell", "tool": "droid", "args": {"command": "python3 -c \"import trimesh; m=trimesh.load('C:/temp/lattice_lamp_certified.stl', force='mesh'); assert m.is_watertight; assert len(m.split(only_watertight=False))==1; print('TOPOLOGY_PASS')\""}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]},
    {"task_id": "validate_vol", "operation": "shell", "tool": "droid", "args": {"command": "python3 -c \"import trimesh; m=trimesh.load('C:/temp/lattice_lamp_certified.stl', force='mesh'); ref=1423008; err=abs(m.volume-ref)/ref*100; assert err < 2.0; print(f'VOLUME_PASS: {err:.2f}%')\""}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]},
    {"task_id": "validate_dims", "operation": "shell", "tool": "droid", "args": {"command": "python3 -c \"import trimesh; m=trimesh.load('C:/temp/lattice_lamp_certified.stl', force='mesh'); bbox=m.bounds; h=bbox[1][2]-bbox[0][2]; d=max(bbox[1][0]-bbox[0][0], bbox[1][1]-bbox[0][1]); assert abs(h-300)<0.5 and abs(d-150)<0.5; print(f'DIMS_PASS: h={h:.2f}, d={d:.2f}')\""}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]}
  ],
  "constraints": {"allow_shell": true, "allowed_paths": [".", "packages/", "/tmp", "C:/temp"], "forbidden_paths": [".git/**", "**/.env"], "max_retries": 1}
}
```

### 5.3 Inspection Missions (Dual-Layer)

```json
// Layer 1: GH UI Validation
{
  "mission_id": "lattice-lamp-inspect-layer1",
  "tasks": [
    {"task_id": "inspect_l1", "tool": "inspect_workspace", "args": {"layer": 1, "expected_features": ["parameter_sliders", "parameter_groups", "json_export"], "level": 3, "capture_images": true, "save_report": true}}
  ]
}

// Layer 2: Certified STL Validation
{
  "mission_id": "lattice-lamp-inspect-layer2",
  "tasks": [
    {"task_id": "inspect_l2", "tool": "inspect_workspace", "args": {"layer": 2, "expected_features": ["topology_certified", "volume_certified", "dimensions_certified", "features_certified"], "level": 3, "capture_images": false, "save_report": true}}
  ]
}

// Combined: Full Audit
{
  "mission_id": "lattice-lamp-inspect-both",
  "tasks": [
    {"task_id": "inspect_both", "tool": "inspect_workspace", "args": {"layer": "both", "expected_features": ["parameter_sliders", "parameter_groups", "json_export", "topology_certified", "volume_certified", "dimensions_certified", "features_certified"], "level": 3, "capture_images": true, "save_report": true}}
  ]
}
```

---

## 6. Validation & Quality Gates (Updated)

### 6.1 Layer 1 Checks (GH Design Studio)

| Check | Tool | Threshold |
|-------|------|-----------|
| 12 Product DNA sliders present | `inspect_workspace(layer=1)` | slider_count == 12 |
| Correct ranges/defaults | `inspect_workspace(layer=1)` | Match Python BASE dict |
| 4 logical groups | `inspect_workspace(layer=1)` | group_count == 4 |
| Publish Design works | `publish_design` | published == true, design_intent.product == "LatticeLamp" |
| Preview Design works | `preview_design` | previewed == true, grid_size == "38³" |
| Current Design panel | `inspect_workspace(layer=1)` | Panel shows values + READY/DRAFT status |
| Design Intent Package valid | Python validation | Exact BASE dict keys + product field |

### 6.2 Layer 2 Checks (Certified STL)

| Check | Tool | Threshold |
|-------|------|-----------|
| Watertight | `Mesh.IsClosed` | True |
| Manifold | `Mesh.split()` | 1 component |
| No non-manifold edges | Custom check | 0 |
| Positive volume | `Mesh.Volume` | > 0 |
| Volume tolerance | vs reference | ±2% (1,423,008 mm³) |
| Height tolerance | BBox | ±0.5mm |
| Diameter tolerance | BBox | ±0.5mm |
| Sheet thickness | Feature detection | 1.104 ± 0.05 mm |
| Cell size | Feature detection | 8.0 ± 0.1 mm |
| 4 features present | Feature detection | wall, gyroid, collar, dome |

### 6.3 Layer 3 Checks (Manufacturing)

| Check | Tool | Threshold |
|-------|------|-----------|
| Slicer import | Orca/Bambu/Prusa | Success, no critical repairs |
| Toolpath generation | Slicer | Complete, no errors |
| Envelope fit | Printer profiles | Document pass/fail |
| Print time estimate | Slicer | Documented |
| Material estimate | Slicer | Documented |

---

## 7. Artifact Classifications (Formal)

| Artifact | File | Classification | Purpose |
|----------|------|----------------|---------|
| Grasshopper Definition | `lattice_lamp_v1_FROZEN.gh` | **Design Studio** | Parameter authoring, visual exploration, design intent declaration |
| Design Intent Package | `lattice_lamp_params.json` | **Design Intent Package** | Transfers design decisions (Product DNA) to Certified Geometry Engine |
| Certified Geometry Engine | `task034_engine.py` | **Certified Geometry Engine** | Generates authoritative geometry (SDF + marching cubes) |
| Certified Mesh | `lattice_lamp_certified.3dm` | **Certified Geometry** | Rich geometry for Rhino viewport (not STL) |
| Manufacturing Pipeline | TASK-044+ | **Certification & Production** | Slicer validation, envelope audit, production certification |

**Key Principle**: STL is a manufacturing exchange format only. Rhino works with richer geometry (3DM/native mesh). The feedback loop loads certified mesh as 3DM into "Lattice_Lamp_Certified" layer.

## 8. File Structure (Updated — Artifact-Based)

```
EdgeGDE/
├── docs/
│   ├── FRS-010-parametric-lattice-lamp.md       # Two-layer requirements
│   ├── IDD-010-parametric-lattice-lamp.md       # Two-layer interfaces
│   ├── SDD-010-parametric-lattice-lamp.md       # This file
│   ├── FRS-011-agentic-grasshopper-automation.md
│   └── IDD-011-agentic-grasshopper-automation.md
├── gh-definitions/
│   └── lattice_lamp_v1_FROZEN.gh                # Design Studio
├── design-intent/
│   └── lattice_lamp_params.json                 # Design Intent Package
├── packages/
│   ├── generator-certified/                      # Certified Geometry Engine
│   │   ├── task034_engine.py
│   │   ├── task034_run.py
│   │   ├── task034_reports.py
│   │   ├── task037_converge.py
│   │   ├── task037_export_ref.py
│   │   └── task037_reports.py
│   ├── rhinoclaw-client/
│   └── rhinoclaw-bridge/
├── certified-geometry/
│   ├── lattice_lamp_certified.3dm               # Certified Geometry (Rich)
│   └── lattice_lamp_certified.stl               # Manufacturing Exchange (STL)
├── inspection/                                   # Generated by Level 3 audit
│   ├── viewport.png
│   ├── canvas.png
│   ├── inspection.json
│   ├── inspection.md
│   └── stl_validation.json                       # Layer 2 validation
└── .hermes/
    └── config.yaml
```

---

## 8. Risks & Mitigations (Updated)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| GH parameter export fails | Low | High | Test export component thoroughly; fallback to manual JSON |
| JSON schema mismatch | Medium | High | Automated validation in Layer 2 mission; strict schema |
| Python generator voxel budget | Medium | High | 90M voxel limit enforced; error if exceeded |
| STL topology failure | Low | High | Certified generator validated at 0.30mm; convergence proven |
| Envelope failure (376mm vs 256mm) | Certain | High | Split-part strategy documented; large-format printer research |
| Slicer repair corruption | Medium | Medium | Test all 3 slicers; document repair behavior |

---

## 9. Phased Implementation (Updated)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| **1. Layer 1: GH Parameter UI** | `lattice_lamp_v1_FROZEN.gh` with 12 sliders + JSON export | 🔄 **ACTIVE** |
| **2. Layer 1: Inspection Integration** | RhinoClaw `inspect_workspace(layer=1)` implemented | ⏳ |
| **3. Layer 2: Mission Integration** | Hermes missions for Layer 1 → Layer 2 pipeline | ⏳ |
| **4. Layer 3: TASK-044 Phase 2** | Slicer validation with certified STL | ⏳ |
| **5. Layer 3: TASK-044 Phase 3** | Envelope audit + split-part strategy | ⏳ |
| **6. Layer 3: TASK-044 Phase 4-5** | Manufacturing readiness + production cert | ⏳ |

---

## 10. Enhanced Inspection Model (Dual-Layer)

### 10.1 Layer 1 Inspection (GH UI)

**Sub-calls (parallel):**
- `scene_summary()` → Scene metrics
- `list_grasshopper_definitions()` → GH definitions
- `get_grasshopper_outputs()` → GH outputs (visual preview)
- `capture_grasshopper_canvas()` → Canvas image (slider verification)

**Evidence collection:**
- Slider count, exposed parameters, groups
- Export component presence, test export validity

### 10.2 Layer 2 Inspection (Certified STL)

**Sub-calls (local Python):**
- Load STL → topology validation (trimesh)
- Volume calculation → tolerance check
- BBox dimensions → tolerance check
- Feature detection (wall, gyroid, collar, dome)

### 10.3 Combined Inspection (Layer="both")

Runs both Layer 1 and Layer 2, returns unified compliance score (≥90 = CERTIFIED).

---

**End of SDD-010 v1.0.0**