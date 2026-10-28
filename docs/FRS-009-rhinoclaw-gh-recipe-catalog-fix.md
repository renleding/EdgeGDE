# FRS-009: RhinoClaw Grasshopper Recipe Catalog Verification Fix

**Status**: PROPOSED
**Version**: 0.2.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-008, SDD-008, IDD-008

---

## 1. Problem Statement

RhinoClaw v0.8.2 includes built-in parametric recipes (`box`, `sphere`, `cylinder`, `cone`) via the `build_and_bake_recipe` TCP command. These recipes **fail at runtime** with a `VERIFICATION_FAILED` error.

---

## 2. Observed Behaviour

| Recipe | Component GUID | Status |
|--------|----------------|--------|
| `box` | `28061aae-04fb-4cb5-ac45-16f3b66bc0a4` (CenterBox) | ❌ `VERIFICATION_FAILED` |
| `sphere` | `dabc854d-f50e-408a-b001-d043c7de151d` (Sphere) | ❌ `VERIFICATION_FAILED` |
| `cylinder` | `0373008a-80ee-45be-887d-ab5a244afc29` (Cylinder) | ❌ `VERIFICATION_FAILED` |
| `cone` | `03e331ed-c4d1-4a23-afa2-f57b87d2043c` (Cone) | ❌ `VERIFICATION_FAILED` |

**Error details:**
```
VERIFICATION_FAILED: Grasshopper catalog contract preflight failed.
Issues:
- catalog_contract.component_count must be a non-negative integer.
- catalog_contract.proxy_guid_sha256 must be a SHA-256 hex digest.
- catalog_contract.component_contract_sha256 must be a SHA-256 hex digest.
- catalog_contract.ports_skipped_guids must be an array.
- Used component 28061aae-04fb-4cb5-ac45-16f3b66bc0a4 lacks an exact in/out or param_type contract.
```

**Grasshopper catalog status:** Approximately 2503 proxies discovered at runtime.

---

## 3. Hypothesis

**Recipe component contract metadata may not match the runtime Grasshopper component catalog used by RhinoClaw v0.8.2.**

Possible causes (not yet confirmed):
- Plugin embeds stale component contracts at build time
- Grasshopper component SDK version drift between plugin build and runtime
- Component I/O signatures changed between Rhino versions

**Further plugin-level investigation required** (plugin source inspection, runtime contract comparison, hash verification) to confirm root cause.

---

## 4. Functional Requirements

### 4.1 Plugin Fix (Solid AI — Required)

| ID | Requirement | Verification |
|----|-------------|--------------|
| FRS-009-01 | Plugin v0.8.3+ MUST sync recipe component contracts with runtime Grasshopper proxy catalog at build time | All 4 recipes pass `build_and_bake_recipe` without `VERIFICATION_FAILED` |
| FRS-009-02 | Plugin MUST include `catalog_contract` with each recipe: `schema_version`, `component_count`, `proxy_guid_sha256`, `component_contract_sha256`, `ports_skipped_guids` | Recipe execution succeeds without user-provided `catalog_contract` |
| FRS-009-03 | Plugin MUST validate recipe contracts against runtime proxy catalog at plugin startup, not at recipe execution | Startup logs show "Recipe contracts verified" or specific mismatch warnings |
| FRS-009-04 | Plugin SHOULD auto-repair minor contract drift (param type renames, optional I/O) | Recipes work across Rhino 8.x minor versions |

### 4.2 Bridge Workaround (Hermes Side — Immediate)

| ID | Requirement | Verification |
|----|-------------|--------------|
| FRS-009-05 | Bridge MUST detect `VERIFICATION_FAILED` and fallback to native GH workflow | User sees graceful degradation, not hard error |
| FRS-009-06 | Bridge MUST expose native GH commands as fallback: `load_grasshopper_definition`, `run_grasshopper`, `bake_grasshopper` | User can create .gh files manually and execute them |
| FRS-009-07 | Bridge MUST document workaround in tool descriptions | `build_and_bake_recipe` tool description includes "See also: load_grasshopper_definition, run_grasshopper, bake_grasshopper" |

---

## 5. Workaround Specification (Implemented)

### 5.1 Native GH Workflow (Fully Working)

```python
# 1. Create .gh file in Rhino/Grasshopper manually
# 2. Load it
client.send_command("load_grasshopper_definition", {
    "file_path": "C:/path/to/recipe.gh",
    "only_player_inputs": True
})

# 3. Run with inputs
client.send_command("run_grasshopper", {
    "file_path": "C:/path/to/recipe.gh",
    "inputs": {"Radius": 10.0, "Height": 50.0}
})

# 4. Bake results
client.send_command("bake_grasshopper", {
    "file_path": "C:/path/to/recipe.gh",
    "layer": "GH_Output"
})
```

### 5.2 Bridge Fallback Logic (Implemented)

```python
async def build_and_bake_recipe(recipe, params, layer=None, catalog_contract=None):
    try:
        return await client.send_command("build_and_bake_recipe", {
            "recipe": recipe,
            "params": params,
            "layer": layer,
            "catalog_contract": catalog_contract
        })
    except CommandError as e:
        if e.error_code == "VERIFICATION_FAILED":
            return {
                "success": False,
                "fallback": "native_gh_workflow",
                "message": f"Recipe '{recipe}' verification failed. Use native GH workflow:",
                "steps": [
                    "1. Create .gh file in Rhino/Grasshopper",
                    "2. load_grasshopper_definition(file_path)",
                    "3. run_grasshopper(file_path, inputs)",
                    "4. bake_grasshopper(file_path, layer)"
                ],
                "working_commands": [
                    "load_grasshopper_definition",
                    "run_grasshopper",
                    "bake_grasshopper",
                    "get_grasshopper_canvas",
                    "list_grasshopper_definitions",
                    "get_gh_catalog_status"
                ]
            }
        raise
```

---

## 6. Acceptance Criteria

| Criterion | Pass Condition |
|-----------|----------------|
| AC-01 | Plugin v0.8.3+ released with fixed recipe contracts |
| AC-02 | `build_and_bake_recipe("box", {"x": 10})` succeeds without `catalog_contract` |
| AC-03 | All 4 built-in recipes (`box`, `sphere`, `cylinder`, `cone`) produce geometry |
| AC-04 | Bridge fallback returns actionable guidance on `VERIFICATION_FAILED` |
| AC-05 | Native GH commands (`load_grasshopper_definition`, `run_grasshopper`, `bake_grasshopper`) work end-to-end |

---

## 7. Timeline

| Milestone | Target |
|-----------|--------|
| Workaround documented in bridge | ✅ DONE (FRS-009-05, FRS-009-06, FRS-009-07) |
| Solid AI notified of bug | 🔄 PENDING (file GitHub issue) |
| Plugin v0.8.3 released | ⏳ DEPENDS ON VENDOR |
| Full recipe system validated | ⏳ AFTER PLUGIN UPDATE |

---

## 8. References

- RhinoClaw Issue: https://github.com/McMuff86/RhinoClaw/issues (to be filed)
- FRS-008: Hermes ↔ RhinoClaw TCP Integration
- SDD-008: System Design Document
- RhinoClaw Plugin Source: `rhinoclaw_server/src/rhinoclaw/tools/`

---

**End of FRS-009 v0.2.0**