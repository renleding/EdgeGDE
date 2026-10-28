# SDD-010: Parametric Lattice Lamp Generator — System Design Document

**Status**: DRAFT
**Version**: 0.3.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-010, IDD-010

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES (Director)                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ rhinoclaw-bridge (MCP Server)                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ TCP 1999 (Tailscale)
┌─────────────────────────────────────────────────────────────────────────────┐
│ RHINO PC (pc2)                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ RhinoClaw Plugin v0.8.2+                                            │   │
│  │  - TCP Listener: 1999                                               │   │
│  │  - Native GH: load_grasshopper_definition, run_grasshopper,        │   │
│  │    bake_grasshopper, get_grasshopper_canvas                        │   │
│  │  - **Unified Inspection: inspect_workspace**                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Rhino 8 + Grasshopper                                               │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ lattice_lamp_v1.gh                                          │   │   │
│  │  │  - 12 Parameter Sliders                                     │   │   │
│  │  │  - Geometry Pipeline (TPMS Gyroid + Wave + Twist)          │   │   │
│  │  │  - Bake Output Layer                                        │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Components

| Component | Role |
|-----------|------|
| **Hermes** | Parameter orchestration, mission planning, verification |
| **rhinoclaw-bridge** | MCP↔TCP translation, auth, framing |
| **RhinoClaw Plugin** | GH definition loading, execution, baking, **unified inspection** |
| **Grasshopper** | Parametric evaluation, TPMS gyroid, wave, twist |
| **Rhino 8** | Baking, mesh export, STL validation |

### 2.2 Data Flow (Generation)

```
Hermes Mission
      │
      ▼
MCP: load_grasshopper_definition(file_path="lattice_lamp_v1.gh")
      │
      ▼
MCP: run_grasshopper(file_path, inputs={12 params})
      │
      ▼
Grasshopper Recompute
      │
      ├─► Base Geometry (tapered cylinder + twist)
      ├─► TPMS Gyroid (cell_size, thickness)
      ├─► Wave Modulation (amplitude, frequency)
      ├─► Twist Deformation (angle, helical_offset)
      ├─► Interference Pattern (density)
      ├─► Top Closure (ratio)
      ├─► Bulb Concealment + Mount Neck
      │
      ▼
MCP: bake_grasshopper(file_path, layer="Lattice_Lamp_Output")
      │
      ▼
Rhino: Mesh → STL Export
      │
      ▼
Validation (watertight, volume, normals)
      │
      ▼
Hermes: Mission Complete + Artifact
```

### 2.3 Data Flow (Unified Inspection — Level 3)

```
Hermes: inspect_workspace(expected_features=[...], capture_images=True, save_report=True)
      │
      ▼
MCP: inspect_workspace(...)
      │
      ▼
RhinoClaw Plugin: Parallel Execution
      │
      ├─► scene_summary()              → Scene metrics
      ├─► list_grasshopper_definitions() → GH definitions
      ├─► get_grasshopper_outputs()    → GH outputs
      ├─► capture_viewport(1280×720)   → Viewport image (base64)
      ├─► capture_grasshopper_canvas() → Canvas image (base64)
      │
      ▼
Aggregate → Evidence Collection → Compliance Scoring → Report Generation
      │
      ▼
Return Unified Snapshot + Write Artifacts to inspection/
```

### 2.4 Data Flow (Level 1: Lightweight)

```
Hermes: scene_summary() + get_grasshopper_outputs()
      │
      ▼
RhinoClaw Plugin: Parallel (2 calls)
      │
      ├─► scene_summary()
      ├─► get_grasshopper_outputs()
      │
      ▼
Return: Scene metrics + GH outputs (no images, no validation)
```

### 2.5 Data Flow (Level 2: Visual)

```
Hermes: inspect_workspace(capture_images=True, save_report=False)
      │
      ▼
MCP: inspect_workspace(capture_images=True, save_report=False)
      │
      ▼
RhinoClaw Plugin: Parallel (5 calls)
      │
      ├─► scene_summary()
      ├─► list_grasshopper_definitions()
      ├─► get_grasshopper_outputs()
      ├─► capture_viewport(1280×720)
      ├─► capture_grasshopper_canvas()
      │
      ▼
Return: Full snapshot + viewport.png + canvas.png (no report)
```

---

## 3. Grasshopper Definition Architecture

### 3.1 Canvas Organization

```
lattice_lamp_v1.gh
├── Group: PARAMETERS (12 sliders)
│   ├── Geometry: Height, Diameter, Twist_Angle
│   ├── Lattice: Gyroid_Cell_Size, Gyroid_Thickness, Interference_Density, Helical_Offset
│   ├── Optical: Wave_Amplitude, Wave_Frequency, Top_Closure_Ratio, Bulb_Concealment
│   └── Manufacturing: Mount_Diameter, Wall_Thickness
│
├── Group: BASE_GEOMETRY
│   ├── Cylinder (Height, Diameter)
│   ├── Taper (linear interpolation)
│   ├── Twist (Twist_Angle + Helical_Offset phase)
│   └── Twisted BRep
│
├── Group: LATTICE_GENERATION
│   ├── TPMS Gyroid (Gyroid_Cell_Size, Gyroid_Thickness)
│   ├── Interference Modulation (Interference_Density)
│   ├── Wave Deformation (Wave_Amplitude, Wave_Frequency)
│   └── Boolean Intersection (lattice ∩ base_form)
│
├── Group: TOP_CLOSURE
│   ├── Aperture Calculation (Top_Closure_Ratio)
│   ├── Closure Cap (when ratio > 0)
│   └── Blend Transition
│
├── Group: INTERNAL_OPTICS
│   ├── Bulb Concealment Baffle (Bulb_Concealment depth)
│   └── Mount Neck (Mount_Diameter, Wall_Thickness)
│
├── Group: MANUFACTURING_PREP
│   ├── Mesh Conversion (BRep → Mesh)
│   ├── Watertight Validation
│   ├── Non-Manifold Cleanup
│   └── STL Export Layer
│
└── Group: BAKE_OUTPUT
    ├── Bake to Layer "Lattice_Lamp_Output"
    └── Export STL
```

### 3.2 Key Algorithms

| Module | Algorithm | Parameters |
|--------|-----------|------------|
| **TPMS Gyroid** | `sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) < t` | Cell_Size → domain scale; Thickness → iso-offset |
| **Wave Modulation** | `r = r0 + A*sin(f*θ + φ)` | Amplitude, Frequency |
| **Twist** | Affine transform along Z: `θ(z) = (z/H)*Twist_Angle + Helical_Offset` | Twist_Angle, Helical_Offset |
| **Interference** | Moiré: `density = base * (1 + sin(k*x)*sin(k*y)*Interference_Density)` | Interference_Density |
| **Top Closure** | Linear blend: `radius(z) = r_top + (r_mid - r_top)*Top_Closure_Ratio` | Top_Closure_Ratio |

---

## 4. Hermes Mission Specification

### 4.1 Generation Mission

```json
{
  "mission_id": "lattice-lamp-v1-generate",
  "objective": "Generate parametric lattice lamp STL for given parameters",
  "tasks": [
    {
      "task_id": "load_definition",
      "tool": "load_grasshopper_definition",
      "args": {"file_path": "lattice_lamp_v1.gh", "only_player_inputs": true}
    },
    {
      "task_id": "run_definition",
      "tool": "run_grasshopper",
      "args": {"file_path": "lattice_lamp_v1.gh", "inputs": {12 params}},
      "depends_on": ["load_definition"]
    },
    {
      "task_id": "bake_geometry",
      "tool": "bake_grasshopper",
      "args": {"file_path": "lattice_lamp_v1.gh", "layer": "Lattice_Lamp_Output"},
      "depends_on": ["run_definition"]
    },
    {
      "task_id": "export_stl",
      "tool": "execute_python3_code",
      "args": {"code": "export_stl_to_file('lattice_lamp_output.stl')"},
      "depends_on": ["bake_geometry"]
    }
  ]
}
```

### 4.2 Inspection Missions (Three Levels)

```json
// Level 1: Lightweight (every solve)
{
  "mission_id": "lattice-lamp-v1-inspect-l1",
  "objective": "Quick health check after solve",
  "tasks": [
    {"task_id": "scene_summary", "tool": "scene_summary", "args": {}},
    {"task_id": "gh_outputs", "tool": "get_grasshopper_outputs", "args": {}}
  ]
}

// Level 2: Visual (major geometry change)
{
  "mission_id": "lattice-lamp-v1-inspect-l2",
  "objective": "Visual verification after geometry change",
  "tasks": [
    {
      "task_id": "inspect_workspace",
      "tool": "inspect_workspace",
      "args": {"capture_images": true, "save_report": false}
    }
  ]
}

// Level 3: Engineering Audit (milestones)
{
  "mission_id": "lattice-lamp-v1-inspect-l3",
  "objective": "Full engineering audit with compliance scoring",
  "tasks": [
    {
      "task_id": "inspect_workspace",
      "tool": "inspect_workspace",
      "args": {
        "expected_features": [
          "gyroid_lattice",
          "parametric_controls",
          "mounting_collar",
          "printable_mesh"
        ],
        "capture_images": true,
        "save_report": true
      }
    }
  ]
}
```

---

## 5. Validation & Quality Gates

### 5.1 Automated Checks (Generation)

| Check | Tool | Threshold |
|-------|------|-----------|
| Watertight mesh | `execute_python3_code` (RhinoCommon `Mesh.IsClosed`) | True |
| Positive volume | `Mesh.Volume` | > 0 |
| No flipped normals | `Mesh.FaceNormals` consistency | All outward |
| Non-manifold edges | `Mesh.NonManifoldEdges` | < 0.1% |
| Volume bounds | `Mesh.Volume` | Within expected range for params |

### 5.2 Inspection Validation (Three Levels)

| Level | Check | Source | Threshold |
|-------|-------|--------|-----------|
| L1 | Solve successful | `outputs.has_outputs` | true |
| L1 | Object count changed | `scene.object_count` | > previous |
| L1 | No solve errors | `outputs.error_count` | 0 |
| L2 | Geometry looks correct | `viewport.image_base64` | Human review |
| L2 | Sliders connected | `canvas.image_base64` | Human review |
| L3 | Compliance score ≥ 75 | `validation.compliance_score` | ≥ 75 |
| L3 | All features detected | `validation.feature_compliance` | All true |
| L3 | Evidence complete | `validation.evidence` | All fields populated |

### 5.3 Parameter Sweep Test

```python
# Automated sweep for CI
test_cases = [
    {"Height": 250, "Diameter": 150, "Twist_Angle": 45, ...},
    {"Height": 300, "Diameter": 200, "Twist_Angle": 90, ...},
    {"Height": 200, "Diameter": 100, "Twist_Angle": 0, ...},
    {"Height": 350, "Diameter": 180, "Twist_Angle": 180, ...},
    {"Height": 280, "Diameter": 160, "Twist_Angle": 270, ...},
]
# Each produces valid, distinct STL + passes Level 3 audit
```

---

## 6. File Structure

```
EdgeGDE/
├── docs/
│   ├── FRS-010-parametric-lattice-lamp.md
│   ├── IDD-010-parametric-lattice-lamp.md
│   └── SDD-010-parametric-lattice-lamp.md
├── gh-definitions/
│   └── lattice_lamp_v1.gh           # Grasshopper definition
├── packages/
│   ├── rhinoclaw-client/
│   └── rhinoclaw-bridge/
├── inspection/                      # Generated by Level 3 audit
│   ├── viewport.png
│   ├── canvas.png
│   ├── inspection.json
│   └── inspection.md
└── .hermes/
    └── config.yaml                   # MCP server config
```

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TPMS gyroid performance | Medium | High | Use efficient mesh generation; cache cell geometry |
| Boolean operations on dense lattice | Medium | High | Use mesh booleans, not BRep; simplify topology |
| Wave + interference interference | Low | Medium | Test parameter bounds; clamp values |
| STL export size | Medium | Medium | Decimate mesh if > 50MB; adaptive resolution |
| Inspection latency | Low | Medium | Parallel sub-calls; async aggregation |
| Report storage bloat | Low | Low | Auto-cleanup old Level 3 reports; keep last 10 |

---

## 8. Phased Implementation

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | GH definition skeleton (parameters + groups) | 🔄 NEXT |
| 2 | Base geometry + twist pipeline | ⏳ |
| 3 | TPMS gyroid + interference | ⏳ |
| 4 | Wave modulation + top closure | ⏳ |
| 5 | Internal optics + mount | ⏳ |
| 6 | Manufacturing prep + bake/export | ⏳ |
| 7 | Hermes mission + parameter sweep | ⏳ |
| 8 | Validation + Bambu X1C test print | ⏳ |
| **9** | **Unified inspect_workspace (Level 1 + 2 + 3)** | **🔄 NEXT** |
| **10** | **Evidence-backed detection + compliance scoring** | **⏳** |
| **11** | **Level 3 report generation (inspection/ dir)** | **⏳** |

---

## 9. Analysis Summary: Enhanced Inspection Model

### Architecture Decision

The `inspect_workspace` capability is implemented as a **single RhinoClaw TCP command** that orchestrates 5 parallel sub-calls and aggregates results. This is a **plugin-level feature** (RhinoClaw v0.8.3+), not a bridge-side aggregation.

**Why plugin-level?**
- Lower latency (single TCP round-trip vs. 7)
- Parallel sub-call execution on Rhino UI thread
- Atomic snapshot (consistent state across all sub-calls)
- Plugin controls viewport/canvas capture quality

### Sub-Call Parallelization

```python
async def inspect_workspace(self, expected_features=None, capture_images=False, save_report=False):
    # Determine level based on flags
    if not capture_images and not save_report:
        # Level 1 equivalent (but with validation)
        sub_calls = ["scene_summary", "list_grasshopper_definitions", "get_grasshopper_outputs"]
    elif capture_images and not save_report:
        # Level 2
        sub_calls = ["scene_summary", "list_grasshopper_definitions", "get_grasshopper_outputs", 
                     "capture_viewport", "capture_grasshopper_canvas"]
    else:
        # Level 3
        sub_calls = ["scene_summary", "list_grasshopper_definitions", "get_grasshopper_outputs",
                     "capture_viewport", "capture_grasshopper_canvas"]
    
    # Fire all sub-calls in parallel
    tasks = [self._call(call, kwargs) for call, kwargs in build_sub_calls(sub_calls)]
    results = await asyncio.gather(*tasks)
    
    # Evidence collection
    evidence = collect_evidence(results, expected_features)
    
    # Compliance scoring
    compliance = score_compliance(evidence, expected_features)
    
    # Build snapshot
    snapshot = build_snapshot(results, evidence, compliance, expected_features)
    
    # Level 3: Generate artifacts
    if save_report:
        await generate_inspection_report(snapshot, capture_images)
    
    return snapshot
```

### Response Schema (Enhanced)

```json
{
  "inspection_id": "uuid",
  "level": 3,
  "scene": { "object_count": 39, "layer_count": 5, "types": {...}, "layers": {...} },
  "definitions": { "count": 1, "definitions": [...] },
  "outputs": { "has_outputs": true, "data": {...} },
  "viewport": { "image_base64": "...", "width": 1280, "height": 720, "mode": "Rendered" },
  "canvas": { "image_base64": "...", "width": 1920, "height": 1080 },
  "validation": {
    "expected_features": ["gyroid_lattice", "parametric_controls", ...],
    "object_count": 39,
    "layer_count": 5,
    "definition_count": 1,
    "has_gh_definition": true,
    "has_outputs": true,
    "ready_for_bake": true,
    "feature_compliance": {
      "gyroid_lattice": false,
      "parametric_controls": false,
      "mounting_collar": false,
      "printable_mesh": false
    },
    "evidence": {
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
    },
    "compliance_score": 25,
    "max_score": 100,
    "breakdown": {
      "gyroid_lattice": {"score": 0, "max": 25},
      "parametric_controls": {"score": 0, "max": 25},
      "mounting_collar": {"score": 25, "max": 25},
      "printable_mesh": {"score": 0, "max": 25}
    }
  },
  "artifacts": {
    "viewport_saved": "inspection/viewport.png",
    "canvas_saved": "inspection/canvas.png",
    "report_saved": "inspection/inspection.md",
    "json_saved": "inspection/inspection.json"
  }
}
```

---

## 10. Inspection Implementation Details

### Evidence Collection Functions

```python
def collect_evidence(results, expected_features):
    """Extract evidence for each expected feature from raw results."""
    scene, defs, outputs, viewport, canvas = results
    evidence = {}
    
    for feature in expected_features:
        if feature == "gyroid_lattice":
            evidence["gyroid_lattice"] = detect_gyroid(scene, canvas)
        elif feature == "parametric_controls":
            evidence["parametric_controls"] = detect_params(defs, canvas)
        elif feature == "mounting_collar":
            evidence["mounting_collar"] = detect_mount(scene)
        elif feature == "printable_mesh":
            evidence["printable_mesh"] = detect_printable(scene)
    
    return evidence

def detect_gyroid(scene, canvas):
    """Detect TPMS gyroid lattice in scene."""
    # Check scene for lattice objects on output layer
    lattice_objects = [obj for obj in scene.objects if obj.layer == "Lattice_Lamp_Output" and "gyroid" in obj.name.lower()]
    # Check canvas for TPMS cluster
    gh_clusters = find_gh_clusters(canvas, "tpms")
    
    return {
        "detected": len(lattice_objects) > 0,
        "evidence": {
            "mesh_count": len(lattice_objects),
            "lattice_components": len(lattice_objects),
            "gh_clusters": gh_clusters,
            "tpms_signature_present": len(gh_clusters) > 0
        }
    }

def detect_params(defs, canvas):
    """Detect parametric controls."""
    slider_count = sum(1 for obj in canvas.objects if obj.type == "NumberSlider")
    exposed = [p.name for p in defs.parameters if p.exposed]
    groups = list(set(p.group for p in defs.parameters))
    
    return {
        "detected": slider_count >= 12,
        "evidence": {
            "slider_count": slider_count,
            "exposed_parameters": exposed,
            "groups_present": groups
        }
    }

def detect_mount(scene):
    """Detect mounting collar."""
    mount_objects = [obj for obj in scene.objects if "mount" in obj.name.lower() or "collar" in obj.name.lower()]
    if mount_objects:
        obj = mount_objects[0]
        return {
            "detected": True,
            "evidence": {
                "object_name": obj.name,
                "layer": obj.layer,
                "bbox": obj.bbox
            }
        }
    return {"detected": False, "evidence": {}}

def detect_printable(scene):
    """Detect printable mesh."""
    baked = [obj for obj in scene.objects if obj.layer == "Lattice_Lamp_Output"]
    # Would need mesh validation call
    return {
        "detected": len(baked) > 0,
        "evidence": {
            "watertight": check_watertight(baked),
            "volume": sum(obj.volume for obj in baked),
            "non_manifold_edges": count_non_manifold(baked)
        }
    }
```

### Compliance Scoring

```python
def score_compliance(evidence, expected_features):
    """Calculate compliance score with per-feature breakdown."""
    weights = {
        "gyroid_lattice": 25,
        "parametric_controls": 25,
        "mounting_collar": 25,
        "printable_mesh": 25
    }
    
    breakdown = {}
    total = 0
    
    for feature in expected_features:
        max_score = weights.get(feature, 25)
        detected = evidence.get(feature, {}).get("detected", False)
        score = max_score if detected else 0
        breakdown[feature] = {"score": score, "max": max_score}
        total += score
    
    return {
        "compliance_score": total,
        "max_score": sum(weights.values()),
        "breakdown": breakdown
    }
```

---

**End of SDD-010 v0.3.0**