# IDD-008: Hermes ↔ RhinoClaw TCP Integration — Interface Design Document

**Status**: DRAFT
**Version**: 0.2.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-008, SDD-008

---

## 1. Purpose

This document defines the **exact interfaces** between all components in the Hermes ↔ RhinoClaw integration. It specifies wire protocols, data schemas, API contracts, and error formats — the "how" components communicate.

---

## 2. Interface Inventory

| Interface | Participants | Protocol | Direction |
|-----------|--------------|----------|-----------|
| **I-01** | Hermes ↔ rhinoclaw-bridge | MCP stdio | Bidirectional |
| **I-02** | rhinoclaw-bridge ↔ RhinoClaw Plugin | TCP 1999 | Bidirectional |
| **I-03** | rhinoclaw-bridge ↔ RhinoClaw Plugin | WebSocket 2000 | Bidirectional (optional) |
| **I-04** | rhinoclaw-client ↔ RhinoClaw Plugin | TCP 1999 | Bidirectional |
| **I-05** | Hermes ↔ Hermes Gateway | Internal | N/A |

---

## 3. I-01: Hermes ↔ rhinoclaw-bridge (MCP stdio)

### 3.1 Transport

- **Protocol**: MCP (Model Context Protocol) over stdio
- **Encoding**: JSON-RPC 2.0
- **Process**: `uvx rhinoclaw-bridge@latest` (FastMCP server)

### 3.2 Tool Definitions

#### 3.2.1 Generic Tool: `rhinoclaw_execute`

**Input Schema:**
```json
{
  "name": "rhinoclaw_execute",
  "description": "Execute any RhinoClaw TCP command by type. Use for commands not covered by convenience tools.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "command_type": {
        "type": "string",
        "description": "RhinoClaw command type from catalog (e.g., 'va_create_wall', 'create_object')"
      },
      "params": {
        "type": "object",
        "description": "Command-specific parameters",
        "additionalProperties": true
      }
    },
    "required": ["command_type", "params"]
  }
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "success": {"type": "boolean"},
    "data": {"type": "object"},
    "error": {"type": "string"},
    "error_code": {"type": "string"}
  }
}
```

#### 3.2.2 Convenience Tool: `scene_summary`

```json
{
  "name": "scene_summary",
  "description": "Get complete scene summary: object counts, layers, materials, bounding box",
  "inputSchema": {"type": "object", "properties": {}}
}
```

#### 3.2.3 Convenience Tool: `create_object`

```json
{
  "name": "create_object",
  "description": "Create a single geometric object",
  "inputSchema": {
    "type": "object",
    "properties": {
      "type": {"type": "string", "enum": ["POINT", "LINE", "CIRCLE", "BOX", "SPHERE", "CYLINDER", "CONE", "POLYLINE", "RECTANGLE", "POLYGON", "ELLIPSE", "ARC", "NURBS"]},
      "params": {"type": "object", "additionalProperties": true},
      "layer": {"type": "string"},
      "name": {"type": "string"}
    },
    "required": ["type", "params"]
  }
}
```

#### 3.2.4 Convenience Tool: `batch_operations`

```json
{
  "name": "batch_operations",
  "description": "Execute multiple operations atomically with rollback/abort on error",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": {"type": "string"},
      "steps": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "tool": {"type": "string"},
            "args": {"type": "object", "additionalProperties": true}
          },
          "required": ["tool", "args"]
        }
      },
      "on_error": {"type": "string", "enum": ["rollback", "abort"], "default": "rollback"}
    },
    "required": ["name", "steps"]
  }
}
```

#### 3.2.5 Convenience Tool: `execute_python3_code`

```json
{
  "name": "execute_python3_code",
  "description": "Execute Python 3 (CPython) code in Rhino for RhinoCommon access",
  "inputSchema": {
    "type": "object",
    "properties": {
      "code": {"type": "string"},
      "timeout": {"type": "number", "default": 120, "maximum": 300}
    },
    "required": ["code"]
  }
}
```

#### 3.2.6 Convenience Tool: `run_grasshopper`

```json
{
  "name": "run_grasshopper",
  "description": "Run a Grasshopper definition with optional inputs",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_path": {"type": "string"},
      "inputs": {"type": "object", "additionalProperties": true}
    },
    "required": ["file_path"]
  }
}
```

#### 3.2.7 Convenience Tool: `bake_grasshopper`

```json
{
  "name": "bake_grasshopper",
  "description": "Bake Grasshopper geometry to Rhino document",
  "inputSchema": {
    "type": "object",
    "properties": {
      "file_path": {"type": "string"},
      "layer": {"type": "string"}
    },
    "required": ["file_path"]
  }
}
```

---

## 4. I-02: rhinoclaw-bridge ↔ RhinoClaw Plugin (TCP 1999)

### 4.1 Transport

- **Protocol**: TCP, length-prefixed JSON frames
- **Host**: `100.110.105.101` (Tailscale)
- **Port**: `1999`
- **Framing**: 4-byte big-endian length prefix + UTF-8 JSON payload

### 4.2 Request Frame (Client → Plugin)

**Structure:**
```
[4-byte BE length][JSON payload]
```

**JSON Payload:**
```json
{
  "type": "command_name",
  "params": {},
  "request_id": "8-char-hex",
  "idempotency_key": "32-char-hex",
  "auth": "token-string",
  "timeout": 30
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | **YES** | Command name from catalog (e.g., `create_object`, `va_create_wall`) |
| `params` | object | **YES** | Command-specific parameters |
| `request_id` | string | Optional | 8-char hex; echoed in response for correlation |
| `idempotency_key` | string | Optional | 32-char hex; enables deduplication on retry |
| `auth` | string | **Conditional** | Token from `RHINOCLAW_AUTH_TOKEN`; required when plugin has token |
| `timeout` | number | Optional | Seconds; clamped to [1, 300], default 60 |

### 4.3 Response Frame (Plugin → Client)

**Structure:**
```
[4-byte BE length][JSON payload]
```

**JSON Payload:**
```json
{
  "status": "success|error",
  "result": {},
  "request_id": "8-char-hex",
  "operation_id": "uuid",
  "session_id": "uuid"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"success"` or `"error"` |
| `result` | object | Command-specific result (success) or error details (error) |
| `request_id` | string | Echoed from request |
| `operation_id` | string | Server-side operation UUID |
| `session_id` | string | Server session UUID |

#### 4.3.1 Success Response

```json
{
  "status": "success",
  "result": {
    "object_id": "guid",
    "type": "POINT",
    "layer": "Default"
  },
  "request_id": "abc12345",
  "operation_id": "123e4567-e89b-12d3-a456-426614174000",
  "session_id": "00ef7f2c92be404fa0d7ed2a488a310a"
}
```

#### 4.3.2 Error Response

```json
{
  "status": "error",
  "result": {
    "error_code": "AUTH_REQUIRED",
    "message": "missing_token"
  },
  "request_id": "abc12345",
  "operation_id": "123e4567-e89b-12d3-a456-426614174000",
  "session_id": "00ef7f2c92be404fa0d7ed2a488a310a"
}
```

### 4.4 Error Codes

| Code | HTTP-like | Description |
|------|-----------|-------------|
| `AUTH_REQUIRED` | 401 | `auth` field missing/empty, plugin has token configured |
| `AUTH_BLOCKED` | 429 | Too many failed auth attempts; includes `blocked_until` timestamp |
| `INVALID_TOKEN` | 401 | Token provided but doesn't match (constant-time comparison) |
| `UNKNOWN_COMMAND` | 404 | Command type not in catalog |
| `IDEMPOTENCY_CONFLICT` | 409 | Same `idempotency_key` used with different parameters |
| `TIMEOUT` | 504 | Command exceeded timeout on UI thread |

---

## 5. I-03: rhinoclaw-bridge ↔ RhinoClaw Plugin (WebSocket 2000) — Optional

### 5.1 Transport

- **Protocol**: WebSocket over TCP
- **Host**: `100.110.105.101`
- **Port**: `2000`
- **Subprotocol**: JSON-RPC 2.0 over WS

### 5.2 Message Format

**Subscribe:**
```json
{
  "command": "subscribe",
  "request_id": "uuid",
  "auth": "token"
}
```

**Event Types:**
- `document_changed` — object added/modified/deleted
- `selection_changed` — user selection changes
- `command_executed` — command completed
- `prompt` — Rhino command prompt

**Unsubscribe:**
```json
{
  "command": "unsubscribe",
  "request_id": "uuid"
}
```

---

## 6. I-04: rhinoclaw-client ↔ RhinoClaw Plugin (Internal)

### 6.1 Python API

```python
class RhinoClawClient:
    # Connection
    def connect(self) -> bool
    def disconnect(self) -> None
    def __enter__(self) -> "RhinoClawClient"
    def __exit__(self, exc_type, exc_val, exc_tb) -> None
    
    # Health & Discovery
    def hello(self) -> Dict[str, Any]
    def ping(self) -> Dict[str, Any]
    def list_commands(self) -> Dict[str, Any]
    def preflight(self) -> Dict[str, Any]
    
    # Generic Entry Point
    def execute(self, command_type: str, params: Dict[str, Any], **kwargs) -> Dict[str, Any]
    
    # Convenience Wrappers
    def scene_summary(self) -> Dict[str, Any]
    def create_object(self, object_type: str, params: Dict, layer: str = None, name: str = None) -> Dict[str, Any]
    def batch_operations(self, name: str, steps: List[Dict], on_error: str = "rollback") -> Dict[str, Any]
    def execute_python3_code(self, code: str, timeout: float = 120) -> Dict[str, Any]
    def run_grasshopper(self, file_path: str, inputs: Dict = None) -> Dict[str, Any]
    def bake_grasshopper(self, file_path: str, layer: str = None) -> Dict[str, Any]
```

### 6.2 Exception Hierarchy

```python
RhinoClawError
├── AuthError(error_code, blocked_until)
├── CommandError(error_code, result)
├── ConnectionError(host, port)
├── FramingError
├── TimeoutError
└── RequestIdMismatchError
```

---

## 7. I-05: Hermes ↔ Hermes Gateway (Internal)

### 7.1 Mission Manifest Integration

The rhinoclaw-bridge is registered in Hermes config:

```yaml
# .hermes/config.yaml
mcpServers:
  rhinoclaw:
    command: "uvx"
    args: ["rhinoclaw-bridge@latest"]
    env:
      RHINOCLAW_HOST: "100.110.105.101"
      RHINOCLAW_PORT: "1999"
      RHINOCLAW_AUTH_TOKEN: "${RHINOCLAW_AUTH_TOKEN}"
      RHINOCLAW_TIMEOUT: "30"
      RHINOCLAW_DEBUG: "false"
```

### 7.2 Tool Invocation Flow

```
Hermes.call_tool("rhinoclaw_execute", {"command_type": "va_create_wall", "params": {...}})
         │
         ▼
Hermes Gateway routes to rhinoclaw-bridge MCP server
         │
         ▼
Bridge validates command_type against catalog
         │
         ▼
Bridge calls client.execute("va_create_wall", params)
         │
         ▼
Client builds frame, sends TCP, receives response
         │
         ▼
Bridge returns MCP response to Hermes
```

---

## 8. Dynamic Command Discovery Contract

### 8.1 Startup Sequence

```
Bridge Startup
      │
      ▼
client = RhinoClawClient(host, port, auth_token)
      │
      ▼
client.connect()
      │
      ▼
health = client.preflight()
assert health["auth"] == "ready"
      │
      ▼
catalog = client.list_commands()
COMMAND_CATALOG = set(catalog["result"]["commands"])
# Result: set of 128 command strings
```

### 8.2 Catalog Validation

```python
def validate_command(command_type: str) -> bool:
    return command_type in COMMAND_CATALOG

# Used by rhinoclaw_execute
if not validate_command(args["command_type"]):
    raise ValueError(f"Unknown command: {args['command_type']}. Available: {sorted(COMMAND_CATALOG)}")
```

### 8.3 Catalog Refresh (Future)

```python
async def refresh_catalog():
    """Call periodically or on SIGHUP"""
    global COMMAND_CATALOG
    catalog = await client.list_commands()
    COMMAND_CATALOG = set(catalog["result"]["commands"])
```

---

## 9. Version Compatibility Matrix

| Bridge Version | RhinoClaw Plugin | Protocol | Notes |
|----------------|------------------|----------|-------|
| 0.1.x | 0.8.2+ | wire v1 | Baseline |
| 0.2.x | 0.9.x | wire v1 | Forward compatible |
| 1.0.x | 1.0+ | wire v2 | Breaking (TBD) |

**Compatibility Rule:** Bridge discovers commands at runtime → works with any plugin version exposing `list_commands`.

---

## 10. Implementation Notes

### 10.1 Bridge Implementation (Phase 2)

```python
# packages/rhinoclaw-bridge/src/rhinoclaw_bridge/server.py
from mcp.server.fastmcp import FastMCP
from rhinoclaw_client import RhinoClawClient

mcp = FastMCP("rhinoclaw-bridge")
client = RhinoClawClient(...)
COMMAND_CATALOG = set()

@mcp.tool()
async def rhinoclaw_execute(command_type: str, params: dict) -> dict:
    if command_type not in COMMAND_CATALOG:
        return {"success": False, "error": f"Unknown command: {command_type}"}
    result = await client.execute(command_type, params)
    return {"success": True, "data": result}

@mcp.tool()
async def create_object(type: str, params: dict, layer: str = None) -> dict:
    result = await client.execute("create_object", {"type": type, "params": params, "layer": layer})
    return {"success": True, "data": result}

# ... 5 more convenience tools

async def startup():
    await client.connect()
    health = await client.preflight()
    assert health["auth"] == "ready"
    catalog = await client.list_commands()
    COMMAND_CATALOG.update(catalog["result"]["commands"])

if __name__ == "__main__":
    import asyncio
    asyncio.run(startup())
    mcp.run()
```

---

**End of IDD-008 v0.2.0**