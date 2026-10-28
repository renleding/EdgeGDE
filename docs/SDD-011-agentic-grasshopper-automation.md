# SDD-011: Agentic Grasshopper Automation — System Design

**Status**: PROPOSED
**Version**: 0.1.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-011, IDD-011, FRS-008, FRS-010

---

## 1. System Overview

This document describes the system design for overcoming RhinoClaw v0.8.2 catalog verification to achieve agentic automation between Hermes and Rhino/Grasshopper/VisualARQ/Lands Design.

### 1.1 Architecture Principle

**Catalog verification is a plugin-layer constraint** — we work around it at the application layer by providing multiple execution paths:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES (Director)                                                           │
│  - Mission Planning → Task Decomposition                                    │
│  - Parameter Optimization → Design Validation                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ MCP stdio (FastMCP)
┌─────────────────────────────────────────────────────────────────────────────┐
│ rhinoclaw-bridge (MCP Server)                                               │
│  - Dynamic command catalog (list_commands at startup)                       │
│  - 7 Core Tools + inspect_workspace                                         │
│  - Thin transport: MCP stdio ↔ TCP/JSON                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ TCP 1999 (Tailscale)
┌─────────────────────────────────────────────────────────────────────────────┐
│ RHINO PC (pc2: 100.110.105.101)                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ RhinoClaw v0.8.2 Plugin (TCP Server)                               │    │
│  │  - 128 TCP Commands                                                │    │
│  │  - Catalog verification (blocks build_gh_definition)              │    │
│  │  - Native GH: load_gh, run_gh, bake_gh (NO verification)          │    │
│  │  - Python 3: execute_python3_code (RhinoCommon, BYPASSES GH)      │    │
│  │  - VisualARQ: va_* commands                                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Rhino 8 + RhinoCode (Python 3)                                     │    │
│  │  - Rhino.Geometry (BRep, Mesh, Transform, Intersect)              │    │
│  │  - Grasshopper SDK (GH_Document, GH_ComponentServer)              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Design

### 2.1 rhinoclaw-bridge (MCP Server)

**Location**: `packages/rhinoclaw-bridge/src/rhinoclaw_bridge/`

| Module | Responsibility |
|--------|----------------|
| `server.py` | FastMCP stdio entry point, tool registration |
| `catalog.py` | Dynamic command discovery via `list_commands()` |
| `tools.py` | 7 Core tool definitions + `inspect_workspace` |
| `auth.py` | Token management (env var, rotation) |
| `client.py` | RhinoClawClient wrapper (TCP framing, retry) |

**Tool Registry** (7 core + 1 validation):

| Tool | Type | Verification Bypass |
|------|------|---------------------|
| `rhinoclaw_execute` | Generic | Pass-through to any TCP command |
| `scene_summary` | Convenience | Native, no catalog |
| `create_object` | Convenience | Native, no catalog |
| `batch_operations` | Convenience | Native, no catalog |
| `execute_python3_code` | Convenience | **BYPASSES GH entirely** |
| `run_grasshopper` | Convenience | Native GH, no catalog |
| `bake_grasshopper` | Convenience | Native GH, no catalog |
| `inspect_workspace` | Validation | Multi-modal audit |

**Key Design**: No hard-coded command mappings. All tools delegate to `client.execute(command_type, params)` with dynamic catalog validation.

---

### 2.2 RhinoClawClient (Python TCP Client)

**Location**: `packages/rhinoclaw-client/src/rhinoclaw_client/client.py`

**Protocol**: Length-prefixed JSON over TCP
```
[4 bytes: length][JSON payload]
```

**Request Format**:
```json
{
  "type": "command_name",
  "params": {...},
  "auth": "token",
  "request_id": "uuid"
}
```

**Response Format**:
```json
{
  "status": "ok|error",
  "result": {...},
  "error_code": "...",
  "message": "..."
}
```

**Features**:
- Automatic reconnection with exponential backoff
- Request/response correlation via `request_id`
- Preflight gating (`hello` → `ping` → `preflight`)
- Idempotency keys for mutation commands
- Command catalog caching (TTL: 5 min)

---

### 2.3 Execution Paths (Priority Order)

Per OpenClaw skill guidance — **always prefer highest-priority path**:

```
Priority 1: Typed Convenience Tools
  └─ scene_summary, create_object, run_grasshopper, bake_grasshopper
  └─ Best: typed args, validation, documentation

Priority 2: batch_operations
  └─ Atomic multi-step (create + transform + bake)
  └─ Single round-trip, server-side transaction

Priority 3: execute_python3_code (RhinoCommon)
  └─ Full Rhino.Geometry API
  └─ BYPASSES Grasshopper catalog verification entirely
  └─ Use for: TPMS Gyroid, Wave, Twist, Boolean, STL export

Priority 4: rhinoclaw_execute (Generic)
  └─ Any of 128 TCP commands
  └─ Use when no convenience tool exists

Priority 5: run_native_command (Legacy)
  └─ Rhino command line (e.g., "_Box")
  └─ Lowest: string parsing, no structured response
```

---

## 3. Agentic Workflow Phases

### Phase 1: Native GH Workflow (Week 1)

```
Hermes Mission → load_gh(file) → run_gh(params) → bake_gh(layer) 
                → execute_python3(export_stl) → inspect_workspace(level=3)
```

**Data Flow**:
1. **Manual**: Create `lattice_lamp_v1.gh` with 12 sliders + geometry
2. **Hermes**: Load definition (loads proxy catalog into memory)
3. **Hermes**: Run with parameter dict (12 values)
4. **Hermes**: Bake to named layer
5. **Hermes**: Export STL via RhinoCommon
6. **Hermes**: Validate with multi-modal inspection

**No catalog verification** — native commands use already-loaded proxy catalog.

---

### Phase 2: Template GH + Parameter Injection (Week 2)

**Pattern**: Master definition with all parametric controls pre-wired.

```python
# Master GH has 12 named inputs:
PARAMETERS = {
    "Height": 300.0,
    "Diameter": 150.0,
    "Twist_Angle": 45.0,
    "Wave_Amplitude": 5.0,
    "Wave_Frequency": 3.0,
    "Gyroid_Cell_Size": 8.0,
    "Gyroid_Thickness": 1.2,
    "Interference_Density": 0.3,
    "Helical_Offset": 0.0,
    "Top_Closure_Ratio": 0.8,
    "Bulb_Concealment": 50.0,
    "Mount_Diameter": 40.0,
    "Wall_Thickness": 2.0
}

# Hermes only injects values:
run_grasshopper(file_path="C:/temp/lattice_lamp_v1.gh", inputs=PARAMETERS)
```

**Benefits**:
- Zero structural changes → catalog verification always passes
- Full parametric control (12 dimensions)
- Fast iteration (< 5s per variant)

---

### Phase 3: RhinoCommon Geometry Engine (Weeks 3-4)

**Architecture**: Bypass Grasshopper entirely — pure RhinoCommon in `execute_python3_code`.

```python
# TPMS Gyroid
def create_gyroid(cell_size, thickness, bounds):
    # sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) < t
    # → Mesh via marching cubes
    pass

# Wave deformation
def apply_wave(brep, amplitude, frequency):
    # r = r0 + A*sin(f*θ) on surface
    pass

# Twist
def apply_twist(brep, angle, height):
    # Affine transform along Z
    pass

# Boolean
def boolean_union(breps):
    # Rhino.Geometry.Intersect.Intersection.BrepBrep
    pass
```

**Deliverable**: `rhino_geometry_engine.py` module with:
- `create_lamp_geometry(params)` → Brep
- `export_stl(brep, path)` → file
- `validate_mesh(brep)` → compliance dict

**Advantages**:
- No Grasshopper dependency
- No catalog verification
- Full programmatic control
- Faster (no GH solve overhead)
- Portable to any RhinoCode environment

---

### Phase 4: VisualARQ / Lands Design (Weeks 5-6)

**VisualARQ** (confirmed available via `va_*` commands):
- Same pattern: GH definitions with VisualARQ components
- Parameter injection via `run_gh`
- BIM documentation via `va_documentation_capabilities`

**Lands Design** (needs verification):
- Test `list_commands` for `ld_` prefix
- If available: terrain, plants, irrigation via same pattern

---

## 4. Data Models

### 4.1 Inspection Result (inspect_workspace)

```python
{
    "inspection_id": "uuid",
    "timestamp": "ISO8601",
    "scene": {
        "object_count": int,
        "layer_count": int,
        "layers": [{"name": str, "object_count": int, "visible": bool}]
    },
    "geometry": {
        "brep_count": int,
        "mesh_count": int,
        "total_volume": float,
        "total_area": float,
        "is_watertight": bool,
        "bbox": {"min": [x,y,z], "max": [x,y,z]}
    },
    "grasshopper": {
        "definition_count": int,
        "definitions": [{"name": str, "component_count": int, "solved": bool}],
        "outputs": {"param_name": "value"},
        "has_errors": bool
    },
    "viewport": "base64_png",
    "canvas": "base64_png",
    "validation": {
        "expected_features": [str],
        "compliance": {
            "feature_name": {
                "detected": bool,
                "evidence": {...},
                "score": int  # 0-25
            }
        },
        "compliance_score": int,  # 0-100
        "ready_for_bake": bool,
        "ready_for_export": bool
    }
}
```

### 4.2 Mission Manifest (Agentic Lamp Generation)

```json
{
  "mission_id": "lattice-lamp-v1-001",
  "objective": "Generate parametric lattice lamp with compliance ≥ 75",
  "autonomy_level": "high",
  "saga": {
    "compensation_strategy": "reverse_order",
    "partial_failure_policy": "compensate_all"
  },
  "tasks": [
    {"task_id": "preflight", "operation": "rhinoclaw_execute", "args": {"type": "preflight"}},
    {"task_id": "load_gh", "operation": "rhinoclaw_execute", "args": {"type": "load_grasshopper_definition", "params": {"file_path": "C:/temp/lattice_lamp_v1.gh"}}, "depends_on": ["preflight"]},
    {"task_id": "run_gh", "operation": "run_grasshopper", "args": {"file_path": "C:/temp/lattice_lamp_v1.gh", "inputs": {...12 params...}}, "depends_on": ["load_gh"]},
    {"task_id": "bake_gh", "operation": "bake_grasshopper", "args": {"file_path": "...", "layer": "Lattice_Lamp_Output"}, "depends_on": ["run_gh"]},
    {"task_id": "export_stl", "operation": "execute_python3_code", "args": {"code": "export_stl('Lattice_Lamp_Output', 'C:/temp/lamp.stl')"}, "depends_on": ["bake_gh"]},
    {"task_id": "inspect", "operation": "inspect_workspace", "args": {"expected_features": [...], "level": 3, "capture_images": true}, "depends_on": ["export_stl"]}
  ]
}
```

---

## 5. Error Handling & Recovery

| Error Type | Detection | Recovery |
|------------|-----------|----------|
| `AUTH_REQUIRED` | `preflight.data.auth != "ready"` | Sync token, restart Rhino |
| `CONNECTION_REFUSED` | TCP connect fails | Check pc2, Tailscale, `tcpstart` |
| `TIMEOUT` | Command > 30s | Increase timeout, simplify operation |
| `VERIFICATION_FAILED` | `build_gh_definition` error | Use native workflow (Phase 1-2) |
| `CATALOG_MISMATCH` | `catalog_contract` hash mismatch | Use pre-built GH template |
| `GEOMETRY_INVALID` | `inspect_workspace.validation.compliance_score < 75` | Adjust params, retry |

---

## 6. Performance Targets

| Operation | Target | Measurement |
|-----------|--------|-------------|
| `preflight` | < 500ms | TCP RTT + auth |
| `load_gh` | < 5s | GH document parse |
| `run_gh` (12 params) | < 10s | GH solve + compute |
| `bake_gh` | < 3s | Rhino object creation |
| `execute_python3_code` (STL export) | < 2s | Mesh write |
| `inspect_workspace` (Level 3) | < 8s | Multi-modal capture |
| **Full pipeline** | **< 30s** | End-to-end |

---

## 7. Security

| Control | Implementation |
|---------|----------------|
| Authentication | Token in env var (never logged), per-command |
| Transport | Tailscale encrypted mesh (no public exposure) |
| Authorization | Command allowlist in bridge (7 tools + generic) |
| Audit | Action journal (JSON-Lines) per request |
| Secrets | Bitwarden-managed `RHINOCLAW_AUTH_TOKEN` |

---

## 8. File Structure

```
packages/
├── rhinoclaw-client/
│   ├── pyproject.toml
│   └── src/rhinoclaw_client/
│       ├── __init__.py
│       ├── client.py          # TCP client (970 lines)
│       └── errors.py
├── rhinoclaw-bridge/
│   ├── pyproject.toml
│   └── src/rhinoclaw_bridge/
│       ├── __init__.py
│       ├── server.py          # FastMCP entry
│       ├── catalog.py         # Dynamic discovery
│       ├── tools.py           # 7 + 1 tool defs
│       ├── auth.py            # Token mgmt
│       └── client.py          # Wrapper
├── hermes-rhino-gh/
│   └── src/hermes_rhino_gh/
│       ├── gh_builder.py      # GH templates
│       ├── health.py          # Health monitor
│       └── rhino_geometry_engine.py  # Phase 3 (NEW)
└── op-schema/                 # Shared schemas
```

---

## 9. Testing Strategy

| Test Type | Tool | Coverage |
|-----------|------|----------|
| Unit | pytest | Client framing, auth, retry logic |
| Integration | pytest + testcontainers | Bridge ↔ Mock TCP server |
| E2E | Manual + scripted | Full pipeline on pc2 |
| Performance | Custom | Latency benchmarks |
| Compliance | `inspect_workspace` | Automated validation |

---

**End of SDD-011**