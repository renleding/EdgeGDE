# FRS-011: Agentic Grasshopper Automation — Overcoming Catalog Verification

**Status**: PROPOSED
**Version**: 0.1.0
**Author**: Hermes (Director)
**Date**: 2026-10-25
**Related**: FRS-008, FRS-009, FRS-010

---

## 1. Problem Statement

RhinoClaw v0.8.2 has **catalog verification** that blocks programmatic GH definition creation:

| Command | Status | Blocker |
|---------|--------|---------|
| `build_gh_definition` | ❌ Blocked | Requires `catalog_contract` with exact SHA-256 hashes |
| `build_and_bake_recipe` | ❌ Blocked | Same catalog verification |
| Native GH (`load_gh`, `run_gh`, `bake_gh`) | ✅ Works | No catalog check |

This prevents **agentic automation** where Hermes creates/modifies GH definitions programmatically.

---

## 2. Root Cause Analysis

### 2.1 Catalog Verification Mechanism

RhinoClaw v0.8.2 implements strict catalog contract validation:
- At plugin startup, builds proxy catalog (2503 proxies) with SHA-256 hashes
- Each GH component has a contract (inputs/outputs/types)
- Programmatic definition creation requires matching `catalog_contract` with:
  - `schema_version`, `component_count`, `proxy_guid_sha256`
  - `component_contract_sha256`, `ports_skipped_guids`
  - Per-component contract verification

### 2.2 Why It Fails

| Issue | Detail |
|-------|--------|
| **Stale contracts** | Plugin built against different GH version than runtime |
| **No contract generation** | No tool to auto-generate valid `catalog_contract` |
| **All-or-nothing** | Single mismatch blocks entire definition |
| **No bypass** | No "unsafe" mode to skip verification |

### 2.3 Plugin Architecture Limitation

The verification happens in RhinoClaw plugin (C#), not bridge. Fix requires plugin update from Solid AI.

---

## 3. Strategic Options

| Option | Effort | Timeline | Agentic Capability |
|--------|--------|----------|-------------------|
| **A. Wait for v0.8.3+** | Zero | Unknown (vendor) | Full programmatic |
| **B. Manual GH + Native Workflow** | Low | Immediate | Semi-agentic (Hermes drives native commands) |
| **C. RhinoCommon Geometry** | Medium | Immediate | Full (bypass GH entirely) |
| **D. Hybrid: Template GH + Parameter Injection** | Low | Immediate | High (modify params, not structure) |
| **E. Custom GH Definition Generator** | High | 1-2 weeks | Full (generate .gh files offline) |

---

## 4. Recommended Approach: Phased Strategy

### Phase 1: Immediate — Native GH Workflow (Week 1)

**Goal**: Achieve agentic lamp generation using existing native commands

```python
# Hermes Mission: Lattice Lamp Generation
{
  "tasks": [
    # 1. Manual: Create lattice_lamp_v1.gh in GH editor (12 sliders)
    # 2. Hermes: Load definition
    {"tool": "load_grasshopper_definition", "args": {"file_path": "C:/temp/lattice_lamp_v1.gh"}},
    
    # 3. Hermes: Run with parameters
    {"tool": "run_grasshopper", "args": {"file_path": "...", "inputs": {...12 params...}}},
    
    # 4. Hermes: Bake geometry
    {"tool": "bake_grasshopper", "args": {"file_path": "...", "layer": "Lattice_Lamp_Output"}},
    
    # 5. Hermes: Export STL via Python
    {"tool": "execute_python3_code", "args": {"code": "export_stl(...)"}},
    
    # 6. Hermes: Verify with inspect_workspace
    {"tool": "inspect_workspace", "args": {"expected_features": [...], "level": 3}}
  ]
}
```

**Deliverable**: Working agentic lamp generation pipeline

---

### Phase 2: Short-term — Template GH + Parameter Injection (Week 2)

**Goal**: Enable parameter variation without rebuilding GH structure

**Approach**: 
1. Create master GH definition with all 12 sliders + geometry pipeline
2. Hermes only injects parameter values via `run_grasshopper(inputs={...})`
3. No structural changes needed — catalog verification passes

**Benefits**:
- Full parametric control (12 parameters)
- Catalog verification satisfied (definition pre-exists)
- Fast iteration (< 5s per variant)

---

### Phase 3: Medium-term — RhinoCommon Geometry Engine (Week 3-4)

**Goal**: Bypass Grasshopper entirely for maximum control

**Architecture**:
```
Hermes → rhinoclaw-bridge → execute_python3_code (RhinoCommon)
                                ↓
                    Direct BRep/Mesh construction
                    ↓
                    TPMS Gyroid via math (not GH)
                    Wave/Twist via transforms
                    ↓
                    Bake → Export → Validate
```

**Implementation**:
- Port GH geometry logic to pure RhinoCommon (Python 3)
- TPMS Gyroid: `sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) < t`
- Wave: `r = r0 + A*sin(f*θ)` on surface
- Twist: Affine transform along Z
- Boolean: `Rhino.Geometry.Intersect.Intersection.BrepBrep`

**Benefits**:
- Zero catalog verification issues
- Full programmatic control
- Faster (no GH solve overhead)
- Portable (runs anywhere RhinoCode works)

---

### Phase 4: Long-term — Plugin Fix + Full Agentic (Month 2+)

**Action**: File RhinoClaw issue with Solid AI for v0.8.3+

**Required Fixes**:
1. Auto-generate `catalog_contract` from runtime proxy catalog
2. Add "unsafe" mode to bypass verification
3. Add `generate_catalog_contract` tool
4. Fix recipe contracts at build time

**Then**: Full programmatic GH definition creation becomes possible.

---

## 5. VisualARQ / Lands Design Integration

### VisualARQ (Available in RhinoClaw)

| Command | Status | Use Case |
|---------|--------|----------|
| `va_create_wall`, `va_create_slab`, `va_create_section` | ✅ Available | BIM elements |
| `va_documentation_capabilities` | ✅ Available | Documentation |

**Agentic Pattern**: Same native workflow — create definitions with VisualARQ components, inject parameters via `run_gh`.

### Lands Design (Need Verification)

| Command | Status | Use Case |
|---------|--------|----------|
| Terrain, Plants, Irrigation | ❓ Unknown | Landscape architecture |

**Action**: Test `list_commands` for `va_` and `ld_` prefixes.

---

## 6. Complete Agentic Automation Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HERMES (Director)                                                           │
│  - Mission Planning                                                         │
│  - Parameter Optimization                                                   │
│  - Design Validation (inspect_workspace)                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ MCP stdio
┌─────────────────────────────────────────────────────────────────────────────┐
│ rhinoclaw-bridge (MCP)                                                      │
│  - 7 Core Tools + inspect_workspace                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓ TCP 1999
┌─────────────────────────────────────────────────────────────────────────────┐
│ RHINO PC (pc2)                                                              │
│  ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐   │
│  │ RhinoClaw v0.8.2    │ │ Grasshopper         │ │ VisualARQ /         │   │
│  │ (TCP 1999)          │ │ (native commands)   │ │ Lands Design        │   │
│  └─────────────────────┘ └─────────────────────┘ └─────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Rhino 8 + RhinoCode (Python 3)                                      │   │
│  │  - execute_python3_code (RhinoCommon)  ← BYPASSES GH                │   │
│  │  - load_gh / run_gh / bake_gh (native)                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Implementation Roadmap

| Week | Phase | Deliverable | Status |
|------|-------|-------------|--------|
| 1 | Phase 1 | Manual GH definition + Native workflow agentic pipeline | 🔄 **START** |
| 2 | Phase 2 | Template GH + parameter injection (12 params) | ⏳ |
| 3-4 | Phase 3 | RhinoCommon geometry engine (TPMS, Wave, Twist) | ⏳ |
| 5-6 | Phase 4 | VisualARQ/Lands Design integration | ⏳ |
| 7+ | Phase 5 | Plugin fix advocacy + full programmatic GH | ⏳ |

---

## 8. Immediate Next Steps (Gogo)

1. **Create `lattice_lamp_v1.gh` manually** on pc2 (Grasshopper open)
   - 12 Number Sliders with exact params from FRS-010
   - Geometry pipeline: Cylinder → Taper → Twist → TPMS Gyroid → Wave → Boolean → Top Closure → Mount
   - Save as `C:/temp/lattice_lamp_v1.gh`

2. **Run full agentic pipeline**:
   ```bash
   load_gh → run_gh(params) → bake_gh → export_stl → inspect_workspace(level=3)
   ```

3. **Validate**: Compliance score ≥ 75

4. **Iterate**: Parameter sweep (5 variants) → all pass

---

## 9. Success Criteria

| Metric | Target |
|--------|--------|
| Agentic lamp generation | < 30s end-to-end |
| Parameter sweep (5 variants) | 100% pass |
| Compliance score | ≥ 75/100 |
| STL validation | Watertight, positive volume |
| VisualARQ integration | Wall/Slab parametric |
| Lands Design integration | Terrain/Plant parametric |

---

**End of FRS-011**