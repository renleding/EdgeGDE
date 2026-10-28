# FRS-008: Hermes ↔ RhinoClaw Direct TCP Integration

**Status**: PROPOSED
**Version**: 0.2.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Supersedes**: FRS-007 (partial), ad-hoc RhinoMCP configurations

---

## 1. Objective

Replace the fragmented multi-MCP Rhino automation stack (rhinomcp, rhinomcp-mod, rhino-gh-mcp, RhinoClaw) with a **single authoritative TCP endpoint**: RhinoClaw on port 1999, accessed via a **thin Hermes MCP↔TCP bridge** that dynamically discovers capabilities from RhinoClaw itself.

---

## 2. Current State (Problem)

| Stack | Protocol | Port | Tools | Status |
|-------|----------|------|-------|--------|
| jingcheng-chen/rhinomcp | MCP stdio → TCP 4242 | 14242 | 70 (full GH) | Not installed |
| CDCD/rhinomcp-mod | MCP stdio → TCP 1999 | 11999 | 50 (engineering) | ❌ Removed |
| GenEnv/rhino-gh-mcp | MCP stdio → TCP 9876/9999 | 19876 | 15 GH + scenarios | ❌ Removed |
| Solid AI/RhinoClaw | **Raw TCP 1999** | — | **128 TCP + 104 MCP** | ✅ Running |

**Problems with old approach:**
- 4 incompatible protocols on one Rhino instance
- MCP version mismatches (Python client 0.4.1.1 ↔ plugin 0.5.1)
- uvx dependency hell, protocol translation layers
- No single source of truth for Rhino automation
- **Hard-coded command registries** requiring adapter updates for each RhinoClaw version

---

## 3. Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES (Mac)                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Hermes MCP Gateway                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────────┐  │   │
│  │  │ rhinoclaw-bridge (MCP Server, stdio) — THIN                │  │   │
│  │  │  - stdio ↔ TCP conversion                                   │  │   │
│  │  │  - Auth token injection                                     │  │   │
│  │  │  - Length-prefixed JSON framing                             │  │   │
│  │  │  - Dynamic command discovery (list_commands)                │  │   │
│  │  │  - Generic passthrough (rhinoclaw_execute)                  │  │   │
│  │  │  - 6 convenience tools                                      │  │   │
│  │  └─────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓ Tailscale (100.110.105.101:1999)      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ RHINO PC (pc2)                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ RhinoClaw Plugin (v0.8.2+) — SINGLE SOURCE OF TRUTH                │   │
│  │  - TCP Listener: 0.0.0.0:1999 (length-prefixed JSON)               │   │
│  │  - WebSocket: 0.0.0.0:2000 (optional)                              │   │
│  │  - Auth: RHINOCLAW_AUTH_TOKEN enforcement                          │   │
│  │  - 128 TCP commands + 104 MCP tools                                │   │
│  │  - Rhino 8 + Grasshopper + VisualARQ                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Single port:** 1999
**Single protocol:** TCP (length-prefixed JSON)
**Single auth:** Token-based (`RHINOCLAW_AUTH_TOKEN`)
**Single source of truth:** RhinoClaw plugin

---

## 4. Functional Requirements

### 4.1 RhinoClaw Stabilisation (Prerequisite — COMPLETE)

| ID | Requirement | Verification |
|----|-------------|--------------|
| FRS-008-01 | RhinoClaw plugin runs on pc2, listening on `0.0.0.0:1999` | `Get-NetTCPConnection -LocalPort 1999` shows Rhino PID |
| FRS-008-02 | `RHINOCLAW_AUTH_TOKEN` configured identically on client and plugin | `hello` returns `{"status": "ready", "auth_required": true}` |
| FRS-008-03 | `preflight()` returns `{"connected": true, "auth": "ready", "plugin_version": "0.8.2.0"}` | Automated check before every session |
| FRS-008-04 | `ping` returns `{"status": "success", "message": "Pong"}` | Liveness probe |

### 4.2 Tailscale Exposure

| ID | Requirement | Verification |
|----|-------------|--------------|
| FRS-008-05 | Port 1999 accessible via Tailscale IP `100.110.105.101:1999` | `nc -zv 100.110.105.101 1999` succeeds from Mac |
| FRS-008-06 | No legacy portproxies (4242, 14242, 19876, 11999) | Remove after validation |

### 4.3 Hermes Thin Bridge (MCP Server)

| ID | Requirement | Detail |
|----|-------------|--------|
| FRS-008-07 | Bridge accepts Hermes MCP tool calls via stdio | Standard MCP server (FastMCP) |
| FRS-008-08 | Bridge translates MCP ↔ RhinoClaw TCP frames | `{tool, args}` → `{type, params, auth, request_id, idempotency_key}` |
| FRS-008-09 | Bridge manages auth token automatically | Injects `RHINOCLAW_AUTH_TOKEN` on every request |
| FRS-008-10 | Bridge implements length-prefixed JSON framing | 4-byte BE length + UTF-8 JSON (per `wire.py`) |
| FRS-008-11 | Bridge runs `preflight()` on startup | Aborts if not `auth: "ready"` |
| FRS-008-12 | **Bridge discovers commands via `list_commands()` at startup** | No hard-coded command registry |
| FRS-008-13 | Bridge exposes generic `rhinoclaw_execute` tool | Accepts any command type from catalog |
| FRS-008-14 | Bridge exposes 6 convenience tools | `scene_summary`, `create_object`, `batch_operations`, `execute_python3_code`, `run_grasshopper`, `bake_grasshopper` |
| FRS-008-15 | All tools delegate to `RhinoClawClient.execute(command_type, params)` | No per-command business logic in adapter |
| FRS-008-16 | Bridge handles request/response correlation | `request_id` echo validation |
| FRS-008-17 | Bridge implements idempotency key retry | Same `idempotency_key` on reconnect-retry |

### 4.4 Tool Execution Priority (Mandatory Order)

| Priority | Method | Examples |
|----------|--------|----------|
| 1 | **Typed RhinoClaw tools** | `create_object`, `move`, `rotate`, `boolean_union`, `create_material`, `inspect_grasshopper_definition` |
| 2 | **batch_operations** | Multi-step with `on_error: "rollback" \| "abort"` |
| 3 | **execute_python3_code** | RhinoCommon via `script_exec.run_python` |
| 4 | **run_native_command** | Only when no typed API exists |

**SHALL NOT** skip priority levels. Each level MUST be attempted before falling back.

### 4.5 Grasshopper Strategy

| ID | Requirement | Detail |
|----|-------------|--------|
| FRS-008-18 | GH definitions inspected before execution | `inspect_grasshopper_definition(only_player_inputs: true)` |
| FRS-008-19 | GH run with discovered defaults | `run_grasshopper` with file's own defaults |
| FRS-008-20 | Parametric recipes via `build_and_bake_recipe` | Plugin-native recipes (box, list, custom) |
| FRS-008-21 | No legacy GH-MCP stack (`gh_build_graph`, etc.) | Remove rhino-gh-mcp, rhinomcp GH tools |

### 4.6 Long-Term Simplification

| ID | Requirement | Target |
|----|-------------|--------|
| FRS-008-22 | Disable `rhinomcp`, `rhinomcp-mod`, `RhinoGhMcpRhino` | After RhinoClaw validation |
| FRS-008-23 | Keep `MCP4Rhino` (optional) | Separate use case |
| FRS-008-24 | Keep `EnneadTab GH Bridge` (optional) | HTTP/SSE fallback |
| FRS-008-25 | Single automation stack, port, auth, protocol | 1999 / TCP / Token |

### 4.7 Dynamic Command Discovery

| ID | Requirement | Detail |
|----|-------------|--------|
| FRS-008-26 | **Adapter calls `list_commands()` on startup** | Populates available command catalog |
| FRS-008-27 | **`rhinoclaw_execute` validates against catalog** | Rejects unknown command types |
| FRS-008-28 | **Adapter auto-updates on RhinoClaw version change** | No adapter code changes needed |
| FRS-008-29 | **Catalog includes MCP-only note** | Distinguishes TCP vs MCP-only tools |

---

## 5. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| FRS-008-NF01 | Adapter latency overhead | < 50ms per call |
| FRS-008-NF02 | Preflight check time | < 200ms |
| FRS-008-NF03 | TCP connection reuse | Persistent connection with heartbeat |
| FRS-008-NF04 | Auth token rotation | Without Rhino restart (future) |
| FRS-008-NF05 | Error mapping | RhinoClaw error codes → Hermes structured errors |
| FRS-008-NF06 | Adapter code size | < 500 lines (thin bridge) |

---

## 6. Interface Specification

### 6.1 Bridge Input (Hermes → Bridge)

**Convenience tool:**
```json
{
  "tool": "create_object",
  "args": {
    "type": "BOX",
    "params": {"width": 5, "length": 3, "height": 2.5},
    "layer": "Walls"
  }
}
```

**Generic tool:**
```json
{
  "tool": "rhinoclaw_execute",
  "args": {
    "command_type": "va_create_wall",
    "params": {"profile": "Standard", "path": [{"x": 0, "y": 0, "z": 0}, {"x": 10, "y": 0, "z": 0}]}
  }
}
```

### 6.2 Bridge Output (Bridge → Hermes)

**Success:**
```json
{
  "success": true,
  "data": {
    "object_id": "guid",
    "type": "BOX",
    "layer": "Walls"
  }
}
```

**Error:**
```json
{
  "success": false,
  "error": "AUTH_REQUIRED",
  "message": "Token mismatch - restart Rhino after token change"
}
```

### 6.3 RhinoClaw TCP Wire Format (Bridge ↔ Plugin) — VERIFIED FROM SOURCE

**Protocol**: Single JSON frame over TCP, **length-prefixed** (4-byte big-endian)

**Request (client → plugin):**
```json
{
  "type": "create_object",
  "params": {"type": "BOX", "params": {"width": 5}, "layer": "Walls"},
  "request_id": "uuid4-hex-8",
  "idempotency_key": "uuid4-hex-32",
  "auth": "<RHINOCLAW_AUTH_TOKEN>",
  "timeout": 30
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | **YES** | Command name from catalog (e.g., `create_object`, `va_create_wall`) |
| `params` | **YES** | Command-specific parameters (object `{}`) |
| `request_id` | Optional | 8-char hex; echoed back for response matching |
| `idempotency_key` | Optional | 32-char hex; stable across reconnect-retry for deduplication |
| `auth` | **Conditional** | **Exact field name: `auth`** (top-level). Required when plugin has token. |
| `timeout` | Optional | Seconds; plugin clamps to [1, 300], defaults to 60s |

**Response (plugin → client):**
```json
{
  "status": "success",
  "result": {"object_id": "guid", ...},
  "request_id": "uuid4-hex-8",
  "operation_id": "uuid",
  "session_id": "uuid"
}
```

---

## 7. Implementation Phases

### Phase 1: RhinoClaw Hardening (pc2) — ✅ COMPLETE
- [x] Configure `RHINOCLAW_AUTH_TOKEN` (strong random)
- [x] Enable plugin auto-start (`ClawAutoStart`)
- [x] Verify `hello` / `ping` / `preflight` from Mac via Tailscale
- [x] Test typed tools: `create_object`, `batch_operations`
- [x] Test `execute_python3_code` (RhinoCommon)
- [x] Test GH: `inspect_grasshopper_definition`, `run_grasshopper`, `bake_grasshopper`

### Phase 1.5: RhinoClaw Client Library — ✅ COMPLETE
- [x] `rhinoclaw-client` Python package (`packages/rhinoclaw-client`)
- [x] `RhinoClawClient` with framing, auth, retry, idempotency
- [x] 128 command wrappers + generic `execute(command_type, params)`
- [x] Verified: hello, ping, list_commands, create_object, batch_operations, scene_summary, GH, Python

### Phase 2: Hermes Thin Bridge (MCP Server) — 🔄 NEXT
- [ ] Create `rhinoclaw-bridge` MCP server package
- [ ] FastMCP stdio server with 7 tools (1 generic + 6 convenience)
- [ ] Startup: `preflight()` → `list_commands()` → populate catalog
- [ ] `rhinoclaw_execute` generic tool with catalog validation
- [ ] Convenience tools: direct passthrough to `client.execute()`
- [ ] Auth injection, framing, request_id correlation, idempotency retry
- [ ] Unit tests with mock RhinoClaw server

### Phase 3: Integration & Validation
- [ ] Register bridge as Hermes MCP server
- [ ] End-to-end: Hermes → Bridge → TCP → RhinoClaw → Rhino
- [ ] GH workflow: generate definition → run → bake → export STL
- [ ] VisualARQ test (if licensed)
- [ ] Load test: 50 concurrent operations

### Phase 4: Cleanup
- [ ] Disable legacy plugins
- [ ] Remove legacy Hermes MCP configs
- [ ] Remove netsh portproxies
- [ ] Documentation update

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| RhinoClaw plugin instability on pc2 | Low | High | Phase 1 validation complete |
| Bridge development effort | Low | Medium | Thin design (< 500 lines) |
| Auth token management | Low | Medium | Auto-inject from env var |
| Command catalog changes | Low | Low | Dynamic discovery handles it |
| Tailscale IP change | Low | High | Use MagicDNS name |

---

## 9. Acceptance Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| AC-01 | `preflight()` returns `auth: "ready"` from Mac via Tailscale |
| AC-02 | Bridge startup calls `list_commands()` and populates catalog (128 commands) |
| AC-03 | `rhinoclaw_execute` accepts any catalog command, rejects unknown |
| AC-04 | 6 convenience tools work via direct passthrough |
| AC-05 | Hermes can create geometry via `create_object` |
| AC-06 | Hermes can execute multi-step `batch_operations` with rollback |
| AC-07 | Hermes can run GH definition via `run_grasshopper` + `bake_grasshopper` |
| AC-08 | Hermes can execute RhinoCommon via `execute_python3_code` |
| AC-09 | All legacy MCP ports (14242, 11999, 19876) removed |
| AC-10 | Single port (1999) serves all Rhino automation |

---

## 10. References

- RhinoClaw Skill: https://clawhub.ai/mcmuff86/skills/rhinoclaw
- RhinoClaw Source: https://github.com/McMuff86/rhinoclaw-release
- Wire Protocol: `rhinoclaw_server/src/rhinoclaw/transport/wire.py`
- FRS-007: Agentic Process Automation (architecture context)
- EdgeGDE AGENTS.md: Token efficiency, governance rules

---

## 11. Appendix: RhinoClaw Tool Inventory

**128 TCP Commands** (from `list_commands()`):
- Geometry: `create_object`, `create_objects`, `delete_object`, `modify_object`, `modify_objects`, `copy_object`, `mirror_object`, `move_object`, `rotate_object`, `scale_object`, `array_linear`, `array_polar`
- Boolean: `boolean_operation`
- Batch: `batch_operations`
- Layers: `create_layer`, `delete_layer`, `get_or_set_current_layer`
- Materials: `create_material`, `assign_material_to_layer`
- Selection: `scene_summary`, `find_nearby`, `find_objects`, `get_object_info`, `get_objects_info`, `get_relationships`, `get_selected_objects_info`, `select_objects`
- Curves: `offset_curve`, `fillet_curves`, `chamfer_curves`, `join_curves`, `explode_curve`
- Surfaces: `loft_curves`, `extrude_curve`, `revolve_curve`
- Solids: `mesh_from_brep`, `split_brep`, `trim_brep`
- Dimensions: `create_linear_dimension`, `create_angular_dimension`, `create_radial_dimension`
- Text: `create_text`, `create_text_dot`, `create_3d_text`, `create_leader`
- Blocks: `create_block`, `insert_block`, `explode_block`, `list_block_definitions`
- Groups: `create_group`, `ungroup`
- Grasshopper: `inspect_grasshopper_definition`, `run_grasshopper`, `set_grasshopper_parameter`, `set_grasshopper_parameters`, `bake_grasshopper`, `build_and_bake_gh`, `build_and_bake_recipe`, `build_gh_definition`, `get_grasshopper_canvas`, `get_grasshopper_outputs`, `solve_grasshopper`, `load_grasshopper_definition`, `unload_grasshopper_definition`, `list_grasshopper_definitions`, `show_grasshopper_definition`, `attach_grasshopper_definition`, `save_grasshopper_definition`, `capture_grasshopper_canvas`, `verify_gh_component_contract`
- Scripting: `execute_python3_code`, `execute_rhinoscript_python_code`, `run_native_command`, `get_script_capabilities`, `start_script_async`, `send_command_input`, `send_keystrokes`
- Viewport: `capture_viewport`, `zoom_extents`, `zoom_selected`, `set_view`, `orbit_camera`, `set_camera`, `render_view`, `add_light`, `set_render_settings`
- VisualARQ: `va_create_wall`, `va_create_slab`, `va_create_roof_from_curve`, `va_create_plan_view`, `va_create_section`, `va_create_section_style`, `va_create_section_view`, `va_get_plan_view`, `va_get_roof`, `va_get_section`, `va_get_section_view`, `va_list_plan_views`, `va_list_roofs`, `va_list_roof_styles`, `va_list_sections`, `va_list_section_views`, `va_documentation_capabilities`, `va_roof_capabilities`
- Document: `get_document_info`, `save_file`, `open_file`, `export_file`, `export_mesh`, `import_mesh`, `clear_logs`, `get_logs`, `get_command_history`, `get_current_prompt`, `log_thought`, `set_debug_mode`
- Utility: `hello`, `ping`, `list_commands`, `list_capabilities`, `find_nearby`, `is_inside`, `undo`, `redo`, `erp_invoke`, `erp_list_tools`, `generate_bill_of_materials`, `insert_library_part`

**104 MCP-only tools** (not in TCP catalog — per `mcp_only_note`):
- UI state, most `va_*/gh_*` contracts, etc. — must be called via MCP layer

---

**End of FRS-008 v0.2.0**