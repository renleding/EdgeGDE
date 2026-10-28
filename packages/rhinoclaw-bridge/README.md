# rhinoclaw-bridge

Thin MCP↔TCP bridge for RhinoClaw — Hermes integration.

## Overview

Exposes RhinoClaw's 128 TCP commands to Hermes via MCP stdio.
Dynamic command discovery via `list_commands()` at startup.

## Architecture

```
Hermes (MCP client)
    ↓ stdio
rhinoclaw-bridge (FastMCP server)
    ↓ TCP 1999 (length-prefixed JSON)
RhinoClaw Plugin (port 1999)
    ↓
Rhino 8 + Grasshopper + VisualARQ
```

## Tools Exposed

| Tool | Type | Description |
|------|------|-------------|
| `rhinoclaw_execute` | Generic | Execute any RhinoClaw command by type |
| `scene_summary` | Convenience | Get complete scene summary |
| `create_object` | Convenience | Create a geometric object |
| `batch_operations` | Convenience | Execute multiple operations atomically |
| `execute_python3_code` | Convenience | Execute Python 3 code in Rhino |
| `run_grasshopper` | Convenience | Run a Grasshopper definition |
| `bake_grasshopper` | Convenience | Bake Grasshopper geometry to Rhino |

## Installation

```bash
pip install -e .
```

## Configuration

Environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RHINOCLAW_AUTH_TOKEN` | Yes | - | Auth token for RhinoClaw |
| `RHINOCLAW_HOST` | No | 127.0.0.1 | RhinoClaw TCP host |
| `RHINOCLAW_PORT` | No | 1999 | RhinoClaw TCP port |
| `RHINOCLAW_TIMEOUT` | No | 30 | Command timeout (seconds) |
| `RHINOCLAW_DEBUG` | No | false | Enable debug logging |

## Usage with Hermes

Add to `.hermes/config.yaml`:

```yaml
mcpServers:
  rhinoclaw:
    command: "uvx"
    args: ["rhinoclaw-bridge@latest"]
    env:
      RHINOCLAW_HOST: "100.110.105.101"
      RHINOCLAW_PORT: "1999"
      RHINOCLAW_AUTH_TOKEN: "${RHINOCLAW_AUTH_TOKEN}"
      RHINOCLAW_TIMEOUT: "30"
```

## Dynamic Command Discovery

On startup, the bridge:
1. Connects to RhinoClaw via TCP
2. Runs `preflight()` health check
3. Calls `list_commands()` to discover 128 available commands
3. Populates command catalog for `rhinoclaw_execute` validation

This means the bridge automatically adapts to RhinoClaw version changes without code updates.

## Development

```bash
# Install in development mode
pip install -e .

# Run tests
pytest tests/
```