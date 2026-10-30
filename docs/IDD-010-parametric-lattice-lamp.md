# IDD-010: Parametric Lattice Lamp Generator — Two-Layer Interface Design

**Status**: DRAFT → **ARCHITECTURAL DECISION v1.0**
**Version**: 1.3.0
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-010, SDD-010, FRS-011, IDD-011
**Supersedes**: IDD-010 v1.2.0 (corrects the package schema to the engine's real 10 keys / 11-key package)

---

## 1. Purpose

Defines exact interfaces for the **two-layer** parametric lattice lamp generator:

| Layer | Interface | Purpose |
|-------|-----------|---------|
| **Layer 1: Design Authoring** | Hermes ↔ GH Parameter UI | Parameter authoring, visual feedback, JSON export |
| **Layer 2: Certified Geometry** | Hermes → Python Generator | Deterministic geometry generation, certification |
| **Layer 3: Manufacturing** | Python Generator → Slicer/Production | Topology, slicer validation, toolpaths |

---

## 2. Interface Inventory (Updated)

| Interface | Participants | Protocol | Direction | Layer |
|-----------|--------------|----------|-----------|-------|
| **I-01** | Hermes ↔ rhinoclaw-bridge | MCP stdio | Bidirectional | 1 |
| **I-02** | rhinoclaw-bridge ↔ RhinoClaw Plugin | TCP 1999 | Bidirectional | 1 |
| **I-03** | Grasshopper Definition ↔ Runtime | GH Canvas | Internal | 1 |
| **I-04** | GH Parameter Export ↔ File System | JSON | Unidirectional | 1 |
| **I-05** | Hermes → Python Generator | Direct execution | Unidirectional | 2 |
| **I-06** | Python Generator → STL/Binary | File I/O | Unidirectional | 2 |
| **I-07** | Hermes ↔ RhinoClaw Plugin | TCP 1999 | Bidirectional | 1 (Inspection) |
| **I-08** | Hermes → Manufacturing Pipeline | Mission Manifest | Unidirectional | 3 |
| **I-09** | Certified STL → Rhino Viewport | RhinoClaw TCP | Unidirectional | 2 (Feedback) |

---

## 3. Layer 1: Hermes ↔ Grasshopper Parameter Authoring

### 3.1 Tool: `load_grasshopper_definition` (Unchanged)

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
    "parameters": [{"name": "Height", "type": "float", "default": 300, "min": 100, "max": 500}, ...]
  }
}
```

### 3.2 Tool: `run_grasshopper` (Parameter Injection Only)

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
          "Twist_Angle": {"type": "number", "minimum": 0, "maximum": 180},
          "Wall_Thickness": {"type": "number", "minimum": 1, "maximum": 10},
          "Gyroid_Cell_Size": {"type": "number", "minimum": 2, "maximum": 20},
          "Gyroid_Thickness": {"type": "number", "minimum": 0.5, "maximum": 5},
          "Band_Width": {"type": "number", "minimum": 0, "maximum": 50},
          "Bore_Diameter": {"type": "number", "minimum": 10, "maximum": 100},
          "Collar_Height": {"type": "number", "minimum": 0, "maximum": 100},
          "Dome_Height": {"type": "number", "minimum": 0, "maximum": 50},
          "Top_Closure_Ratio": {"type": "number", "minimum": 0, "maximum": 1.0},
          "Voxel_Resolution": {"type": "number", "minimum": 0.2, "maximum": 1.0}
        },
        "required": ["Height", "Diameter", "Twist_Angle", "Wall_Thickness", "Gyroid_Cell_Size", "Gyroid_Thickness", "Band_Width", "Bore_Diameter", "Collar_Height", "Dome_Height", "Top_Closure_Ratio", "Voxel_Resolution"]
      }
    },
    "required": ["file_path", "inputs"]
  }
}
```

**Response:** (Geometry outputs are for visual preview only — NOT certified)
```json
{
  "success": true,
  "data": {
    "definition_id": "uuid",
    "solve_time_ms": 8420,
    "geometry_count": 47,
    "bbox": {"min": [x,y,z], "max": [x,y,z]},
    "certified": false
  }
}
```

### 3.3 NEW Tool: `publish_design` (Layer 1 — Design Intent Package Export)

```json
{
  "name": "publish_design",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_path": {"type": "string"},
      "output_path": {"type": "string", "default": "C:/temp/lattice_lamp_params.json"}
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
    "published": true,
    "output_path": "C:/temp/lattice_lamp_params.json",
    "design_intent": {
      "product": "LatticeLamp",
      "height": 300,
      "diameter": 150,
      "twist_deg": 45,
      "wall_mm": 1.6,
      "gyroid_cell": 8.0,
      "sheet_mm": 1.2,
      "band_mm": 25.0,
      "bore_mm": 40.0,
      "dome_mm": 1.6,
      "voxel_mm": 0.30
    },
    "triggered_layer2_mission": "lattice-lamp-layer2-001"
  }
}
```

**Purpose**: "Publish Design" — exports Design Intent Package (JSON) and triggers Layer 2 certified geometry generation.

### 3.4 NEW Tool: `preview_design` (Layer 1 — Fast Visual Preview)

```json
{
  "name": "preview_design",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_path": {"type": "string"},
      "resolution": {"type": "string", "enum": ["fast", "medium", "high"], "default": "fast"}
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
    "previewed": true,
    "resolution": "fast",
    "grid_size": "38³",
    "solve_time_ms": 2100,
    "geometry_count": 12
  }
}
```

**Purpose**: "Preview Design" — fast local GH preview at designer-friendly resolution without certification.

### 3.4 Tool: `inspect_workspace` (Updated with Layer Parameter)

**Request:**
```json
{
  "type": "inspect_workspace",
  "params": {
    "layer": 1,
    "expected_features": [
      "parameter_sliders",
      "parameter_groups",
      "json_export"
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
| `layer` | integer (1, 2, "both") | required | 1=GH UI, 2=Python STL, "both"=combined |
| `expected_features` | string[] | required | Layer-specific feature list |
| `capture_images` | boolean | false | Include viewport/canvas captures |
| `save_report` | boolean | false | Generate inspection/ directory artifacts |
| `level` | integer (1-3) | 3 | Inspection level: 1=Lightweight, 2=Visual, 3=Audit |

---

### 3.5 Current Design Panel Contract (Product Configurator)

The Current Design panel is a single read-only GH Panel. Its content is a deterministic function of three inputs:

| Input | Source | Volatility |
|-------|--------|------------|
| Live Product DNA values | 12 sliders, current solve | changes on every solve |
| Publish state | sidecar `lattice_lamp_publish_state.json` | changes on Preview/Publish actions |
| Current fingerprint | SHA-256 of canonical parameter JSON | derived from live values |

#### 3.5.1 Render Template (normative)

```
══════════════════════════════════════
          LATTICE LAMP V1
══════════════════════════════════════

Status
──────────────
{STATUS}

Published
──────────────
{PUBLISHED}

Design Package
──────────────
{PACKAGE}

Certified Product DNA
──────────────
{DNA_LINES}

Design Studio Parameters
(Not in Certified Engine)
──────────────
{STUDIO_LINES}
─────────────────────
{STUDIO_MARKER}
Does not affect
certified geometry

Preview Quality
──────────────
{PREVIEW}

Certified Geometry
──────────────
Python Generator
(task034_engine.py)

Current Layer
──────────────
Lattice_Lamp_Certified

Architecture
──────────────
Design Studio
→ Design Intent Package
→ Certified Geometry Engine
→ Manufacturing Pipeline

══════════════════════════════════════
```

Rules: monospaced font; 38-character rule lines (`═` header/footer, `─` block separators); two-space indent for the title; blocks separated by one blank line.

#### 3.5.2 Placeholder Values

| Placeholder | DRAFT | READY | PUBLISHED |
|-------------|-------|-------|-----------|
| `{STATUS}` | `DRAFT` | `READY` | `PUBLISHED` |
| `{PUBLISHED}` | `Not Published` | `Pending` | `YYYY-MM-DD HH:MM` (local time) |
| `{PACKAGE}` | `Pending` | `Pending` | filename only, e.g. `lattice_lamp_params.json` |

`{PREVIEW}` is always `<nx> × <ny> × <nz>` for the last preview run; `38 × 38 × 38` for the fast preset.

#### 3.5.3 Product DNA Line Format

Each line is `label` + dot leader + value + space + unit, aligned so that all values end at column 20 and units follow:

```
Height..............300.0 mm
```

| Display label | GH slider | JSON key | Format | Unit | Default |
|---------------|-----------|----------|--------|------|---------|
| `Height` | `Height` | `height` | `.1f` | `mm` | 300.0 |
| `Diameter` | `Diameter` | `diameter` | `.1f` | `mm` | 150.0 |
| `Twist` | `Twist_Angle` | `twist_deg` | `.1f` | `°` | 45.0 |
| `Wall Thickness` | `Wall_Thickness` | `wall_mm` | `.1f` | `mm` | 1.6 |
| `Cell Size` | `Gyroid_Cell_Size` | `gyroid_cell` | `.1f` | `mm` | 8.0 |
| `Sheet Thickness` | `Gyroid_Thickness` | `sheet_mm` | `.1f` | `mm` | 1.2 |
| `Band Width` | `Band_Width` | `band_mm` | `.1f` | `mm` | 25.0 |
| `Bore Diameter` | `Bore_Diameter` | `bore_mm` | `.1f` | `mm` | 40.0 |
| `Dome Thickness` | `Dome_Thickness` | `dome_mm` | `.1f` | `mm` | 1.6 |
| `Voxel Resolution` | `Resolution_Production` | `voxel_mm` | `.2f` | `mm` | 0.30 |

Ordering is fixed as above. Parameters absent from the certified generator MUST NOT appear in this block.

**Correction (v1.3.0)**: this block previously carried 12 lines. `Collar Height` and `Top Closure` were removed because `build()` never reads them, `Bore Diameter` moved from `bore_diameter`/35.0 to `bore_mm`/40.0, and `Dome Height` (20 mm) became `Dome Thickness` (1.6 mm) because the engine consumes `dome_mm` as a shell thickness. The certified block is exactly **10 lines**.

#### 3.5.3b Design Studio Parameter Lines (Not in Certified Engine)

Same alignment rule (values end at column 20, unit follows), rendered in a separate block:

| Display label | GH slider | JSON key (sidecar only) | Format | Unit | Default |
|---------------|-----------|-------------------------|--------|------|---------|
| `Wave Amplitude` | `Wave_Amplitude` | `wave_amplitude` | `.1f` | `mm` | 5.0 |
| `Wave Frequency` | `Wave_Frequency` | `wave_frequency` | `.1f` | — | 3.0 |
| `Interference` | `Interference_Density` | `interference_density` | `.2f` | — | 0.30 |
| `Helical Offset` | `Helical_Offset` | `helical_offset` | `.2f` | — | 0.00 |
| `Bulb Concealment` | `Bulb_Concealment` | `bulb_concealment` | `.1f` | `%` | 50.0 |
| `Mount Diameter` | `Mount_Diameter` | `mount_diameter` | `.1f` | `mm` | 40.0 |

`{STUDIO_MARKER}` resolves to one of:

| Marker | Condition |
|--------|-----------|
| `matches published` | `studio_fp` equals the studio fingerprint recorded at publish |
| `changed since publish` | `studio_fp` differs, or no publish has occurred |

These keys MUST NOT appear in the Design Intent Package. They are persisted only in the sidecar, so the package stays schema-identical to the certified engine.

#### 3.5.4 Parameter Fingerprints (Two)

Two fingerprints are computed independently. Only `certified_fp` may invalidate a published design.

**`certified_fp` — governs Status**

```
certified_fp = "sha256:" + sha256(
    canonical_json({
        height, diameter, twist_deg, wall_mm, gyroid_cell, sheet_mm,
        band_mm, bore_mm, dome_mm, voxel_mm
    } rounded to 4 decimal places)
).hexdigest()
```

**`studio_fp` — advisory only**

```
studio_fp = "sha256:" + sha256(
    canonical_json({
        wave_amplitude, wave_frequency, interference_density,
        helical_offset, bulb_concealment, mount_diameter
    } rounded to 4 decimal places)
).hexdigest()
```

Canonical JSON for both: keys sorted ascending, no whitespace, numbers rendered with 4 decimal places fixed. Rounding to 4 dp prevents sub-float noise from falsely returning a published design to DRAFT.

`product` is excluded from both fingerprints: it identifies the product family, not the design instance.

**Invariant**: a change confined to studio parameters changes `studio_fp` and leaves `certified_fp` untouched. Status therefore remains PUBLISHED, and only the studio block's advisory marker changes to `changed since publish`.

#### 3.5.5 Publish State Sidecar

Path: `C:/temp/lattice_lamp_publish_state.json`

```json
{
  "schema_version": "1.1",
  "product": "LatticeLamp",
  "status": "PUBLISHED",
  "published_at": "2026-10-30T13:05:00+11:00",
  "design_package": "C:/temp/lattice_lamp_params.json",
  "certified_fingerprint": "sha256:9f2c...",
  "preview_fingerprint": "sha256:9f2c...",
  "preview_grid": "38x38x38",
  "studio_fingerprint": "sha256:4ab1...",
  "published_studio_fingerprint": "sha256:4ab1...",
  "studio_parameters": {
    "wave_amplitude": 5.0,
    "wave_frequency": 3.0,
    "interference_density": 0.30,
    "helical_offset": 0.00,
    "bulb_concealment": 50.0,
    "mount_diameter": 40.0
  },
  "certified_engine": "task034_engine.py",
  "current_layer": "Lattice_Lamp_Certified"
}
```

The `studio_parameters` object is sidecar-only. It is **never** merged into `lattice_lamp_params.json`, whose key set must remain exactly `product` plus the 10 certified parameters (11 keys) so schema equality with the certified engine is preserved.

Written by Publish Design and by Preview Design (preview fields only). Read by the panel each solve. A missing or unparseable sidecar MUST degrade to `DRAFT` / `Not Published` / `Pending` without raising an error on the canvas.

#### 3.5.6 Inspection Fields

`inspect_workspace(layer=1)` MUST report the panel under `expected_features` as `current_design_panel`, with evidence:

```json
{
  "current_design_panel": {
    "detected": true,
    "evidence": {
      "panel_count": 1,
      "blocks_present": ["Status","Published","Design Package","Certified Product DNA","Design Studio Parameters","Preview Quality","Certified Geometry","Current Layer","Architecture"],
      "dna_line_count": 12,
      "studio_line_count": 6,
      "studio_block_labelled": true,
      "studio_affects_certified_geometry": false,
      "studio_marker": "matches published",
      "crossover_violations": [],
      "rendered_status": "PUBLISHED",
      "status_matches_sidecar": true,
      "read_only": true
    }
  }
}
```

`crossover_violations` lists any certified parameter rendered in the studio block, or any studio parameter rendered in the Certified Product DNA block; a non-empty list is a compliance failure. `studio_block_labelled` must be true and `studio_affects_certified_geometry` must be false.

---

## 4. Layer 2: Hermes → Python Certified Geometry Engine

### 4.1 Direct Execution Interface (NEW)

Python generator executes directly on Hermes host (not via RhinoClaw):

```python
# Hermes executes:
python3 -m packages.generator_certified.task034_run \
  --params C:/temp/lattice_lamp_params.json \
  --output C:/temp/lattice_lamp_certified.stl \
  --validate \
  --load-into-rhino
```

**Input**: Parameter JSON (from Layer 1 export)

**Output**: 
- Certified STL file
- Validation report JSON
- Topology metrics JSON
- **Loaded into Rhino "Lattice_Lamp_Certified" layer (feedback loop)**

### 4.2 Parameter JSON Schema (Exact Match Required)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["height", "diameter", "twist_deg", "wall_mm", "gyroid_cell", "sheet_mm", "band_mm", "bore_mm", "dome_mm", "voxel_mm"],
  "properties": {
    "height": {"type": "number", "minimum": 100, "maximum": 500, "default": 300},
    "diameter": {"type": "number", "minimum": 50, "maximum": 300, "default": 150},
    "twist_deg": {"type": "number", "minimum": 0, "maximum": 180, "default": 45},
    "wall_mm": {"type": "number", "minimum": 1, "maximum": 10, "default": 1.6},
    "gyroid_cell": {"type": "number", "minimum": 2, "maximum": 20, "default": 8.0},
    "sheet_mm": {"type": "number", "minimum": 0.5, "maximum": 5, "default": 1.2},
    "band_mm": {"type": "number", "minimum": 0, "maximum": 50, "default": 25.0},
    "bore_mm": {"type": "number", "minimum": 10, "maximum": 100, "default": 40.0},
    "dome_mm": {"type": "number", "minimum": 0.2, "maximum": 10.0, "default": 1.6},
    "voxel_mm": {"type": "number", "minimum": 0.1, "maximum": 1.0, "default": 0.30}
  }
}
```

### 4.3 NEW Tool: `load_certified_mesh_into_rhino` (Feedback Loop)

```json
{
  "name": "load_certified_mesh_into_rhino",
  "inputSchema": {
    "type": "object",
    "properties": {
      "stl_path": {"type": "string", "description": "Path to certified STL on pc2"},
      "layer": {"type": "string", "default": "Lattice_Lamp_Certified"}
    },
    "required": ["stl_path"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "loaded": true,
    "layer": "Lattice_Lamp_Certified",
    "object_id": "uuid",
    "vertex_count": 40171967,
    "face_count": 80515998,
    "load_time_ms": 1200
  }
}
```

**Purpose**: Completes the feedback loop — designer sees certified production geometry in Rhino viewport immediately after parameter export.

### 4.4 Python Generator Output Contract

```json
{
  "success": true,
  "data": {
    "stl_path": "C:/temp/lattice_lamp_certified.stl",
    "stl_size_bytes": 2123746242,
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

---

## 5. Layer 3: Manufacturing Pipeline Interface (TASK-044+)

### 5.1 Slicer Validation Inputs

| Input | Source |
|-------|--------|
| Certified STL | Layer 2 output |
| Printer Profile | Configurable (Bambu X1/P1/A1, Prusa, Orca) |
| Slice Settings | Layer height, nozzle, material |

### 5.2 Slicer Validation Outputs

```json
{
  "slicer": "OrcaSlicer",
  "import_success": true,
  "import_time_s": 12.3,
  "repair_warnings": [],
  "toolpaths_generated": true,
  "slice_time_s": 8.7,
  "volume_before": 1420789.3,
  "volume_after": 1420789.3,
  "layers": 1253,
  "print_time_estimate_h": 18.5,
  "material_estimate_g": 1120
}
```

---

## 6. I-05: Enhanced Unified Workspace Inspection (Updated)

### 6.1 Layer 1 Inspection (GH Design Studio)

**Expected Features:**
- `product_dna_sliders` — 12 sliders exposed with correct ranges
- `parameter_groups` — 4 logical groups present
- `preview_design` — Preview Design action functional, returns grid size
- `publish_design` — Publish Design action functional, writes Design Intent Package
- `current_design_panel` — single read-only panel, 9 blocks, 10 certified DNA lines plus a separately labelled 6-line studio block, no crossover violations, rendered status matches sidecar (see 3.5.6)

**Evidence Schema:**
```json
{
  "evidence": {
    "parameter_sliders": {
      "detected": true,
      "evidence": {
        "slider_count": 12,
        "exposed_parameters": ["Height", "Diameter", "Twist_Angle", "Wall_Thickness", "Gyroid_Cell_Size", "Gyroid_Thickness", "Band_Width", "Bore_Diameter", "Collar_Height", "Dome_Height", "Top_Closure_Ratio", "Voxel_Resolution"],
        "groups_present": ["Geometry", "Lattice", "Manufacturing", "Resolution"]
      }
    },
    "parameter_groups": {
      "detected": true,
      "evidence": {
        "group_count": 4,
        "groups": {"Geometry": 3, "Lattice": 3, "Manufacturing": 4, "Resolution": 2}
      }
    },
    "json_export": {
      "detected": true,
      "evidence": {
        "export_component_present": true,
        "output_path_configurable": true,
        "test_export_valid_json": true
      }
    }
  }
}
```

### 6.2 Layer 2 Inspection (Certified STL)

**Expected Features:**
- `topology_certified` — Watertight, manifold, single-body
- `volume_certified` — Within ±2% of reference
- `dimensions_certified` — Within ±0.5mm
- `features_certified` — Wall, gyroid, collar, dome all present
- **`rhino_feedback_loaded` — Certified mesh loaded into Rhino viewport**

**Evidence Schema:**
```json
{
  "evidence": {
    "topology_certified": {
      "detected": true,
      "evidence": {
        "watertight": true,
        "manifold": true,
        "single_body": true,
        "open_edges": 0,
        "non_manifold_edges": 0,
        "degenerate_faces": 0,
        "zero_area_faces": 0
      }
    },
    "volume_certified": {
      "detected": true,
      "evidence": {
        "volume_mm3": 1420789.3,
        "reference_mm3": 1423008,
        "error_pct": 0.16,
        "tolerance_pct": 2.0
      }
    },
    "dimensions_certified": {
      "detected": true,
      "evidence": {
        "height_mm": 300.0,
        "diameter_mm": 150.0,
        "height_error_mm": 0.01,
        "diameter_error_mm": 0.02
      }
    },
    "features_certified": {
      "detected": true,
      "evidence": {
        "wall_present": true,
        "gyroid_present": true,
        "collar_present": true,
        "dome_present": true,
        "sheet_thickness_mm": 1.204,
        "cell_size_mm": 8.01
      }
    },
    "rhino_feedback_loaded": {
      "detected": true,
      "evidence": {
        "layer": "Lattice_Lamp_Certified",
        "object_id": "uuid",
        "vertex_count": 40171967,
        "face_count": 80515998,
        "load_time_ms": 1200
      }
    }
  }
}
```

### 6.3 Combined Inspection Response (Layer="both")

```json
{
  "status": "success",
  "result": {
    "inspection_id": "uuid4-hex-32",
    "layers_validated": ["1", "2"],
    "layer_1": {
      "level": 3,
      "compliance_score": 100,
      "max_score": 100,
      "breakdown": {
        "parameter_sliders": {"score": 25, "max": 25},
        "parameter_groups": {"score": 25, "max": 25},
        "json_export": {"score": 25, "max": 25},
        "visual_preview": {"score": 25, "max": 25}
      },
      "evidence": { ... }
    },
    "layer_2": {
      "level": 3,
      "compliance_score": 100,
      "max_score": 100,
      "breakdown": {
        "topology_certified": {"score": 25, "max": 25},
        "volume_certified": {"score": 25, "max": 25},
        "dimensions_certified": {"score": 25, "max": 25},
        "features_certified": {"score": 25, "max": 25}
      },
      "evidence": { ... }
    },
    "unified_compliance_score": 100,
    "unified_max_score": 100,
    "artifacts": {
      "viewport_saved": "inspection/viewport.png",
      "canvas_saved": "inspection/canvas.png",
      "stl_validation_saved": "inspection/stl_validation.json",
      "report_saved": "inspection/inspection.md"
    }
  }
}
```

---

## 7. Compliance Scoring (Updated)

### 7.1 Layer 1 Scoring (GH Parameter UI)

| Feature | Weight | Detection → Score |
|---------|--------|-------------------|
| `parameter_sliders` | 25 | All 12 present with correct ranges → 25 |
| `parameter_groups` | 25 | 4 logical groups → 25 |
| `json_export` | 25 | Export works, valid JSON → 25 |
| `visual_preview` | 25 | GH geometry renders → 25 |

### 7.2 Layer 2 Scoring (Certified STL)

| Feature | Weight | Detection → Score |
|---------|--------|-------------------|
| `topology_certified` | 25 | Watertight + manifold + single-body → 25 |
| `volume_certified` | 25 | Within ±2% → 25 |
| `dimensions_certified` | 25 | Height/dia ±0.5mm, sheet/cell ±0.05mm → 25 |
| `features_certified` | 25 | All 4 features detected → 25 |

### 7.3 Unified Thresholds

| Overall Score | Status |
|---------------|--------|
| ≥ 90/100 | **CERTIFIED** |
| 75–89 | **CONDITIONAL** |
| < 75 | **NOT CERTIFIED** |

---

## 8. Error Contracts (Updated)

### 8.1 Layer 1 Errors (GH)

| Error Code | Cause | Action |
|------------|-------|--------|
| `DEFINITION_NOT_FOUND` | .gh file missing | Verify file_path |
| `INVALID_INPUTS` | Parameter out of range | Check bounds |
| `EXPORT_FAILED` | JSON write error | Check permissions/path |
| `INSPECTION_TIMEOUT` | Sub-calls exceeded timeout | Increase timeout |

### 8.2 Layer 2 Errors (Python Generator)

| Error Code | Cause | Action |
|------------|-------|--------|
| `PARAMS_FILE_MISSING` | JSON not found | Run Layer 1 export first |
| `PARAMS_SCHEMA_INVALID` | JSON keys/types mismatch | Fix GH export to match BASE dict |
| `GENERATION_FAILED` | Python exception | Check generator logs |
| `TOPOLOGY_FAILED` | Output not watertight/manifold | Adjust voxel_mm or params |
| `VOLUME_TOLERANCE_FAILED` | Volume error > 2% | Check params, voxel resolution |
| `RHINO_FEEDBACK_FAILED` | Cannot load STL into Rhino | Check RhinoClaw connection, STL path |

---

## 9. Version Compatibility

| GH Definition | RhinoClaw Plugin | Python Generator | Status |
|---------------|------------------|------------------|--------|
| `lattice_lamp_v1_FROZEN.gh` | 0.8.2+ | task034_engine.py v1.0 | Target |
| Future GH UI updates | 0.8.3+ (feedback loop) | task034_engine.py v1.x | Forward compatible |

---

## 10. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.3.0 | 2026-10-25 | Initial IDD for single-layer GH geometry |
| 1.0.0 | 2026-10-30 | Two-layer architecture: GH=Parameter UI, Python=Certified Geometry |
| 1.0.1 | 2026-10-30 | Added feedback loop: Certified mesh → Rhino viewport |

---

**End of IDD-010 v1.0.1**