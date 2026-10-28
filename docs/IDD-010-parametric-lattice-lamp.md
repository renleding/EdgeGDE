# IDD-010: Parametric Lattice Lamp Generator — Interface Design Document

**Status**: DRAFT
**Version**: 0.3.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-010, SDD-010

---

## 1. Purpose

Defines exact interfaces for the parametric lattice lamp generator: Hermes ↔ GH definition parameter schema, GH canvas contract, bake/export formats, validation interfaces, and the enhanced unified inspection interface with evidence-backed detection, compliance scoring, and three inspection levels.

---

## 2. Interface Inventory

| Interface | Participants | Protocol | Direction |
|-----------|--------------|----------|-----------|
| **I-01** | Hermes ↔ rhinoclaw-bridge | MCP stdio | Bidirectional |
| **I-02** | rhinoclaw-bridge ↔ RhinoClaw Plugin | TCP 1999 | Bidirectional |
| **I-03** | Grasshopper Definition ↔ Runtime | GH Canvas | Internal |
| **I-04** | Baked Geometry ↔ Export | Rhino STL | Unidirectional |
| **I-05** | Hermes ↔ RhinoClaw Plugin | TCP 1999 | Bidirectional (Inspection) |

---

## 3. I-01: Hermes → rhinoclaw-bridge (MCP)

### 3.1 Tool: `load_grasshopper_definition`

```json
{
  "name": "load_grasshopper_definition",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_path": {"type": "string", "description": "Path to .gh file on Rhino PC"},
      "only_player_inputs": {"type": "boolean", "default": true}
    },
    "required": ["file_path"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "definition_id": "uuid",
    "parameters": [{"name": "Height", "type": "float", "default": 250, "min": 100, "max": 500}, ...]
  }
}
```

### 3.2 Tool: `run_grasshopper`

```json
{
  "name": "run_grasshopper",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_path": {"type": "string"},
      "inputs": {
        "type": "object",
        "properties": {
          "Height": {"type": "number", "minimum": 100, "maximum": 500},
          "Diameter": {"type": "number", "minimum": 50, "maximum": 300},
          "Twist_Angle": {"type": "number", "minimum": 0, "maximum": 360},
          "Wave_Amplitude": {"type": "number", "minimum": 0, "maximum": 50},
          "Wave_Frequency": {"type": "number", "minimum": 0.5, "maximum": 10},
          "Gyroid_Cell_Size": {"type": "number", "minimum": 2, "maximum": 20},
          "Gyroid_Thickness": {"type": "number", "minimum": 0.5, "maximum": 5},
          "Interference_Density": {"type": "number", "minimum": 0, "maximum": 1.0},
          "Helical_Offset": {"type": "number", "minimum": 0, "maximum": 1.0},
          "Top_Closure_Ratio": {"type": "number", "minimum": 0, "maximum": 1.0},
          "Bulb_Concealment": {"type": "number", "minimum": 0, "maximum": 1.0},
          "Mount_Diameter": {"type": "number", "minimum": 10, "maximum": 60},
          "Wall_Thickness": {"type": "number", "minimum": 1, "maximum": 10}
        },
        "required": ["Height", "Diameter", "Twist_Angle", "Wave_Amplitude", "Wave_Frequency", "Gyroid_Cell_Size", "Gyroid_Thickness", "Interference_Density", "Helical_Offset", "Top_Closure_Ratio", "Bulb_Concealment", "Mount_Diameter", "Wall_Thickness"]
      }
    },
    "required": ["file_path", "inputs"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "definition_id": "uuid",
    "solve_time_ms": 8420,
    "geometry_count": 47,
    "bbox": {"min": [x,y,z], "max": [x,y,z]}
  }
}
```

### 3.3 Tool: `bake_grasshopper`

```json
{
  "name": "bake_grasshopper",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_path": {"type": "string"},
      "layer": {"type": "string", "default": "Lattice_Lamp_Output"}
    },
    "required": ["file_path"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "baked_objects": ["obj_id_1", "obj_id_2", ...],
    "layer": "Lattice_Lamp_Output",
    "object_count": 12
  }
}
```

### 3.4 Tool: `execute_python3_code` (STL Export)

```json
{
  "name": "execute_python3_code",
  "inputSchema": {
    "type": "object",
    "properties": {
      "code": {"type": "string"},
      "timeout": {"type": "number", "default": 60}
    },
    "required": ["code"]
  }
}
```

**Export STL Code Template:**
```python
import Rhino
import Rhino.Geometry as rg
import scriptcontext as sc

# Find baked objects on output layer
layer_name = "Lattice_Lamp_Output"
objects = [obj for obj in sc.doc.Objects if obj.Attributes.LayerIndex == sc.doc.Layers.Find(layer_name, True)]

# Join meshes
meshes = []
for obj in objects:
    if obj.Geometry.ObjectType == rg.GeometryBase.Type.Mesh:
        meshes.append(obj.Geometry)
    elif obj.Geometry.ObjectType == rg.GeometryBase.Type.Brep:
        mesh = rg.Mesh()
        rg.Mesh.CreateFromBrep(obj.Geometry, rg.MeshingParameters.FastRenderMesh, mesh)
        if mesh.IsValid:
            meshes.append(mesh)

# Combine
if meshes:
    combined = rg.Mesh()
    for m in meshes:
        combined.Append(m)
    
    # Validate
    if combined.IsClosed:
        # Export STL
        path = r"C:\temp\lattice_lamp_output.stl"
        combined.Export(path, rg.FileWriteOptions())
        print(f"Exported {path}")
    else:
        print("ERROR: Mesh not watertight")
```

---

## 4. I-02: rhinoclaw-bridge ↔ RhinoClaw Plugin (TCP)

Same wire protocol as FRS-008/IDD-008. Relevant commands:

| Command | Purpose |
|---------|---------|
| `load_grasshopper_definition` | Load .gh file, return definition_id + parameter schema |
| `run_grasshopper` | Execute with inputs, return definition_id + solve metadata |
| `bake_grasshopper` | Bake output to Rhino layer |
| `execute_python3_code` | Run export/validation code |
| **`inspect_workspace`** | **Unified multimodal inspection snapshot (3 levels)** |

---

## 5. I-03: Grasshopper Definition Contract

### 5.1 Parameter Schema (12 Inputs)

| Name | Type | Min | Max | Default | Unit | Group |
|------|------|-----|-----|---------|------|-------|
| `Height` | Float | 100 | 500 | 250 | mm | Geometry |
| `Diameter` | Float | 50 | 300 | 150 | mm | Geometry |
| `Twist_Angle` | Float | 0 | 360 | 45 | deg | Geometry |
| `Wave_Amplitude` | Float | 0 | 50 | 10 | mm | Optical |
| `Wave_Frequency` | Float | 0.5 | 10 | 3 | cycles | Optical |
| `Gyroid_Cell_Size` | Float | 2 | 20 | 6 | mm | Lattice |
| `Gyroid_Thickness` | Float | 0.5 | 5 | 1.5 | mm | Lattice |
| `Interference_Density` | Float | 0 | 1.0 | 0.3 | — | Lattice |
| `Helical_Offset` | Float | 0 | 1.0 | 0.25 | phase | Geometry |
| `Top_Closure_Ratio` | Float | 0 | 1.0 | 0.8 | — | Optical |
| `Bulb_Concealment` | Float | 0 | 1.0 | 0.6 | ratio | Optical |
| `Mount_Diameter` | Float | 10 | 60 | 25 | mm | Manufacturing |
| `Wall_Thickness` | Float | 1 | 10 | 3 | mm | Manufacturing |

### 5.2 Canvas Layout Contract

| Group | Color | Position (x,y) | Components |
|-------|-------|----------------|------------|
| PARAMETERS | Light Blue | (100, 100) | 12 Number Sliders |
| BASE_GEOMETRY | Light Green | (500, 100) | Cylinder, Taper, Twist |
| LATTICE_GENERATION | Light Yellow | (500, 400) | TPMS, Interference, Wave |
| TOP_CLOSURE | Light Orange | (500, 700) | Aperture, Cap, Blend |
| INTERNAL_OPTICS | Light Pink | (100, 400) | Baffle, Mount |
| MANUFACTURING_PREP | Light Purple | (100, 700) | Mesh, Validate, Export |
| BAKE_OUTPUT | Light Gray | (900, 100) | Bake Layer, STL Export |

### 5.3 Output Contract

| Output | Type | Layer | Description |
|--------|------|-------|-------------|
| `Lattice_Body` | Mesh/BRep | Lattice_Lamp_Output | Main gyroid lattice |
| `Top_Cap` | BRep | Lattice_Lamp_Output | Closure aperture |
| `Mount_Neck` | BRep | Lattice_Lamp_Output | Socket interface |
| `Baffle` | BRep | Lattice_Lamp_Output | Internal concealment |

---

## 6. I-04: Export/Validation Interface

### 6.1 STL Export Specification

| Property | Requirement |
|----------|-------------|
| Format | Binary STL (preferred) or ASCII |
| Units | Millimeters |
| Coordinate System | Rhino World XYZ |
| Watertight | **MANDATORY** |
| Positive Volume | **MANDATORY** |
| Normals | Outward-facing |
| Max File Size | 50 MB |

### 6.2 Validation Contract (Python)

```python
def validate_stl(mesh) -> dict:
    """Return validation results for baked mesh."""
    return {
        "watertight": mesh.IsClosed,
        "volume": mesh.Volume if mesh.IsClosed else 0,
        "positive_volume": mesh.Volume > 0 if mesh.IsClosed else False,
        "face_count": mesh.Faces.Count,
        "vertex_count": mesh.Vertices.Count,
        "non_manifold_edges": len(mesh.GetNakedEdges()) if not mesh.IsClosed else 0,
        "flipped_normals": check_normals(mesh),
        "bbox": mesh.GetBoundingBox(True),
        "passes": mesh.IsClosed and mesh.Volume > 0
    }
```

---

## 7. I-05: Enhanced Unified Workspace Inspection

### 7.1 Command: `inspect_workspace`

**Request:**
```json
{
  "type": "inspect_workspace",
  "params": {
    "expected_features": [
      "gyroid_lattice",
      "parametric_controls",
      "mounting_collar",
      "printable_mesh"
    ],
    "capture_images": true,
    "save_report": true,
    "level": 3
  },
  "request_id": "uuid4-hex-8",
  "idempotency_key": "uuid4-hex-32",
  "auth": "token",
  "timeout": 30
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expected_features` | string[] | required | List of features to validate |
| `capture_images` | boolean | false | Include viewport/canvas captures |
| `save_report` | boolean | false | Generate inspection/ directory artifacts |
| `level` | integer (1-3) | 3 | Inspection level: 1=Lightweight, 2=Visual, 3=Audit |

**Level 1 Request (Lightweight):**
```json
{
  "type": "inspect_workspace",
  "params": {
    "level": 1
  }
}
```

**Level 2 Request (Visual):**
```json
{
  "type": "inspect_workspace",
  "params": {
    "capture_images": true,
    "save_report": false,
    "level": 2
  }
}
```

**Level 3 Request (Engineering Audit):**
```json
{
  "type": "inspect_workspace",
  "params": {
    "expected_features": [
      "gyroid_lattice",
      "parametric_controls",
      "mounting_collar",
      "printable_mesh"
    ],
    "capture_images": true,
    "save_report": true,
    "level": 3
  }
}
```

### 7.2 Response (Level 3 — Full)

```json
{
  "status": "success",
  "result": {
    "inspection_id": "uuid4-hex-32",
    "level": 3,
    "scene": {
      "object_count": 39,
      "layer_count": 5,
      "types": {"Brep": 36, "Point": 3},
      "layers": {
        "Lattice_Lamp_Output": {"count": 12, "bbox": {...}},
        "Default": {"count": 27, "bbox": {...}}
      }
    },
    "definitions": {
      "count": 1,
      "definitions": ["lattice_lamp_v1"]
    },
    "outputs": {
      "has_outputs": true,
      "data": {
        "geometry_count": 47,
        "solve_time_ms": 8420
      }
    },
    "viewport": {
      "image_base64": "iVBORw0KGgoAAAANSUhEUgA...",
      "width": 1280,
      "height": 720,
      "mode": "Rendered",
      "format": "png"
    },
    "canvas": {
      "image_base64": "iVBORw0KGgoAAAANSUhEUgA...",
      "width": 1920,
      "height": 1080,
      "format": "png"
    },
    "validation": {
      "expected_features": ["gyroid_lattice", "parametric_controls", "mounting_collar", "printable_mesh"],
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
  },
  "request_id": "uuid4-hex-8",
  "operation_id": "uuid",
  "session_id": "uuid"
}
```

### 7.3 Response (Level 1 — Lightweight)

```json
{
  "status": "success",
  "result": {
    "inspection_id": "uuid4-hex-32",
    "level": 1,
    "scene": {
      "object_count": 39,
      "layer_count": 5,
      "types": {"Brep": 36, "Point": 3}
    },
    "outputs": {
      "has_outputs": true,
      "data": {
        "geometry_count": 47,
        "solve_time_ms": 8420
      }
    },
    "validation": {
      "object_count": 39,
      "has_outputs": true,
      "solve_success": true,
      "object_count_changed": true
    }
  },
  "request_id": "uuid4-hex-8"
}
```

### 7.4 Response (Level 2 — Visual)

```json
{
  "status": "success",
  "result": {
    "inspection_id": "uuid4-hex-32",
    "level": 2,
    "scene": { ... },
    "definitions": { "count": 1, "definitions": [...] },
    "outputs": { "has_outputs": true, "data": {...} },
    "viewport": { "image_base64": "...", "width": 1280, "height": 720 },
    "canvas": { "image_base64": "...", "width": 1920, "height": 1080 },
    "validation": {
      "expected_features": [],
      "object_count": 39,
      "has_gh_definition": true,
      "has_outputs": true,
      "ready_for_bake": true
    },
    "artifacts": {
      "viewport_saved": "inspection/viewport.png",
      "canvas_saved": "inspection/canvas.png"
    }
  }
}
```

---

## 8. Evidence-Backed Feature Detection

### 8.1 Feature Detection Logic & Evidence

| Feature | Detection Logic | Evidence Fields |
|---------|----------------|-----------------|
| `gyroid_lattice` | Scene objects on `Lattice_Lamp_Output` with TPMS signature; GH canvas has TPMS cluster | `mesh_count`, `lattice_components`, `gh_clusters`, `tpms_signature_present` |
| `parametric_controls` | GH definition loaded + 12+ sliders exposed + grouped | `slider_count`, `exposed_parameters`, `groups_present` |
| `mounting_collar` | Object with "mount"/"collar" in name on output layer | `object_name`, `layer`, `bbox` |
| `printable_mesh` | Baked objects exist + watertight + positive volume | `watertight`, `volume`, `non_manifold_edges` |

### 8.2 Evidence Schema

```json
{
  "evidence": {
    "gyroid_lattice": {
      "detected": "boolean",
      "evidence": {
        "mesh_count": "integer",
        "lattice_components": "integer",
        "gh_clusters": "string[]",
        "tpms_signature_present": "boolean"
      }
    },
    "parametric_controls": {
      "detected": "boolean",
      "evidence": {
        "slider_count": "integer",
        "exposed_parameters": "string[]",
        "groups_present": "string[]"
      }
    },
    "mounting_collar": {
      "detected": "boolean",
      "evidence": {
        "object_name": "string",
        "layer": "string",
        "bbox": "number[][]"
      }
    },
    "printable_mesh": {
      "detected": "boolean",
      "evidence": {
        "watertight": "boolean",
        "volume": "number",
        "non_manifold_edges": "integer"
      }
    }
  }
}
```

---

## 9. Compliance Scoring

### 9.1 Scoring Model

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

| Feature | Weight | Detection → Score |
|---------|--------|-------------------|
| `gyroid_lattice` | 25 | detected → 25, else 0 |
| `parametric_controls` | 25 | detected → 25, else 0 |
| `mounting_collar` | 25 | detected → 25, else 0 |
| `printable_mesh` | 25 | detected → 25, else 0 |

**Thresholds:**
- **Pass**: ≥ 75/100
- **Conditional**: 50–74
- **Fail**: < 50

---

## 10. Automatic Report Generation (Level 3)

### 10.1 Artifact Structure

```
inspect_workspace(capture_images=True, save_report=True, level=3)

inspection/
├── viewport.png          # 1280×720 rendered viewport
├── canvas.png            # 1920×1080 GH canvas
├── inspection.json       # Full snapshot + evidence + compliance
└── inspection.md         # Human-readable audit report
```

### 10.2 Report Template (inspection.md)

```markdown
# Inspection Report: lattice-lamp-v1

**Inspection ID:** uuid4-hex-32
**Timestamp:** 2026-10-25T10:30:00Z
**Level:** 3 (Engineering Audit)
**Compliance Score:** 25/100

## Feature Compliance

| Feature | Status | Score | Evidence |
|---------|--------|-------|----------|
| Gyroid Lattice | ❌ FAIL | 0/25 | mesh_count=0, clusters=[] |
| Parametric Controls | ❌ FAIL | 0/25 | sliders=0, groups=[] |
| Mounting Collar | ✅ PASS | 25/25 | Mount_Neck @ Lattice_Lamp_Output |
| Printable Mesh | ❌ FAIL | 0/25 | watertight=false, edges=47 |

**Total:** 25/100 — FAIL

## Scene Summary

- Objects: 39
- Layers: 5
- Types: Brep=36, Point=3

## GH Status

- Definitions: 1 (lattice_lamp_v1)
- Outputs: present (47 geometries, 8420ms solve)
- Ready for bake: true

## Artifacts

- `viewport.png` — 1280×720 Rendered
- `canvas.png` — 1920×1080 GH Canvas
- `inspection.json` — Full machine-readable snapshot
```

---

## 8. Error Contracts

### 8.1 GH Execution Errors

| Error Code | Cause | Action |
|------------|-------|--------|
| `DEFINITION_NOT_FOUND` | .gh file missing | Verify file_path |
| `INVALID_INPUTS` | Parameter out of range | Check bounds |
| `SOLVE_FAILED` | GH recompute error | Check GH canvas for red components |
| `BAKE_FAILED` | No geometry to bake | Check definition output |

### 8.2 Export Errors

| Error Code | Cause | Action |
|------------|-------|--------|
| `MESH_NOT_WATERTIGHT` | `mesh.IsClosed == False` | Repair topology |
| `NEGATIVE_VOLUME` | `mesh.Volume <= 0` | Fix normals |
| `EXPORT_FAILED` | File write error | Check permissions/path |

### 8.3 Inspection Errors

| Error Code | Cause | Action |
|------------|-------|--------|
| `INSPECTION_TIMEOUT` | Sub-calls exceeded timeout | Increase timeout or reduce captures |
| `VIEWPORT_CAPTURE_FAILED` | Rhino viewport unavailable | Ensure Rhino window active |
| `CANVAS_CAPTURE_FAILED` | GH canvas not visible | Open GH window |
| `VALIDATION_FAILED` | Expected features not met | Check design compliance |
| `REPORT_GENERATION_FAILED` | Disk write error | Check permissions/path |

---

## 9. Three Inspection Levels — Usage Contract

| Level | Name | Trigger | Captures | Generates | Frequency |
|-------|------|---------|----------|-----------|-----------|
| **1** | Lightweight | Every GH solve | `scene_summary`, `get_grasshopper_outputs` | None | Every iteration |
| **2** | Visual | Major geometry change | Full snapshot + viewport + canvas | `viewport.png`, `canvas.png` | Every 10–20 changes |
| **3** | Engineering Audit | Milestones | Full + report generation | `inspection/{viewport.png, canvas.png, inspection.json, inspection.md}` | Milestones only |

### Usage Examples

```python
# Level 1: Every solve (cheap)
snapshot_l1 = inspect_workspace(level=1)
assert snapshot_l1["validation"]["solve_success"]
assert snapshot_l1["validation"]["object_count_changed"]

# Level 2: Major geometry revision
snapshot_l2 = inspect_workspace(capture_images=True, level=2)
# Review viewport.png, canvas.png manually

# Level 3: Before export/print/commit
snapshot_l3 = inspect_workspace(
    expected_features=["gyroid_lattice", "parametric_controls", "mounting_collar", "printable_mesh"],
    capture_images=True,
    save_report=True,
    level=3
)
assert snapshot_l3["validation"]["compliance_score"] >= 75
```

---

## 9. Parameter Sweep Test Contract

### 9.1 Test Matrix

```json
{
  "test_cases": [
    {"id": "nominal", "params": {"Height": 250, "Diameter": 150, "Twist_Angle": 45, "Wave_Amplitude": 10, "Wave_Frequency": 3, "Gyroid_Cell_Size": 6, "Gyroid_Thickness": 1.5, "Interference_Density": 0.3, "Helical_Offset": 0.25, "Top_Closure_Ratio": 0.8, "Bulb_Concealment": 0.6, "Mount_Diameter": 25, "Wall_Thickness": 3}},
    {"id": "tall_narrow", "params": {"Height": 400, "Diameter": 80, "Twist_Angle": 90, ...}},
    {"id": "short_wide", "params": {"Height": 120, "Diameter": 280, "Twist_Angle": 0, ...}},
    {"id": "max_twist", "params": {"Height": 300, "Diameter": 150, "Twist_Angle": 360, ...}},
    {"id": "open_top", "params": {"Height": 250, "Diameter": 150, "Top_Closure_Ratio": 0.0, ...}}
  ]
}
```

### 9.2 Test Assertions

```python
for case in test_cases:
    # Generation
    result = run_full_pipeline(case["params"])
    assert result["validation"]["passes"] == True
    assert result["stl_size_bytes"] < 50_000_000
    assert result["geometry"]["object_count"] > 0
    
    # Level 3 Inspection
    inspection = inspect_workspace(
        expected_features=["gyroid_lattice", "parametric_controls", "mounting_collar", "printable_mesh"],
        capture_images=True,
        save_report=True,
        level=3
    )
    assert inspection["validation"]["compliance_score"] >= 75
    assert all(v["detected"] for v in inspection["validation"]["evidence"].values())
```

---

## 10. Version Compatibility

| GH Definition | RhinoClaw Plugin | Rhino Version | Status |
|---------------|------------------|---------------|--------|
| `lattice_lamp_v1.gh` | 0.8.2+ | 8.36+ | Target |
| `lattice_lamp_v1.gh` | 0.8.3+ (inspection) | 8.36+ | Target |
| Future versions | 0.9+ | 8.x+ | Forward compatible |

---

**End of IDD-010 v0.3.0**