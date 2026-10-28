# IDD-011: Agentic Grasshopper Automation — Interface Contracts

**Status**: PROPOSED
**Version**: 0.1.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-011, SDD-011, FRS-008, IDD-008

---

## 1. Interface Overview

This document defines the wire protocols, API contracts, and data schemas for agentic Grasshopper automation between Hermes and RhinoClaw.

### 1.1 Interface Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 4: HERMES MISSION INTERFACE                                           │
│  - Mission Manifest (JSON)                                                  │
│  - Task DAG with verification criteria                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: MCP TOOL INTERFACE (Hermes ↔ rhinoclaw-bridge)                     │
│  - 8 MCP Tools (JSON-RPC over stdio)                                        │
│  - Tool schemas (JSON Schema)                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: BRIDGE INTERNAL INTERFACE                                          │
│  - RhinoClawClient.execute(command, params)                                 │
│  - Catalog validation, auth injection, retry                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: TCP WIRE PROTOCOL (rhinoclaw-bridge ↔ RhinoClaw plugin)            │
│  - Length-prefixed JSON over TCP 1999                                       │
│  - Auth token per request                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1: TCP Wire Protocol

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
| `VERIFICATION_FAILED` | 409 | Catalog contract mismatch | Use native workflow |
| `TIMEOUT` | 504 | Command exceeded timeout | Increase timeout |
| `INTERNAL_ERROR` | 500 | Plugin exception | Check Rhino log |

---

## 3. Layer 2: RhinoClawClient Interface

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
    
    # Convenience methods (typed)
    def hello(self) -> dict: ...
    def ping(self) -> dict: ...
    def list_commands(self) -> dict: ...
    def scene_summary(self) -> dict: ...
    def create_object(self, obj_type: str, **params) -> dict: ...
    def run_grasshopper(self, file_path: str, inputs: dict) -> dict: ...
    def bake_grasshopper(self, file_path: str, layer: str) -> dict: ...
    def execute_python3_code(self, code: str) -> dict: ...
    
    # Validation
    def inspect_workspace(self, expected_features: list[str] = None, level: int = 2, capture_images: bool = False) -> dict: ...
```

### 3.2 Preflight Response

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

## 4. Layer 3: MCP Tool Interface

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
    
    # Convenience: Native Grasshopper
    {
        "name": "run_grasshopper",
        "description": "Load and run Grasshopper definition with parameters",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "Path to .gh file on pc2"},
                "inputs": {"type": "object", "description": "Parameter name → value mapping"},
                "timeout": {"type": "integer", "default": 60000}
            },
            "required": ["file_path"]
        }
    },
    
    {
        "name": "bake_grasshopper",
        "description": "Bake Grasshopper output to Rhino layer",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "layer": {"type": "string", "description": "Target layer name"},
                "group": {"type": "boolean", "default": True},
                "timeout": {"type": "integer", "default": 30000}
            },
            "required": ["file_path", "layer"]
        }
    },
    
    # Validation: Multi-modal inspection
    {
        "name": "inspect_workspace",
        "description": "Unified multimodal workspace inspection with design validation",
        "inputSchema": {
            "type": "object",
            "properties": {
                "expected_features": {"type": "array", "items": {"type": "string"}},
                "level": {"type": "integer", "enum": [1, 2, 3], "default": 2, "description": "1=Lightweight, 2=Visual, 3=Engineering Audit"},
                "capture_images": {"type": "boolean", "default": True},
                "save_report": {"type": "boolean", "default": False}
            }
        }
    }
]
```

### 4.2 MCP Tool Response Format

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

## 5. Layer 4: Mission Manifest Interface

### 5.1 Mission Schema

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

### 5.2 Lamp Generation Mission Example

```json
{
  "mission_id": "lattice-lamp-v1-001",
  "objective": "Generate parametric lattice lamp with 12 exposed controls",
  "autonomy_level": "high",
  "saga": {"compensation_strategy": "reverse_order", "partial_failure_policy": "compensate_all"},
  "tasks": [
    {"task_id": "preflight", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "preflight", "params": {}}, "depends_on": [], "verification_criteria": ["auth == 'ready'"]},
    {"task_id": "load_def", "operation": "rhinoclaw_execute", "tool": "droid", "args": {"command": "load_grasshopper_definition", "params": {"file_path": "C:/temp/lattice_lamp_v1.gh"}}, "depends_on": ["preflight"], "verification_criteria": ["definition_count > 0"]},
    {"task_id": "run_params", "operation": "run_grasshopper", "tool": "droid", "args": {"file_path": "C:/temp/lattice_lamp_v1.gh", "inputs": {"Height": 300, "Diameter": 150, "Twist_Angle": 45, "Wave_Amplitude": 5, "Wave_Frequency": 3, "Gyroid_Cell_Size": 8, "Gyroid_Thickness": 1.2, "Interference_Density": 0.3, "Helical_Offset": 0, "Top_Closure_Ratio": 0.8, "Bulb_Concealment": 50, "Mount_Diameter": 40, "Wall_Thickness": 2}}, "depends_on": ["load_def"], "verification_criteria": ["has_outputs == true"]},
    {"task_id": "bake", "operation": "bake_grasshopper", "tool": "droid", "args": {"file_path": "C:/temp/lattice_lamp_v1.gh", "layer": "Lattice_Lamp_Output"}, "depends_on": ["run_params"], "verification_criteria": ["layer_exists == 'Lattice_Lamp_Output'"]},
    {"task_id": "export", "operation": "execute_python3_code", "tool": "droid", "args": {"code": "export_stl_layer('Lattice_Lamp_Output', 'C:/temp/lamp.stl')"}, "depends_on": ["bake"], "verification_criteria": ["file_exists == 'C:/temp/lamp.stl'"]},
    {"task_id": "validate", "operation": "inspect_workspace", "tool": "droid", "args": {"expected_features": ["gyroid_lattice", "parametric_controls", "mounting_collar", "printable_mesh", "twist_deformation", "wave_deformation", "top_closure", "bulb_concealment"], "level": 3, "capture_images": true, "save_report": true}, "depends_on": ["export"], "verification_criteria": ["compliance_score >= 75"]}
  ],
  "constraints": {"allow_shell": false, "allowed_paths": [".", "packages/"], "forbidden_paths": [".git/**", "**/.env"], "max_retries": 2}
}
```

---

## 6. Data Schemas

### 6.1 Inspection Result Schema (inspect_workspace)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["inspection_id", "timestamp", "scene", "geometry", "grasshopper", "viewport", "canvas", "validation"],
  "properties": {
    "inspection_id": {"type": "string", "format": "uuid"},
    "timestamp": {"type": "string", "format": "date-time"},
    "scene": {
      "type": "object",
      "required": ["object_count", "layer_count", "layers"],
      "properties": {
        "object_count": {"type": "integer"},
        "layer_count": {"type": "integer"},
        "layers": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "object_count": {"type": "integer"}, "visible": {"type": "boolean"}}}}
      }
    },
    "geometry": {
      "type": "object",
      "required": ["brep_count", "mesh_count", "total_volume", "total_area", "is_watertight", "bbox"],
      "properties": {
        "brep_count": {"type": "integer"},
        "mesh_count": {"type": "integer"},
        "total_volume": {"type": "number"},
        "total_area": {"type": "number"},
        "is_watertight": {"type": "boolean"},
        "bbox": {"type": "object", "properties": {"min": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "max": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}}}
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
    "viewport": {"type": "string", "description": "Base64 PNG"},
    "canvas": {"type": "string", "description": "Base64 PNG"},
    "validation": {
      "type": "object",
      "required": ["expected_features", "compliance", "compliance_score", "ready_for_bake", "ready_for_export"],
      "properties": {
        "expected_features": {"type": "array", "items": {"type": "string"}},
        "compliance": {
          "type": "object",
          "patternProperties": {
            "": {"type": "object", "required": ["detected", "evidence", "score"], "properties": {"detected": {"type": "boolean"}, "evidence": {"type": "object"}, "score": {"type": "integer", "minimum": 0, "maximum": 25}}}
          }
        },
        "compliance_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "ready_for_bake": {"type": "boolean"},
        "ready_for_export": {"type": "boolean"}
      }
    }
  }
}
```

### 6.2 GH Parameter Schema (FRS-010 Compliant)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["Height", "Diameter", "Twist_Angle", "Wave_Amplitude", "Wave_Frequency", "Gyroid_Cell_Size", "Gyroid_Thickness", "Interference_Density", "Helical_Offset", "Top_Closure_Ratio", "Bulb_Concealment", "Mount_Diameter", "Wall_Thickness"],
  "properties": {
    "Height": {"type": "number", "minimum": 100, "maximum": 500, "default": 300},
    "Diameter": {"type": "number", "minimum": 80, "maximum": 300, "default": 150},
    "Twist_Angle": {"type": "number", "minimum": 0, "maximum": 180, "default": 45},
    "Wave_Amplitude": {"type": "number", "minimum": 0, "maximum": 20, "default": 5},
    "Wave_Frequency": {"type": "number", "minimum": 1, "maximum": 10, "default": 3},
    "Gyroid_Cell_Size": {"type": "number", "minimum": 4, "maximum": 20, "default": 8},
    "Gyroid_Thickness": {"type": "number", "minimum": 0.5, "maximum": 5, "default": 1.2},
    "Interference_Density": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.3},
    "Helical_Offset": {"type": "number", "minimum": 0, "maximum": 360, "default": 0},
    "Top_Closure_Ratio": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.8},
    "Bulb_Concealment": {"type": "number", "minimum": 0, "maximum": 100, "default": 50},
    "Mount_Diameter": {"type": "number", "minimum": 20, "maximum": 80, "default": 40},
    "Wall_Thickness": {"type": "number", "minimum": 1, "maximum": 10, "default": 2}
  }
}
```

---

## 7. VisualARQ / Lands Design Commands

### 7.1 VisualARQ (Confirmed)

| Command Prefix | Example Commands | Description |
|----------------|------------------|-------------|
| `va_` | `va_create_wall`, `va_create_slab`, `va_create_stair`, `va_create_section`, `va_documentation_capabilities` | BIM elements |

**Interface**: Same as native GH — create definition with `va_*` components, inject params via `run_gh`.

### 7.2 Lands Design (To Verify)

| Command Prefix | Expected Commands | Description |
|----------------|-------------------|-------------|
| `ld_` | `ld_create_terrain`, `ld_add_plant`, `ld_irrigation`, `ld_zoning` | Landscape architecture |

**Action**: Run `list_commands` and filter for `ld_` prefix. If available, same pattern applies.

---

## 8. RhinoCommon Geometry Engine Interface (Phase 3)

### 8.1 Module: `rhino_geometry_engine.py`

```python
# Public API
def create_lamp_geometry(params: dict) -> Rhino.Geometry.Brep:
    """Create complete lamp geometry from 13 parameters."""
    ...

def export_stl(brep: Rhino.Geometry.Brep, path: str) -> dict:
    """Export Brep as STL, return {success, path, size_bytes}."""
    ...

def validate_mesh(brep: Rhino.Geometry.Brep) -> dict:
    """Validate mesh for 3D printing."""
    return {
        "is_watertight": bool,
        "volume": float,
        "area": float,
        "non_manifold_edges": int,
        "duplicate_faces": int,
        "compliance_score": int  # 0-100
    }

# Low-level primitives
def create_gyroid_mesh(cell_size: float, thickness: float, bounds: Rhino.Geometry.Box) -> Rhino.Geometry.Mesh:
    ...

def apply_wave_deformation(brep: Rhino.Geometry.Brep, amplitude: float, frequency: float) -> Rhino.Geometry.Brep:
    ...

def apply_twist(brep: Rhino.Geometry.Brep, angle_deg: float, height: float) -> Rhino.Geometry.Brep:
    ...

def boolean_union(breps: list[Rhino.Geometry.Brep]) -> Rhino.Geometry.Brep:
    ...

def create_mounting_collar(diameter: float, height: float, thickness: float) -> Rhino.Geometry.Brep:
    ...
```

### 8.2 Execution via MCP

```python
# Hermes calls:
execute_python3_code(code="""
from rhino_geometry_engine import create_lamp_geometry, export_stl, validate_mesh

params = {...}  # 13 params from mission
brep = create_lamp_geometry(params)
result = export_stl(brep, "C:/temp/lamp.stl")
validation = validate_mesh(brep)
print(json.dumps({"export": result, "validation": validation}))
""")
```

---

## 9. Catalog Verification Contract (Blocked)

### 9.1 Current State (v0.8.2)

```json
// Required by build_gh_definition - BLOCKED
{
  "catalog_contract": {
    "schema_version": "1.0",
    "component_count": 2503,
    "proxy_guid_sha256": "string",
    "component_contract_sha256": "string", 
    "ports_skipped_guids": ["guid1", "guid2"],
    "component_contracts": [
      {
        "guid": "guid",
        "name": "string",
        "inputs": [{"name": "string", "type": "string", "access": "item|list|tree"}],
        "outputs": [{"name": "string", "type": "string", "access": "item|list|tree"}]
      }
    ]
  }
}
```

### 9.2 Required Plugin Fix (v0.8.3+)

| Feature | Description |
|---------|-------------|
| `generate_catalog_contract` | New TCP command to auto-generate valid contract |
| `unsafe_mode` | Config flag to bypass verification |
| Contract caching | Persist contract across restarts |
| Build-time validation | Verify recipes at plugin build |

---

## 10. Version Compatibility Matrix

| Component | Version | Compatible |
|-----------|---------|------------|
| RhinoClaw Plugin | 0.8.2 | ✅ Current |
| RhinoClaw Plugin | 0.8.3+ | 🔄 Target (catalog fix) |
| rhinoclaw-bridge | 0.1.0 | ✅ Current |
| rhinoclaw-client | 0.1.0 | ✅ Current |
| Rhino | 8.x | ✅ |
| Grasshopper | 1.0+ | ✅ |
| VisualARQ | 3.x | ✅ (via va_*) |
| Lands Design | 5.x | ❓ Unknown |

---

## 11. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-10-25 | Initial IDD for agentic GH automation |

---

**End of IDD-011**