# IDD-011: Agentic Grasshopper Automation — Two-Layer Interface Contracts

**Status**: PROPOSED → **ARCHITECTURAL DECISION v1.0**
**Version**: 1.0.1
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-011, SDD-011, FRS-010, IDD-010, FRS-008, IDD-008
**Supersedes**: IDD-011 v0.1.0 (single-layer GH geometry automation)

---

## 1. Interface Overview (Two-Layer)

This document defines the wire protocols, API contracts, and data schemas for **two-layer** agentic Grasshopper automation between Hermes and RhinoClaw.

### 1.1 Interface Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 5: HERMES MISSION INTERFACE (Orchestration)                           │
│  - Mission Manifest (JSON) — Layer 1 → Layer 2 → Layer 3 pipeline          │
│  - Task DAG with verification criteria                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 4: MCP TOOL INTERFACE (Hermes ↔ rhinoclaw-bridge) — Layer 1          │
│  - 9 MCP Tools (JSON-RPC over stdio)                                        │
│  - GH Parameter UI tools + inspect_workspace(layer=1)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: BRIDGE INTERNAL INTERFACE                                          │
│  - RhinoClawClient.execute(command, params)                                 │
│  - Catalog validation, auth injection, retry                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: TCP WIRE PROTOCOL (rhinoclaw-bridge ↔ RhinoClaw plugin) — Layer 1 │
│  - Length-prefixed JSON over TCP 1999                                       │
│  - Auth token per request                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: PYTHON GENERATOR INTERFACE (Hermes Local) — Layer 2               │
│  - Direct Python execution (no TCP/MCP)                                     │
│  - CLI: task034_run.py --params --output --validate                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1: TCP Wire Protocol (Unchanged)

### 2.1 Framing

```
[4 bytes: uint32 big-endian payload length][UTF-8 JSON payload]
```

### 2.2 Request Schema

```json
{
  "type": "string",
  "params": {},
  "auth": "string",
  "request_id": "string (uuid4)",
  "timeout": "integer (optional, ms)"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | TCP command name (from `list_commands`) |
| `params` | Yes | Command-specific parameters |
| `auth` | Yes | `RHINOCLAW_AUTH_TOKEN` value |
| `request_id` | Yes | Client-generated UUID for correlation |
| `timeout` | No | Override default 30s timeout |

### 2.3 Response Schema

```json
{
  "status": "ok|error",
  "result": {},
  "error_code": "string",
  "message": "string",
  "request_id": "string",
  "server_time": "ISO8601"
}
```

| Field | Always Present | Description |
|-------|----------------|-------------|
| `status` | Yes | `ok` or `error` |
| `result` | On success | Command-specific result object |
| `error_code` | On error | Machine-readable error code |
| `message` | On error | Human-readable error message |
| `request_id` | Yes | Echoes request for correlation |
| `server_time` | Yes | Server timestamp |

### 2.4 Error Codes

| Code | HTTP Equivalent | Meaning | Recovery |
|------|-----------------|---------|----------|
| `AUTH_REQUIRED` | 401 | Missing or invalid token | Sync token, restart Rhino |
| `AUTH_BLOCKED` | 429 | Too many auth failures | Wait `blocked_until` |
| `UNKNOWN_COMMAND` | 404 | Command not in catalog | Call `list_commands` |
| `INVALID_PARAMS` | 400 | Param validation failed | Fix params |
| `VERIFICATION_FAILED` | 409 | Catalog contract mismatch | **Not applicable** (frozen GH) |
| `TIMEOUT` | 504 | Command exceeded timeout | Increase timeout |
| `INTERNAL_ERROR` | 500 | Plugin exception | Check Rhino log |

---

## 3. Layer 2: RhinoClawClient Interface (Updated)

### 3.1 Client Class

```python
class RhinoClawClient:
    def __init__(
        self,
        host: str = "100.110.105.101",
        port: int = 1999,
        auth_token: str = None,
        timeout: float = 30.0,
        max_retries: int = 3,
        retry_backoff: float = 1.0
    ):
        ...

    # Connection lifecycle
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
    def preflight(self) -> dict: ...
    
    # Core execution
    def execute(self, command_type: str, params: dict, timeout: float = None) -> dict: ...
    def execute_batch(self, operations: list[dict]) -> dict: ...
    
    # Convenience methods (typed) — Layer 1 GH
    def hello(self) -> dict: ...
    def ping(self) -> dict: ...
    def list_commands(self) -> dict: ...
    def scene_summary(self) -> dict: ...
    def create_object(self, obj_type: str, **params) -> dict: ...
    def load_grasshopper_definition(self, file_path: str, only_player_inputs: bool = True) -> dict: ...
    def run_grasshopper(self, file_path: str, inputs: dict) -> dict: ...
    def preview_design(self, file_path: str, resolution: str = "fast") -> dict: ...  # NEW
    def publish_design(self, file_path: str, output_path: str = "C:/temp/lattice_lamp_params.json") -> dict: ...  # NEW
    def execute_python3_code(self, code: str) -> dict: ...
    
    # Validation — Layer 1 GH UI
    def inspect_workspace(self, layer: int | str, expected_features: list[str] = None, level: int = 3, capture_images: bool = False, save_report: bool = False) -> dict: ...
```

### 3.2 Preflight Response (Unchanged)

```python
{
    "connected": True,
    "auth": "ready",           # "ready" | "missing_client_token" | "token_mismatch" | "blocked"
    "plugin_version": "0.8.2",
    "rhino_version": "8.0",
    "catalog": {
        "command_count": 128,
        "proxy_count": 2503,
        "catalog_sha256": "abc123..."
    },
    "next_action": "proceed"   # "proceed" | "set_token" | "wait" | "restart_rhino"
}
```

**Contract**: Every session MUST call `preflight()` first. Only proceed when `auth == "ready"`.

---

## 4. Layer 3: MCP Tool Interface (Updated — 9 Tools)

### 4.1 Tool Registry (rhinoclaw-bridge)

```python
TOOLS = [
    # Generic passthrough
    {
        "name": "rhinoclaw_execute",
        "description": "Execute any RhinoClaw TCP command",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "TCP command name from list_commands"},
                "params": {"type": "object", "description": "Command parameters"},
                "timeout": {"type": "integer", "default": 30000}
            },
            "required": ["command"]
        }
    },
    
    # Convenience: Scene
    {
        "name": "scene_summary",
        "description": "Get scene summary (objects, layers, bounds)",
        "inputSchema": {"type": "object", "properties": {}}
    },
    
    # Convenience: Object creation
    {
        "name": "create_object",
        "description": "Create a Rhino object",
        "inputSchema": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["POINT", "LINE", "BOX", "SPHERE", "CYLINDER", "CONE", "PLANE"]},
                "parameters": {"type": "object"}
            },
            "required": ["type"]
        }
    },
    
    # Convenience: Batch
    {
        "name": "batch_operations",
        "description": "Execute multiple operations atomically",
        "inputSchema": {
            "type": "object",
            "properties": {
                "operations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "command": {"type": "string"},
                            "params": {"type": "object"}
                        },
                        "required": ["command"]
                    }
                }
            },
            "required": ["operations"]
        }
    },
    
    # Convenience: Python 3 (RhinoCommon)
    {
        "name": "execute_python3_code",
        "description": "Execute Python 3 code in RhinoCode (bypasses Grasshopper)",
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python 3 code with Rhino.Geometry API access"},
                "timeout": {"type": "integer", "default": 60000}
            },
            "required": ["code"]
        }
    },
    
    # Convenience: Native Grasshopper (Layer 1 — Design Studio)
        {
            "name": "load_grasshopper_definition",
            "description": "Load Grasshopper Design Studio, return parameter schema",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path to .gh file on pc2"},
                    "only_player_inputs": {"type": "boolean", "default": true}
                },
                "required": ["file_path"]
            }
        },
    
        {
            "name": "run_grasshopper",
            "description": "Run Grasshopper definition with parameters (visual preview only — use preview_design for fast feedback)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path to .gh file on pc2"},
                    "inputs": {"type": "object", "description": "Parameter name → value mapping (12 Product DNA params)"},
                    "timeout": {"type": "integer", "default": 60000}
                },
                "required": ["file_path", "inputs"]
            }
        },
    
        {
            "name": "preview_design",
            "description": "Fast visual preview in GH Design Studio (designer-friendly resolution, no certification)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path to .gh file on pc2"},
                    "resolution": {"type": "string", "enum": ["fast", "medium", "high"], "default": "fast", "description": "fast=38³ grid, medium=50³, high=64³"}
                },
                "required": ["file_path"]
            }
        },
    
        {
            "name": "publish_design",
            "description": "Publish Design — exports Design Intent Package (JSON) and triggers Layer 2 Certified Geometry Engine",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Path to .gh file on pc2"},
                    "output_path": {"type": "string", "default": "C:/temp/lattice_lamp_params.json"}
                },
                "required": ["file_path"]
            }
        },
    
    # Validation: Multi-modal inspection (Layer 1 + Layer 2)
    {
        "name": "inspect_workspace",
        "description": "Unified multimodal workspace inspection with design validation (supports layer=1, 2, or 'both')",
        "inputSchema": {
            "type": "object",
            "properties": {
                "layer": {"type": ["integer", "string"], "enum": [1, 2, "both"], "description": "1=GH UI, 2=Python STL, 'both'=combined"},
                "expected_features": {"type": "array", "items": {"type": "string"}},
                "level": {"type": "integer", "enum": [1, 2, 3], "default": 3, "description": "1=Lightweight, 2=Visual, 3=Engineering Audit"},
                "capture_images": {"type": "boolean", "default": True},
                "save_report": {"type": "boolean", "default": False}
            },
            "required": ["layer"]
        }
    }
]
```

### 4.2 MCP Tool Response Format (Unchanged)

All tools return:
```json
{
  "success": true,
  "result": {},
  "error": null,
  "meta": {
    "command": "tcp_command_name",
    "duration_ms": 123,
    "request_id": "uuid"
  }
}
```

On error:
```json
{
  "success": false,
  "result": null,
  "error": {"code": "ERROR_CODE", "message": "Human readable"},
  "meta": {...}
}
```

---

## 5. Layer 4: Mission Manifest Interface (Two-Layer Pipeline)

### 5.1 Mission Schema (Unchanged)

```json
{
  "mission_id": "string",
  "objective": "string",
  "autonomy_level": "low|medium|high",
  "saga": {
    "compensation_strategy": "reverse_order|parallel|manual",
    "partial_failure_policy": "compensate_all|stop|continue"
  },
  "tasks": [
    {
      "task_id": "string",
      "operation": "string",           // MCP tool name
      "tool": "droid",
      "args": {},                      // Tool input schema
      "scope": ["relative/path"],
      "depends_on": ["task_id"],
      "idempotent": true,
      "verification_criteria": ["string"],
      "compensate": {
        "operation": "string",
        "args": {},
        "condition": "on_failure|on_reject|always"
      }
    }
  ],
  "constraints": {
    "allow_shell": false,
    "allowed_paths": ["./"],
    "forbidden_paths": [".git/**", "**/.env"],
    "max_retries": 3
  }
}
```

### 5.2 Layer 1 Mission: GH Design Studio Validation

```json
{
  "mission_id": "lattice-lamp-layer1-001",
  "objective": "Validate GH Design Studio: Product DNA sliders, Preview Design, Publish Design, Current Design panel",
  "autonomy_level": "high",
  "saga": {"compensation_strategy": "reverse_order", "partial_failure_policy": "compensate_all"},
  "tasks": [
    {"task_id": "preflight", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "preflight", "params": {}}, "depends_on": [], "verification_criteria": ["auth == 'ready'"]},
    {"task_id": "load_def", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "load_grasshopper_definition", "params": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh"}}, "depends_on": ["preflight"], "verification_criteria": ["definition_count > 0", "parameter_count == 12"]},
    {"task_id": "verify_ui", "operation": "inspect_workspace", "tool": "droid", "args": {"layer": 1, "expected_features": ["product_dna_sliders", "parameter_groups", "preview_design", "publish_design", "current_design_panel"], "level": 3, "capture_images": true, "save_report": true}, "depends_on": ["load_def"], "verification_criteria": ["layer_1.compliance_score == 100"]},
    {"task_id": "test_preview", "operation": "preview_design", "tool": "droid", "args": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh", "resolution": "fast"}, "depends_on": ["load_def"], "verification_criteria": ["previewed == true", "grid_size == '38³'", "solve_time_ms < 5000"]},
    {"task_id": "test_publish", "operation": "publish_design", "tool": "droid", "args": {"file_path": "C:/temp/lattice_lamp_v1_FROZEN.gh", "output_path": "C:/temp/lattice_lamp_params.json"}, "depends_on": ["test_preview"], "verification_criteria": ["published == true", "design_intent.product == 'LatticeLamp'", "design_intent.keys == 12", "triggered_layer2_mission == 'lattice-lamp-layer2-001'"]}
  ],
  "constraints": {"allow_shell": false, "allowed_paths": [".", "packages/"], "forbidden_paths": [".git/**", "**/.env"], "max_retries": 2}
}
```

### 5.3 Layer 2 Mission: Certified Geometry Generation

```json
{
  "mission_id": "lattice-lamp-layer2-001",
  "objective": "Generate certified geometry from Design Intent Package and load into Rhino for designer preview",
  "autonomy_level": "high",
  "saga": {"compensation_strategy": "reverse_order", "partial_failure_policy": "compensate_all"},
  "tasks": [
    {"task_id": "generate", "operation": "shell", "tool": "droid", "args": {"command": "python3 -m packages.generator_certified.task034_run --params C:/temp/lattice_lamp_params.json --output C:/temp/lattice_lamp_certified.3dm --validate --load-into-rhino"}, "depends_on": [], "verification_criteria": ["exit_code == 0", "file_exists == 'C:/temp/lattice_lamp_certified.3dm'"]},
    {"task_id": "validate_topo", "operation": "shell", "tool": "droid", "args": {"command": "python3 -c \\\"import trimesh; m=trimesh.load('C:/temp/lattice_lamp_certified.3dm', force='mesh'); assert m.is_watertight; assert len(m.split(only_watertight=False))==1; print('TOPOLOGY_PASS')\\\"\"}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]},
    {"task_id": "validate_vol", "operation": "shell", "tool": "droid", "args": {"command": "python3 -c \\\"import trimesh; m=trimesh.load('C:/temp/lattice_lamp_certified.3dm', force='mesh'); ref=1423008; err=abs(m.volume-ref)/ref*100; assert err < 2.0; print(f'VOLUME_PASS: {err:.2f}%')\\\"\"}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]},
    {"task_id": "validate_dims", "operation": "shell", "tool": "droid", "args": {"command": "python3 -c \\\"import trimesh; m=trimesh.load('C:/temp/lattice_lamp_certified.3dm', force='mesh'); bbox=m.bounds; h=bbox[1][2]-bbox[0][2]; d=max(bbox[1][0]-bbox[0][0], bbox[1][1]-bbox[0][1]); assert abs(h-300)<0.5 and abs(d-150)<0.5; print(f'DIMS_PASS: h={h:.2f}, d={d:.2f}')\\\"\"}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]},
    {"task_id": "feedback_loop", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "execute_python3_code", "params": {"code": "import Rhino; import Rhino.Geometry as rg; import scriptcontext as sc; m=rg.Mesh(); m.Import('C:/temp/lattice_lamp_certified.3dm'); attrs=sc.doc.CreateDefaultAttributes(); attrs.Name='Certified_Lamp'; attrs.LayerIndex=sc.doc.Layers.Add('Lattice_Lamp_Certified', True); sc.doc.Objects.AddMesh(m, attrs); sc.doc.Views.Redraw(); print('FEEDBACK_LOOP_COMPLETE')"}}, "depends_on": ["generate"], "verification_criteria": ["exit_code == 0"]}
  ],
  "constraints": {"allow_shell": true, "allowed_paths": [".", "packages/", "/tmp", "C:/temp"], "forbidden_paths": [".git/**", "**/.env"], "max_retries": 1}
}
```

### 5.4 Layer 3 Mission: Manufacturing Pipeline (TASK-044+)

*Defined in TASK-044 specification — uses Layer 2 certified STL as input*

---

## 6. Data Schemas (Updated for Two-Layer)

### 6.1 Inspection Result Schema — Layer 1 (GH UI)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["inspection_id", "timestamp", "layer", "scene", "grasshopper", "canvas", "validation"],
  "properties": {
    "inspection_id": {"type": "string", "format": "uuid"},
    "timestamp": {"type": "string", "format": "date-time"},
    "layer": {"type": "integer", "const": 1},
    "scene": {
      "type": "object",
      "required": ["object_count", "layer_count", "layers"],
      "properties": {
        "object_count": {"type": "integer"},
        "layer_count": {"type": "integer"},
        "layers": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "object_count": {"type": "integer"}, "visible": {"type": "boolean"}}}}
      }
    },
    "grasshopper": {
      "type": "object",
      "required": ["definition_count", "definitions", "outputs", "has_errors"],
      "properties": {
        "definition_count": {"type": "integer"},
        "definitions": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "component_count": {"type": "integer"}, "solved": {"type": "boolean"}}}},
        "outputs": {"type": "object"},
        "has_errors": {"type": "boolean"}
      }
    },
    "canvas": {"type": "string", "description": "Base64 PNG"},
    "validation": {
      "type": "object",
      "required": ["expected_features", "compliance", "compliance_score", "ready_for_export"],
      "properties": {
        "expected_features": {"type": "array", "items": {"type": "string"}},
        "compliance": {
          "type": "object",
          "patternProperties": {
            "": {"type": "object", "required": ["detected", "evidence", "score"], "properties": {"detected": {"type": "boolean"}, "evidence": {"type": "object"}, "score": {"type": "integer", "minimum": 0, "maximum": 25}}}
          }
        },
        "compliance_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "ready_for_export": {"type": "boolean"}
      }
    }
  }
}
```

### 6.2 Inspection Result Schema — Layer 2 (Certified STL)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["inspection_id", "timestamp", "layer", "geometry", "validation"],
  "properties": {
    "inspection_id": {"type": "string", "format": "uuid"},
    "timestamp": {"type": "string", "format": "date-time"},
    "layer": {"type": "integer", "const": 2},
    "geometry": {
      "type": "object",
      "required": ["stl_path", "vertices", "faces", "volume_mm3", "watertight", "manifold", "single_body", "bbox"],
      "properties": {
        "stl_path": {"type": "string"},
        "vertices": {"type": "integer"},
        "faces": {"type": "integer"},
        "volume_mm3": {"type": "number"},
        "watertight": {"type": "boolean"},
        "manifold": {"type": "boolean"},
        "single_body": {"type": "boolean"},
        "bbox": {"type": "object", "properties": {"min": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "max": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}}}
      }
    },
    "validation": {
      "type": "object",
      "required": ["expected_features", "compliance", "compliance_score", "certified"],
      "properties": {
        "expected_features": {"type": "array", "items": {"type": "string"}},
        "compliance": {
          "type": "object",
          "patternProperties": {
            "": {"type": "object", "required": ["detected", "evidence", "score"], "properties": {"detected": {"type": "boolean"}, "evidence": {"type": "object"}, "score": {"type": "integer", "minimum": 0, "maximum": 25}}}
          }
        },
        "compliance_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "certified": {"type": "boolean"}
      }
    }
  }
}
```

### 6.3 Inspection Result Schema — Combined (Layer="both")

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["inspection_id", "timestamp", "layers_validated", "layer_1", "layer_2", "unified_compliance_score", "unified_max_score"],
  "properties": {
    "inspection_id": {"type": "string", "format": "uuid"},
    "timestamp": {"type": "string", "format": "date-time"},
    "layers_validated": {"type": "array", "items": {"type": "string", "enum": ["1", "2"]}},
    "layer_1": {"$ref": "#/definitions/layer1_schema"},
    "layer_2": {"$ref": "#/definitions/layer2_schema"},
    "unified_compliance_score": {"type": "integer", "minimum": 0, "maximum": 100},
    "unified_max_score": {"type": "integer", "const": 100},
    "artifacts": {
      "type": "object",
      "properties": {
        "viewport_saved": {"type": "string"},
        "canvas_saved": {"type": "string"},
        "stl_validation_saved": {"type": "string"},
        "report_saved": {"type": "string"}
      }
    }
  },
  "definitions": {
    "layer1_schema": { ... },
    "layer2_schema": { ... }
  }
}
```

### 6.4 GH Parameter Schema (FRS-010 v1.0 Compliant — Aligned with Python BASE Dict)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["Height", "Diameter", "Twist_Angle", "Wall_Thickness", "Gyroid_Cell_Size", "Gyroid_Thickness", "Band_Width", "Bore_Diameter", "Collar_Height", "Dome_Height", "Top_Closure_Ratio", "Voxel_Resolution"],
  "properties": {
    "Height": {"type": "number", "minimum": 100, "maximum": 500, "default": 300},
    "Diameter": {"type": "number", "minimum": 50, "maximum": 300, "default": 150},
    "Twist_Angle": {"type": "number", "minimum": 0, "maximum": 180, "default": 45},
    "Wall_Thickness": {"type": "number", "minimum": 1, "maximum": 10, "default": 1.6},
    "Gyroid_Cell_Size": {"type": "number", "minimum": 2, "maximum": 20, "default": 8.0},
    "Gyroid_Thickness": {"type": "number", "minimum": 0.5, "maximum": 5, "default": 1.2},
    "Band_Width": {"type": "number", "minimum": 0, "maximum": 50, "default": 25.0},
    "Bore_Diameter": {"type": "number", "minimum": 10, "maximum": 100, "default": 35.0},
    "Collar_Height": {"type": "number", "minimum": 0, "maximum": 100, "default": 30.0},
    "Dome_Height": {"type": "number", "minimum": 0, "maximum": 50, "default": 20.0},
    "Top_Closure_Ratio": {"type": "number", "minimum": 0, "maximum": 1.0, "default": 0.8},
    "Voxel_Resolution": {"type": "number", "minimum": 0.2, "maximum": 1.0, "default": 0.30}
  }
}
```

### 6.5 Design Intent Package Schema (Python Generator Input — Exact Match Required)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["product", "height", "diameter", "twist_deg", "wall_mm", "gyroid_cell", "sheet_mm", "band_mm", "bore_diameter", "collar_height", "dome_height", "top_closure_ratio", "voxel_mm"],
  "properties": {
    "product": {"type": "string", "const": "LatticeLamp"},
    "height": {"type": "number", "minimum": 100, "maximum": 500, "default": 300},
    "diameter": {"type": "number", "minimum": 50, "maximum": 300, "default": 150},
    "twist_deg": {"type": "number", "minimum": 0, "maximum": 180, "default": 45},
    "wall_mm": {"type": "number", "minimum": 1, "maximum": 10, "default": 1.6},
    "gyroid_cell": {"type": "number", "minimum": 2, "maximum": 20, "default": 8.0},
    "sheet_mm": {"type": "number", "minimum": 0.5, "maximum": 5, "default": 1.2},
    "band_mm": {"type": "number", "minimum": 0, "maximum": 50, "default": 25.0},
    "bore_diameter": {"type": "number", "minimum": 10, "maximum": 100, "default": 35.0},
    "collar_height": {"type": "number", "minimum": 0, "maximum": 100, "default": 30.0},
    "dome_height": {"type": "number", "minimum": 0, "maximum": 50, "default": 20.0},
    "top_closure_ratio": {"type": "number", "minimum": 0, "maximum": 1.0, "default": 0.8},
    "voxel_mm": {"type": "number", "minimum": 0.2, "maximum": 1.0, "default": 0.30}
  }
}
```

---

## 7. VisualARQ / Lands Design Commands (Unchanged Pattern)

### 7.1 VisualARQ (Confirmed)

| Command Prefix | Example Commands | Description |
|----------------|------------------|-------------|
| `va_` | `va_create_wall`, `va_create_slab`, `va_create_stair`, `va_create_section`, `va_documentation_capabilities` | BIM elements |

**Interface**: Same native workflow — create definition with `va_*` components, inject params via `run_gh`, export JSON, Python generator handles geometry.

### 7.2 Lands Design (To Verify)

| Command Prefix | Expected Commands | Description |
|----------------|-------------------|-------------|
| `ld_` | `ld_create_terrain`, `ld_add_plant`, `ld_irrigation`, `ld_zoning` | Landscape architecture |

**Action**: Run `list_commands` and filter for `ld_` prefix. If available, same pattern applies.

---

## 8. Python Certified Generator Interface (Layer 2 — Replaces RhinoCommon Engine)

### 8.1 Module: `packages/generator-certified/task034_run.py`

```python
# CLI Entry Point
# Usage: python3 -m packages.generator_certified.task034_run --params <json> --output <stl> --validate

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--params", required=True, help="Path to parameter JSON")
    parser.add_argument("--output", required=True, help="Output STL path")
    parser.add_argument("--validate", action="store_true", help="Run validation and print report")
    args = parser.parse_args()
    
    # Load and validate params
    with open(args.params) as f:
        params = json.load(f)
    
    # Validate schema matches BASE dict exactly
    validate_params_schema(params)
    
    # Generate geometry
    from task034_engine import build_field, extract_mesh
    field = build_field(params)
    mesh = extract_mesh(field, params)
    
    # Export STL
    mesh.export(args.output, file_type='stl')
    
    # Validate if requested
    if args.validate:
        from task034_reports import validate_topology, validate_volume, validate_dimensions, validate_features
        topo = validate_topology(mesh)
        vol = validate_volume(mesh, reference=1423008)
        dims = validate_dimensions(mesh, params)
        feats = validate_features(mesh, params)
        
        report = {
            "topology": topo,
            "volume": vol,
            "dimensions": dims,
            "features": feats,
            "certified": all([topo["pass"], vol["pass"], dims["pass"], feats["pass"]])
        }
        print(json.dumps(report, indent=2))
        
        if not report["certified"]:
            sys.exit(1)
```

### 8.2 Core Engine: `task034_engine.py` (Authoritative)

```python
# Single source of truth for certified geometry
# SDF composition + marching cubes extraction

def build_field(params: dict) -> callable:
    """Return SDF field function f(x,y,z) -> signed distance."""
    # ... implementation as per SDD-010 Section 4.2 ...

def extract_mesh(field: callable, params: dict) -> trimesh.Trimesh:
    """Marching cubes at voxel_mm resolution with 90M voxel budget."""
    # ... implementation as per SDD-010 Section 4.3 ...

# Voxel budget enforcement
MAX_VOXELS = 90_000_000
```

### 8.3 Validation Reports: `task034_reports.py`

```python
def validate_topology(mesh: trimesh.Trimesh) -> dict:
    return {
        "pass": mesh.is_watertight and len(mesh.split(only_watertight=False)) == 1,
        "watertight": mesh.is_watertight,
        "components": len(mesh.split(only_watertight=False)),
        "non_manifold_edges": count_non_manifold_edges(mesh),
        "open_edges": count_open_edges(mesh)
    }

def validate_volume(mesh: trimesh.Trimesh, reference: float) -> dict:
    error_pct = abs(mesh.volume - reference) / reference * 100
    return {
        "pass": error_pct <= 2.0,
        "volume_mm3": mesh.volume,
        "reference_mm3": reference,
        "error_pct": error_pct
    }

def validate_dimensions(mesh: trimesh.Trimesh, params: dict) -> dict:
    bbox = mesh.bounds
    h = bbox[1][2] - bbox[0][2]
    d = max(bbox[1][0] - bbox[0][0], bbox[1][1] - bbox[0][1])
    return {
        "pass": abs(h - params["height"]) <= 0.5 and abs(d - params["diameter"]) <= 0.5,
        "height_mm": h,
        "diameter_mm": d,
        "height_error_mm": abs(h - params["height"]),
        "diameter_error_mm": abs(d - params["diameter"])
    }

def validate_features(mesh: trimesh.Trimesh, params: dict) -> dict:
    # Feature detection logic (wall, gyroid, collar, dome)
    return {
        "pass": all([wall, gyroid, collar, dome]),
        "wall_present": wall,
        "gyroid_present": gyroid,
        "collar_present": collar,
        "dome_present": dome,
        "sheet_thickness_mm": sheet,
        "cell_size_mm": cell
    }
```

---

## 9. Catalog Verification Contract (Resolved — Not Needed)

**Status**: **RESOLVED** by two-layer architecture

The catalog verification that blocked `build_gh_definition` is **no longer applicable** because:
1. GH definition is **frozen** (`lattice_lamp_v1_FROZEN.gh`) — created manually once
2. Only **parameter values change** via `run_grasshopper(inputs={...})` — no structural changes
3. No programmatic GH definition creation needed

**No plugin fix required** for current workflow.

---

## 10. Version Compatibility Matrix (Updated)

| Component | Version | Compatible | Layer |
|-----------|---------|------------|-------|
| RhinoClaw Plugin | 0.8.2 | ✅ Current | 1 |
| RhinoClaw Plugin | 0.8.3+ | 🔄 Target (inspect_workspace layer param) | 1 |
| rhinoclaw-bridge | 0.2.0 | ✅ Current (9 tools) | 1 |
| rhinoclaw-client | 0.2.0 | ✅ Current | 1 |
| Rhino | 8.x | ✅ | 1 |
| Grasshopper | 1.0+ | ✅ | 1 |
| Python Generator | task034_engine.py v1.0 | ✅ Certified | 2 |
| VisualARQ | 3.x | ✅ (via va_*) | 1 |
| Lands Design | 5.x | ❓ Unknown | 1 |

---

## 11. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-10-25 | Initial IDD for agentic GH automation (single-layer) |
| 1.0.0 | 2026-10-30 | Two-layer architecture: GH=Design Studio, Python=Certified Geometry Engine |
| 1.0.1 | 2026-10-30 | Preview Design / Publish Design terminology; Design Intent Package; Product DNA sliders |

---

**End of IDD-011 v1.0.1**