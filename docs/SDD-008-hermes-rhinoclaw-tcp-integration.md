# SDD-008: Hermes ↔ RhinoClaw TCP Integration — System Design Document

**Status**: DRAFT
**Version**: 0.2.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-008, IDD-008

---

## 1. System Overview

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

---

## 2. Component Architecture

### 2.1 Component Inventory

| Component | Type | Location | Responsibility |
|-----------|------|----------|----------------|
| **Hermes Gateway** | Process | Mac (host) | MCP orchestration, tool routing, governance |
| **rhinoclaw-bridge** | MCP Server (stdio) | Mac (host) | **Thin** stdio↔TCP, auth, framing, discovery |
| **rhinoclaw-client** | Python Library | Mac (host) | TCP client, framing, retry, generic `execute()` |
| **RhinoClaw Plugin** | Rhino .NET Plugin | pc2 (Rhino) | TCP server, command dispatch, Rhino API |
| **Rhino 8** | Application | pc2 (Rhino) | Geometry kernel, Grasshopper host |

### 2.2 Data Flow

```
Hermes Tool Call
      │
      ▼
MCP Gateway (validates tool schema)
      │
      ▼
rhinoclaw-bridge (MCP Server)
      │
      ├─► Generic: rhinoclaw_execute(command_type, params)
      │     └─► Validate command_type against catalog
      ├─► Convenience: create_object, batch_operations, etc.
      │     └─► Direct passthrough to client.execute()
      ├─► Build command frame {type, params, auth, request_id, idempotency_key}
      ├─► RhinoClawClient.execute() ──► TCP (length-prefixed JSON)
      │
      ▼ (Tailscale)
RhinoClaw Plugin (port 1999)
      │
      ├─► Parse frame, validate auth token
      ├─► Dispatch to command handler
      ├─► Execute on Rhino UI thread
      │
      ▼
Rhino 8 / Grasshopper / VisualARQ
      │
      ▼
Result → Response frame {status, result, request_id, operation_id, session_id}
      │
      ▼ (Tailscale)
RhinoClawClient.read_json_frame()
      │
      ▼
rhinoclaw-bridge → MCP response
      │
      ▼
Hermes (verification, logging)
```

---

## 3. rhinoclaw-bridge (MCP Server) Design — THIN

### 3.1 Process Model

```
┌─────────────────────────────────────────────────────────────────┐
│ rhinoclaw-bridge (stdio MCP Server) — < 500 lines              │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Command      │──►│ Passthrough  │──►│ RhinoClawClient      │  │
│  │ Registry     │   │ (no logic)   │   │ (TCP client)         │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                │                      │               │
│         ▼                ▼                      ▼               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Auth Manager │  │ Idempotency  │  │ Connection Pool      │  │
│  │ (token env)  │  │ Key Store    │  │ (persistent TCP)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Tool Registry — DYNAMIC DISCOVERY

**No hard-coded command mappings.** On startup:

```python
async def startup():
    client = RhinoClawClient(...)
    await client.connect()
    
    # 1. Preflight health check
    health = client.preflight()
    assert health["auth"] == "ready"
    
    # 2. Discover command catalog
    catalog = client.list_commands()  # 128 commands
    COMMAND_CATALOG = set(catalog["commands"])
    
    # 3. Register MCP tools
    register_generic_tool()      # rhinoclaw_execute
    register_convenience_tools() # 6 tools
```

**MCP Tools Exposed:**

| Tool | Type | Description |
|------|------|-------------|
| `rhinoclaw_execute` | **Generic** | Accepts any `command_type` from catalog + `params` |
| `scene_summary` | Convenience | Direct passthrough |
| `create_object` | Convenience | Direct passthrough |
| `batch_operations` | Convenience | Direct passthrough |
| `execute_python3_code` | Convenience | Direct passthrough |
| `run_grasshopper` | Convenience | Direct passthrough |
| `bake_grasshopper` | Convenience | Direct passthrough |

**No per-command translation logic.** All tools delegate to:
```python
result = await client.execute(command_type, params)
```

### 3.3 Adapter Configuration

```yaml
# Hermes MCP config entry
mcpServers:
  rhinoclaw:
    command: "uvx"
    args: ["rhinoclaw-bridge@latest"]
    env:
      RHINOCLAW_HOST: "100.110.105.101"
      RHINOCLAW_PORT: "1999"
      RHINOCLAW_AUTH_TOKEN: "${RHINOCLAW_AUTH_TOKEN}"  # from Bitwarden
      RHINOCLAW_TIMEOUT: "30"
      RHINOCLAW_DEBUG: "false"
```

---

## 4. rhinoclaw-client (Python Library) Design

### 4.1 Class Hierarchy (COMPLETED)

```
RhinoClawClient
├── Connection Management
│   ├── connect() / disconnect()
│   ├── __enter__ / __exit__ (context manager)
│   └── auto_reconnect logic
├── Framing Layer
│   ├── _encode_command() → length-prefixed JSON
│   ├── _read_json_frame() → exact frame read
│   └── _send_command() → send + recv + validate request_id
├── Command Execution
│   ├── execute(command_type, params) — **GENERIC ENTRY POINT**
│   ├── _execute() → error handling, result wrapping
│   └── _command_context() → retry, idempotency
└── Convenience Wrappers (6 methods)
    ├── scene_summary()
    ├── create_object()
    ├── batch_operations()
    ├── execute_python3_code()
    ├── run_grasshopper()
    ├── bake_grasshopper()
    └── (all delegate to execute())
```

**Key Design:** The 128 command wrappers are **internal implementation detail** for IDE autocomplete. The bridge uses only `execute()`.

### 4.2 Wire Protocol Implementation

**Framing** (`wire.py` compatible):
```python
# Request
[4-byte BE length][JSON: {"type": "...", "params": {}, "auth": "...", "request_id": "...", "idempotency_key": "..."}]

# Response 
[4-byte BE length][JSON: {"status": "success|error", "result": {...}, "request_id": "...", "operation_id": "...", "session_id": "..."}]
```

**Constants**:
- `MAX_FRAME_BYTES = 32 MB`
- `DEFAULT_TIMEOUT = 30s`
- `DEFAULT_CONNECT_TIMEOUT = 5s`

### 4.3 Idempotency & Retry Strategy

| Scenario | Behavior |
|----------|----------|
| Normal command | New `idempotency_key` per command |
| Socket timeout | Reconnect, retry with **same** `idempotency_key` |
| Connection reset | Reconnect, retry with **same** `idempotency_key` |
| Response `request_id` mismatch | Drop socket, raise `RequestIdMismatchError` |

---

## 5. RhinoClaw Plugin (Server Side) Design

### 5.1 Architecture (from source)

```
RhinoClaw Plugin (C#)
├── TcpServer (port 1999)
│   ├── Length-prefixed frame parser
│   ├── Auth middleware (RHINOCLAW_AUTH_TOKEN)
│   ├── Command dispatcher (type → handler)
│   └── UI thread marshaling (Rhino.InvokeOnUiThread)
├── Command Handlers (128)
│   ├── Geometry: CreateObject, ModifyObject, DeleteObject, ...
│   ├── Transform: Move, Rotate, Scale, Array, Mirror, ...
│   ├── Boolean: Union, Difference, Intersection
│   ├── Batch: BatchOperations (with undo record)
│   ├── Layers/Materials: CreateLayer, CreateMaterial, Assign...
│   ├── Selection: SceneSummary, FindNearby, GetObjectInfo, ...
│   ├── Grasshopper: InspectGH, RunGH, SetParameter, Bake, ...
│   ├── Scripting: ExecutePython3, ExecuteRhinoScript, RunNative
│   ├── Viewport: Capture, Zoom, SetView, Render
│   ├── VisualARQ: CreateWall, CreateSlab, CreatePlanView, ...
│   └── Document: GetInfo, Save, Open, Export
├── WebSocket Server (port 2000)
│   ├── Subscription model (subscribe → events)
│   └── Same auth + command protocol
└── Auth System
    ├── Token enforcement (constant-time compare)
    ├── Brute-force protection (5 failures / 60s → 15min block)
    └── Audit logging (%LOCALAPPDATA%\rhinoclaw\logs\auth_YYYYMMDD.jsonl)
```

### 5.2 Command Execution Pipeline

```
TCP Frame Received
       │
       ▼
Parse JSON + Validate Frame
       │
       ▼
Auth Middleware
       │  ├─ No token configured → allow
       │  ├─ Token configured + auth present + match → allow
       │  ├─ Token configured + auth missing → reject (AUTH_REQUIRED)
       │  └─ Token configured + auth mismatch → reject (INVALID_TOKEN)
       ▼
Idempotency Check (operation_id)
       │  ├─ New → execute, store result
       │  └─ Seen → return cached result
       ▼
UI Thread Dispatch (Rhino.InvokeOnUiThread)
       │  ├─ Timeout: 1-300s (clamped)
       │  └─ Cancellation via token
       ▼
Execute Command Handler
       │
       ▼
Build Response {status, result, request_id, operation_id, session_id}
       │
       ▼
Length-Prefix + Send
```

---

## 6. Deployment Topology

### 6.1 Network

| Segment | Protocol | Port | Auth |
|---------|----------|------|------|
| Hermes ↔ Bridge | stdio (MCP) | — | N/A |
| Bridge ↔ RhinoClaw | TCP | 1999 | Token |
| Bridge ↔ RhinoClaw | WebSocket | 2000 | Token |
| Tailscale | WireGuard | — | Machine auth |

### 6.2 Process Lifecycle

```
Startup:
1. pc2: Rhino launches → RhinoClaw plugin loads
2. pc2: ClawAutoStart OR user runs ClawTcpStart
3. pc2: Plugin binds 0.0.0.0:1999, 0.0.0.0:2000
4. Mac: Hermes starts → launches rhinoclaw-bridge (stdio)
5. Bridge: Connects to 100.110.105.101:1999
6. Bridge: Preflight (hello + ping) → ready
7. Bridge: list_commands() → populate catalog
8. Hermes: Tool calls route through bridge

Shutdown:
1. Hermes stops → kills rhinoclaw-bridge
2. Bridge: Disconnects TCP gracefully
3. pc2: Rhino closes → plugin stops listeners
```

---

## 7. Error Handling & Observability

### 7.1 Error Mapping

| RhinoClaw Error | Hermes Error | HTTP-like Code |
|-----------------|--------------|----------------|
| `AUTH_REQUIRED` | `AuthenticationError` | 401 |
| `AUTH_BLOCKED` | `RateLimitError` | 429 |
| `INVALID_TOKEN` | `AuthenticationError` | 401 |
| `UNKNOWN_COMMAND` | `NotFoundError` | 404 |
| `IDEMPOTENCY_CONFLICT` | `ConflictError` | 409 |
| Command timeout | `TimeoutError` | 504 |
| Connection failed | `ConnectionError` | 503 |
| Framing error | `ProtocolError` | 500 |

### 7.2 Logging

| Component | Log Location | Format |
|-----------|--------------|--------|
| Hermes Gateway | `.hermes/logs/missions/` | JSON-Lines |
| rhinoclaw-bridge | stdout/stderr (captured by Hermes) | Structured JSON |
| rhinoclaw-client | DEBUG logs (opt-in) | Console |
| RhinoClaw Plugin | `%LOCALAPPDATA%\rhinoclaw\logs\` | JSON-Lines (auth, commands) |

### 7.3 Metrics

| Metric | Source | Purpose |
|--------|--------|---------|
| Command latency (p50/p95/p99) | Bridge | Performance monitoring |
| Auth failure rate | Plugin | Security monitoring |
| Idempotency hit rate | Plugin | Deduplication effectiveness |
| TCP connection count | Plugin | Resource monitoring |
| Command success/failure | Both | Reliability tracking |

---

## 8. Security

### 8.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Token sniffing | Tailscale encryption (WireGuard) |
| Brute force | 5 failures/60s → 15min block |
| Replay attack | Idempotency keys (per-command) |
| Request smuggling | Length-prefixed framing (no delimiter ambiguity) |
| Command injection | Command allowlist in plugin |
| Arbitrary code execution | `execute_python3_code` requires explicit timeout, runs in Rhino process |

### 8.2 Token Management

- Generated once: `openssl rand -hex 32`
- Stored in Bitwarden (secret)
- Injected via env var at adapter startup
- Plugin reads at startup only (restart required for rotation)
- Never logged (redacted in all logs)

---

## 9. File Structure

```
EdgeGDE/
├── docs/
│   ├── FRS-008-hermes-rhinoclaw-tcp-integration.md
│   ├── IDD-008-hermes-rhinoclaw-tcp-integration.md
│   └── SDD-008-hermes-rhinoclaw-tcp-integration.md  ← THIS FILE
├── packages/
│   ├── rhinoclaw-client/
│   │   ├── pyproject.toml
│   │   └── src/rhinoclaw_client/
│   │       ├── __init__.py
│   │       ├── client.py      # RhinoClawClient
│   │       ├── errors.py      # Exception hierarchy
│   │       └── wire.py        # Framing utilities
│   └── rhinoclaw-bridge/      # Phase 2
│       ├── pyproject.toml
│       └── src/rhinoclaw_bridge/
│           ├── __init__.py
│           ├── server.py      # FastMCP server
│           ├── catalog.py     # Dynamic command catalog
│           ├── auth.py        # Token management
│           └── tools.py       # 7 MCP tool definitions
└── .hermes/
    └── config.yaml            # MCP server registration
```

---

## 10. Phased Implementation

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | RhinoClaw plugin installed, auth configured, Tailscale verified | ✅ DONE |
| 1.5 | `rhinoclaw-client` Python library (standalone) | ✅ DONE |
| 2 | `rhinoclaw-bridge` MCP server (stdio) | 🔄 NEXT |
| 3 | Hermes integration testing | ⏳ PENDING |
| 4 | Legacy cleanup (remove rhinomcp, rhinomcp-mod, etc.) | ⏳ PENDING |

---

## 11. Testing Strategy

### 11.1 Unit Tests (rhinoclaw-client)

```python
# tests/test_client.py
def test_hello_returns_metadata():
    with mock_socket(hello_response) as sock:
        client = RhinoClawClient(...)
        result = client.hello()
        assert result["plugin_version"] == "0.8.2.0"

def test_idempotency_retry_on_timeout():
    # First call times out, retry with same idempotency_key succeeds
    ...

def test_auth_error_mapping():
    with mock_socket(auth_required_response) as sock:
        client = RhinoClawClient(...)
        with pytest.raises(AuthError):
            client.create_object("POINT", {"x": 0, "y": 0, "z": 0})
```

### 11.2 Integration Tests (Bridge)

```python
# tests/test_bridge.py
def test_generic_tool_validates_against_catalog():
    bridge = RhinoClawBridge()
    await bridge.startup()  # populates catalog
    
    # Valid command
    result = await bridge.execute("rhinoclaw_execute", {
        "command_type": "create_object",
        "params": {"type": "POINT", "params": {"x": 1, "y": 2, "z": 3}}
    })
    assert result["success"]
    
    # Invalid command
    with pytest.raises(ValueError, match="Unknown command"):
        await bridge.execute("rhinoclaw_execute", {
            "command_type": "not_a_real_command",
            "params": {}
        })
```

### 11.3 End-to-End Tests

```python
# tests/test_e2e.py
def test_hermes_create_point():
    # Hermes → Bridge → TCP → RhinoClaw → Rhino
    result = hermes.call_tool("rhinoclaw_execute", {
        "command_type": "create_object",
        "params": {"type": "POINT", "params": {"x": 1, "y": 2, "z": 3}}
    })
    assert result["success"]
    assert "object_id" in result["data"]
```

---

## 12. Future Extensions

| Extension | Description |
|-----------|-------------|
| **WebSocket Adapter** | Real-time event subscription (object changes, selection) |
| **Multi-Rhino Support** | Route commands to specific Rhino instance by session_id |
| **Command Batching** | Bridge-level batching of multiple Hermes calls |
| **Result Caching** | Cache `scene_summary`, `list_commands` for N seconds |
| **Metrics Exporter** | Prometheus/OpenTelemetry export |
| **VisualARQ Skills** | High-level BIM workflows (wall from curve, slab from boundary) |

---

**End of SDD-008 v0.2.0**