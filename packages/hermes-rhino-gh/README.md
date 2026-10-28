# Hermes ↔ Rhino/Grasshopper MCP Integration

**Version:** 0.1.0  
**Date:** 2026-10-25  
**Status:** Production-ready (mod server), Experimental (main/GH servers)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            HERMES (Mac)                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ rhino-mcp-main  │  │ rhino-mcp-mod   │  │ rhino-gh-mcp    │             │
│  │ (14242→4242)    │  │ (11999→1999)    │  │ (19876→9876)    │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
└───────────│─────────────────────│─────────────────────│────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TAILSCALE (100.110.105.101)                          │
└─────────────────────────────────────────────────────────────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RHINO (pc2, PID 4516)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ rhinomcp     │  │ rhinomcp-mod │  │ EnneadTab-   │  │ RhinoClaw      │  │
│  │ 0.4.1.1 ✅   │  │ 0.4.x ✅     │  │ grasshopper  │  │ 0.8.2 ✅       │  │
│  │ Port 4242    │  │ Port 1999    │  │ ✅           │  │ Port 10500     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Current Server Status

| Server | Proxy Port | Internal Port | Plugin | Status | Tools |
|--------|------------|---------------|--------|--------|-------|
| **rhino-mcp-main** | 14242 | 4242 | rhinomcp 0.4.1.1 | ❌ **UNSTABLE** - Connection resets (Errno 54) | 70 (incl. GH) |
| **rhino-mcp-mod** | 11999 | 1999 | rhinomcp-mod 0.4.x | ✅ **STABLE** | 50 (engineering) |
| **rhino-gh-mcp** | 19876 | 9876 | rhinomcp 0.4.1.1 | ❌ **UNSTABLE** - Connection resets | 70 (incl. GH) |

**Working today:** `rhino-mcp-mod` (11999) + Native GH IronPython scripts

---

## Capabilities by Server

### rhino-mcp-mod (STABLE - 50 tools)
**Geometry:**
- `create_objects` - POINT, LINE, POLYLINE, BOX, SPHERE, CYLINDER, CURVE, REVOLUTION, TUBE, MESH
- `modify_objects`, `delete_objects`, `get_objects_info`
- `create_layer`, `create_material`
- `run_rhino_command` - Rhino commands (`_Circle`, `_SelNone`, etc.)

**Engineering/Analysis:**
- `evaluate_stability` - Assembly + element stability
- `get_connectivity_graph` - Structural connectivity
- `assign_mass` - Mass assignment
- `list_plugins` - All loaded Rhino plugins
- `get_rhino_log` - Command history
- `get_document_summary`, `get_document_info`
- `get_object_info`, `get_object_attributes`, `update_object_attributes`

**GH/Parameters (via mod):**
- None - use native IronPython for GH

---

### Native Grasshopper (IronPython in `_EditPythonScript`)
**Full parametric definitions** - see `lamp_shade_gh_builder.py` template:
- 24 sliders, 8 groups, full GH canvas authoring
- Loft, Twist, Wave, Gyroid, Interference, Mesh output
- Runs directly in Rhino's Python editor (F5)

---

## Package Structure

```
packages/hermes-rhino-gh/
├── pyproject.toml
├── README.md
└── src/hermes_rhino_gh/
    ├── __init__.py           # Main exports
    ├── client.py             # RhinoMCPClient (primary interface)
    ├── gh_builder.py         # GHGraphBuilder + templates
    ├── health.py             # HealthMonitor (TCP + gateway checks)
    └── exceptions.py         # Custom exceptions
```

---

## Quick Start

```python
import asyncio
from hermes_rhino_gh import RhinoMCPClient, ServerType, create_simple_vase_graph

async def main():
    async with RhinoMCPClient() as client:
        # Check health
        if client.is_connected(ServerType.MOD):
            # Create geometry via RhinoCommon
            result = await client.create_objects([
                {"type": "POINT", "params": {"x": 0, "y": 0, "z": 0}},
                {"type": "SPHERE", "params": {"center": [0,0,0], "radius": 10}},
            ])
            print(result)
            
            # Run Rhino command
            await client.run_command("_Circle 0,0,0 25")
            
            # Get document state
            summary = await client.get_document_summary()
            print(summary)

asyncio.run(main())
```

---

## Grasshopper Parametric Definitions

### Option 1: Native IronPython (RECOMMENDED - stable)
```python
# Paste into Rhino _EditPythonScript → F5
from tools.lamp_shade_gh_builder import create_lamp_shade_graph
# Or use the full template in tools/lamp_shade_gh_builder.py
```

### Option 2: GHGraphBuilder (for MCP when stable)
```python
from hermes_rhino_gh import create_simple_vase_graph, GHGraphBuilder

# Pre-built templates
graph = create_simple_vase_graph("my_vase")
graph = create_lamp_shade_graph("lamp_shade")

# Custom builder
builder = GHGraphBuilder("custom")
r = builder.add_slider("Radius", "R", 10, 100, 50)
c = builder.add_component("Circle", "circle1", "Base")
builder.connect(r, 0, c, 1)
graph = builder.build()

# Deploy via MCP (when main/GH servers stable)
await client.gh_build_graph(**graph)
```

---

## Health Monitoring

```python
from hermes_rhino_gh import HealthMonitor

async with HealthMonitor() as monitor:
    result = await monitor.check_all()
    print(f"Overall: {result.overall_status}")
    for name, health in result.servers.items():
        print(f"  {name}: {health.status} ({health.response_time_ms:.1f}ms)")
```

Output:
```
Overall: DEGRADED
  rhino-mcp-main: UNHEALTHY (Connection reset)
  rhino-mcp-mod: HEALTHY (45.2ms)
  rhino-gh-mcp: UNHEALTHY (Connection reset)
```

---

## Troubleshooting

### Connection Resets (Errno 54) on main/GH
**Cause:** Rhino plugin accepts TCP but drops connection on command.
**Workaround:** Use mod server + native IronPython GH scripts.

### "Value cannot be null. (Parameter 'key')" on mod
**Cause:** Missing auth key.
**Fix:** Set `RHINO_MCP_MOD_KEY` env var in Hermes config.

### Plugin Conflicts
**Symptom:** Multiple plugins on same port (4242).
**Fix:** `_PluginManager` → disable ALL except `rhinomcp` (0.4.1.1), `rhinomcp-mod`, `EnneadTab-grasshopper`.

### GH not loading on 9876
**Requirement:** Grasshopper must be OPEN in Rhino before `mcpmodstart`.
**Verify:** `Get-NetTCPConnection -State Listen | ? LocalPort -eq 9876`

---

## Configuration

**Hermes config.yaml (auto-managed via `hermes mcp` CLI):**
```yaml
mcp_servers:
  rhino-mcp-main:
    command: uvx
    args: [rhinomcp@latest]
    env:
      RHINO_MCP_HOST: "100.110.105.101"
      RHINO_MCP_PORT: "14242"
      RHINO_MCP_ALLOW_REMOTE: "1"
      RHINO_MCP_TIMEOUT: "30.0"
  
  rhino-mcp-mod:
    command: uvx
    args: ["--with", "mcp[cli]<2", "rhinomcp-mod"]
    env:
      RHINO_MCP_HOST: "100.110.105.101"
      RHINO_MCP_PORT: "11999"
      RHINO_MCP_ALLOW_REMOTE: "1"
      RHINO_MCP_TIMEOUT: "30.0"
  
  rhino-gh-mcp:
    command: uvx
    args: [rhinomcp@latest]
    env:
      RHINO_MCP_HOST: "100.110.105.101"
      RHINO_MCP_PORT: "19876"
      RHINO_MCP_ALLOW_REMOTE: "1"
      RHINO_MCP_TIMEOUT: "30.0"
```

---

## Files in Repo

| Path | Purpose |
|------|---------|
| `packages/hermes-rhino-gh/` | Python package |
| `tools/lamp_shade_gh_builder.py` | Full parametric lamp shade (IronPython) |
| `docs/RHINO-MCP-CAPABILITY-MAP.md` | Live capability documentation |
| `~/.hermes/config.yaml` | Hermes MCP server config |

---

## Next Steps

1. **Stabilize main/GH servers** - investigate plugin crash on command
2. **Add auth key support** for mod server in Hermes config
3. **GH template library** - more pre-built definitions
4. **Batch operations** - optimize create_objects batching
5. **Verification engine** - post-operation state diff checks