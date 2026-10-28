# Rhino MCP Capability Map — EdgeGDE

**Last Updated:** 2026-10-24  
**Status:** Infrastructure verified, protocol matched, native GH path documented

---

## Network Topology (Verified)

| Service | Internal Port | Proxy Port | Endpoint (Tailscale) | Status |
|---------|--------------|------------|---------------------|--------|
| rhino-mcp-main (0.5.1) | 4242 | 14242 | `tcp://100.110.105.101:14242` | ✅ Alive |
| rhinomcp-mod (0.4.x) | 1999 | 11999 | `tcp://100.110.105.101:11999` | ✅ Alive (needs auth key) |
| rhino-gh-mcp | 9876 | 19876 | `tcp://100.110.105.101:19876` | ⚠️ Not bound in 0.5.1 |
| RhinoClaw (0.8.2) | 10500 | — | `tcp://100.110.105.101:10500` | ✅ IIS + MCP hybrid |

**Portproxies (pc2):** 14242→4242, 11999→1999, 19876→9876, 4010→4010, 10500→10500  
**Firewall:** 14242, 11999, 19876 open (verified from Mac)

---

## Hermes MCP Servers (Config)

```yaml
mcp_servers:
  rhino-mcp-main:
    command: uvx
    args: [rhinomcp==0.5.1]          # pinned to match plugin
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
    args: [rhinomcp==0.5.1]          # uses main plugin (full GH on 4242)
    env:
      RHINO_MCP_HOST: "100.110.105.101"
      RHINO_MCP_PORT: "14242"
      RHINO_MCP_ALLOW_REMOTE: "1"
      RHINO_MCP_TIMEOUT: "30.0"
```

> **Note:** `rhino-gh-mcp` points to 14242 (main plugin) because 0.5.1 does not bind 9876. Main plugin includes "full GH canvas + core".

---

## Tool Inventory (Live)

| Server | Tools | Key Capabilities |
|--------|-------|------------------|
| **rhino-mcp-main** (via rhino-gh-mcp) | 74 | `create_objects`, `get_document_summary`, `run_command`, `gh_build_graph`, `gh_mutate_graph`, `gh_set_parameter_value`, `gh_get_parameter_value`, `pipe`, `extrude_curve`, `loft`, `boolean_*`, `transform`, `array_*` |
| **rhino-mcp-mod** | 50 | `create_objects` (engineering types), `run_rhino_command`, `get_rhino_log`, `evaluate_stability`, `assign_mass`, `connectivity_graph`, `materials`, `layer_states`, `named_views`, `batch_ops` |
| **rhino-gh-mcp** | 74 | Identical to main — dedicated canvas session |

---

## Protocol Versions (Critical)

| Component | Version | Protocol | Notes |
|-----------|---------|----------|-------|
| Rhino Plugin | 0.5.1 (rhino-mcp) | JSON-RPC 2.0 over TCP | `mcpstart` / `mcpversion` commands |
| Python Server | 0.5.1 (pinned) | JSON-RPC 2.0 | Must match plugin; 0.4.x sends Type-Based (`type`/`key`) → **null key error** |
| rhinomcp-mod | 0.4.1 | Type-Based | Requires `key` in every request; auth token |

**Mismatch symptom:** "Value cannot be null. (Parameter 'key')" — old Python server talking to 0.5.1 plugin.

---

## Working Commands (pc2 Rhino)

```bash
# Start main plugin (0.5.1)
mcpstart
mcpversion   # confirms 0.5.1

# Verify listeners
Get-NetTCPConnection -State Listen | ? LocalPort -in 1999,4242,9876 | ft LocalPort,OwningProcess
# Should show 4242 (and 1999) on Rhino PID
```

---

## Verified Workflows

### 1. Core Geometry (via rhino-mcp-main / rhino-gh-mcp)
```python
# Create primitives
create_objects(objects=[{"type":"POINT","params":{"x":0,"y":0,"z":0}}])
create_objects(objects=[{"type":"CIRCLE","params":{"center":[0,0,0],"radius":10}}])

# Document state
get_document_summary()
run_command(command="_Circle 0,0,0 10")
```

### 2. Grasshopper Canvas (via rhino-gh-mcp on 14242)
```python
# Full GH authoring
gh_build_graph(graph_id="my-def", components=[...], wires=[...], groups=[...])
gh_mutate_graph(graph_id="my-def", edits=[...])
gh_set_parameter_value(graph_id="my-def", param_id="slider1", value=42)
gh_get_parameter_value(graph_id="my-def", param_id="slider1")
gh_run_solution(graph_id="my-def")
```

### 3. Engineering / Analysis (via rhino-mcp-mod)
```python
# Physics / stability
evaluate_stability()
assign_mass(object_ids=[...], mass=1.5)
get_connectivity_graph()
run_rhino_command(command="_SelAll _Delete")
get_rhino_log(lines=50)
```

---

## Known Limitations (0.5.1)

| Limitation | Workaround |
|------------|------------|
| Port 9876 (GH) not bound | Use main plugin on 14242 for GH (`gh_*` tools work) |
| `rhino-mcp-main` not separate server | `rhino-gh-mcp` config points to 14242 |
| Plugin conflict if multiple loaded | `PlugInManager` → disable all except `rhino-mcp` (0.5.1) |
| ~6-8s poll latency on mod/gh plugins | Use main plugin for low-latency core ops |

---

## Native GH Path (No MCP)

**File:** `tools/lamp_shade_gh_builder.py`  
**Deploy:** Paste into Rhino `_EditPythonScript` → F5

Builds **8-group parametric Grasshopper definition** with 24 sliders:
1. Parameters (24 sliders)
2. Base + Mounting System
3. Primary Form (lofted silhouette)
4. Twist + Waves (270° twist, 8mm/5Hz wave)
5. Gyroid Generation (placeholder)
6. Interference Layer (moiré, helical, asymmetry, radial harmonics)
7. Top Closure (gyroid cap)
8. Mesh Output (validation, metrics)

---

## Repository Artifacts

| Path | Purpose |
|------|---------|
| `~/.hermes/config.yaml` | Hermes MCP server config (pinned 0.5.1) |
| `docs/RHINO-MCP-CAPABILITY-MAP.md` | This file |
| `tools/lamp_shade_gh_builder.py` | Native IronPython GH builder |
| `references/rhino-mcp-protocols.md` | Wire protocol docs |
| `references/plugin-conflict-resolution.md` | Conflict resolution guide |
| `references/rhinocommon-primitives.md` | `create_objects` type reference |

---

## Next Actions

1. **Restart gateway** (separate terminal): `hermes gateway restart`
2. **Verify tools:** `tool_search(["rhino"])` → should show 124+ tools
3. **Deploy lamp shade:** Run `lamp_shade_gh_builder.py` in `_EditPythonScript`
4. **Optional:** Add defensive null-key check to plugin C# if rebuild needed