---
id: SDD-012
title: Production & Enterprise Readiness — System Design
status: accepted
owner: Hermes (Director)
created: 2026-10-26
updated: 2026-10-26
depends_on: [SDD-011, FRS-012]
governs: [packages/gh_automation_core, tests/, proxy_catalog.json]
implements: [FRS-012]
verification: [pytest, inspect_workspace, catalog regeneration]
gates: [ste-lint, openspec validate, pytest]
changelog:
  - {version: "1.0", date: "2026-10-26", note: "Initial architecture for the 5-phase readiness roadmap."}
---

# SDD-012 — Production & Enterprise Readiness: System Design

## 1. Purpose

Define the internal architecture that takes the FRS-011 prototype (working graph
automation, unproven lattice geometry) to the FRS-012 production/enterprise target.
The design centers on one idea: **a declarative GraphSpec is the single source of
truth**, and every operation (validate, repair, compile, inspect, score) is a pure
function over specs and serialized live state, with a thin bridge adapter to the
live Grasshopper session.

## 2. Context

- FRS-011 delivered component/wire automation over RhinoClaw TCP (port 1999) and
  `execute_rhinoscript_python_code` (IronPython 2.7 inside Grasshopper).
- Known prototype weakness (root cause of the missing-lattice incident): success was
  reported at the *graph* layer while the *geometry* layer produced a smooth shell.
  Red components (Twist, Union All) were graph-execution errors, not automation errors.
- This design makes the geometry layer a first-class, evidence-backed output of every
  generation, and makes graph integrity self-healing.

## 3. Architecture

Layered, dependency-inward (outer layers depend inward; the pure core depends on nothing):

```
                +-------------------------------------------+
                |  Product Generators (P3)                 |  LatticeLamp, Diffuser, Vase, Facade, Sconce
                +--------------------+----------------------+
                                     | composes
                +--------------------v----------------------+
                |  Module Library (P3)                     |  ProfileGenerator, RevolvedShell,
                |  build(builder, params)                  |  TwistModifier, WaveModifier, GyroidField,
                +--------------------+----------------------+  LatticeMesher, TopClosure, MountingCollar,
                                     |                      InspectionModule, ExportSTL
                +--------------------v----------------------+
                |  GH Definition Builder (P2)              |  GraphSpec in memory; GUIDs via catalog
                |  add_slider/add_component/connect/       |
                |  group/save/validate                     |
                +--------------------+----------------------+
                                     |
   +----------------+   +------------v-----------+   +---------------------+
   | ProxyCatalog   |   | Compiler (P2)          |   | Validator/Repair    |
   | (P2) live      |   | compile_single_shot()  |   | (P1) validate_graph |
   | ComponentServer|   | GraphSpec -> 1 IronPy  |   | compute_repair      |
   | dump -> JSON   |   | script                 |   | repair_graph        |
   +----------------+   +------------+-----------+   +----------+----------+
                                     |                          |
   +----------------+   +------------v-----------+   +----------v----------+
   | Compliance     |   | Bridge Adapter         |   | Inspector (P1)      |
   | Engine (P4)    |   | execute(gh_script)->str|   | inspect_workspace   |
   | feature JSON + |   | new/load/solve/bake/   |   | capture_viewport    |
   | score          |   | screenshot             |   | capture_canvas      |
   +----------------+   +------------+-----------+   +----------+----------+
                                     |                          |
                +--------------------v--------------------------v----------------+
                |  RhinoClaw TCP (port 1999) -> Grasshopper (IronPython 2.7)      |
                +--------------------+--------------------------+----------------+
                                     |
                +--------------------v----------------------+
                |  Audit Logger (P5) generation.json         |
                |  Recovery Supervisor (P5)                  |
                |  Continuous Validation CI (P5)             |
                +--------------------------------------------+
```

## 4. Component Responsibilities

| Component | Responsibility | Phase |
|-----------|---------------|-------|
| ProxyCatalog | Authoritative component lookup from a live ComponentServer dump; ambiguity-safe resolve; eliminates hardcoded GUIDs. | P2 |
| GHDefinitionBuilder | Sole graph authoring engine; builds a declarative GraphSpec in memory. | P2 |
| Compiler (`compile_single_shot`) | Emits ONE IronPython script that creates all components, sets sliders, adds all wires, groups, saves, solves. | P2 |
| Validator | `validate_graph(spec, live)` diffs spec vs LiveState; reports missing wires, disconnected I/O, red components, missing components. | P1 |
| Repairer | `compute_repair` / `repair_graph` emit the exact missing WireOps (+ auditable IronPython); monotonic, idempotent. | P1 |
| Inspector | `inspect_workspace(bridge)` returns structured GH+Rhino state; captures viewport/canvas. | P1 |
| Bridge Adapter | Minimal transport over RhinoClaw TCP; `execute(gh_script)->str` plus new/load/solve/bake/screenshot. | P1 |
| Module Library | Reusable `build(builder, params)` fragments. | P3 |
| Product Generators | Module composition only; no direct GH authoring. | P3 |
| Compliance Engine | Feature booleans + per-axis score per generation. | P4 |
| Audit Logger | `generation.json` per run. | P5 |
| Recovery Supervisor | Resume after Rhino/GH crash, RhinoClaw disconnect, network loss. | P5 |
| Continuous Validation | CI: code change → generate → validate graph → validate geometry → compliance → pass/fail. | P5 |

## 5. Data Flow (single generation)

```
Natural-language prompt
  -> Hermes composes modules -> GraphSpec (declarative, in memory)
  -> Compiler: GraphSpec -> single IronPython script
  -> Bridge.execute(script)  [ONE round-trip]
       creates components (GUIDs from ProxyCatalog), wires, groups, saves .ghpy, solves
  -> Validator: validate_graph(spec, live_state) ; if issues -> Repairer -> re-validate
  -> Bake -> Rhino document
  -> Inspector: inspect_workspace() -> structured report + screenshots
  -> Geometry verification: mesh exists, faces>0, verts>0, volume>0
  -> Compliance Engine: feature JSON + score
  -> Audit Logger: generation.json (prompt, modules, params, versions, time, score)
  -> Final design + evidence bundle
```

## 6. Key Design Decisions

1. **Declarative spec as source of truth.** All validation/repair/compile operate on
   GraphSpec + serialized LiveState, so they are deterministic, auditable, and
   unit-testable offline with no Rhino present.
2. **Pure core / thin adapter split.** `validate.py`, `builder.py` (spec layer),
   `proxy_catalog.py`, and `inspect._parse` are pure Python (stdlib only). The bridge
   adapter is the only RhinoClaw-aware layer. This makes Phase 1 logic testable in CI
   without a live session, and integration tests explicit.
3. **Catalog-driven GUID resolution.** Component identity comes from a live
   ComponentServer dump (`proxy_catalog.json`), never from literals. `resolve()` is
   ambiguity-safe by construction.
4. **Monotonic, idempotent repair.** `repair_graph` only ADDS missing wires; it never
   deletes. Re-running after a successful repair emits zero ops — safe to loop.
5. **Single-shot compilation.** Replaces N create/redraw round-trips with one
   IronPython execution + one save + one solve (P2 speed target 10–100x).
6. **Geometry is a gate, not a side effect.** Every generation asserts mesh
   faces>0/verts>0/volume>0; a smooth shell with no lattice fails the gate.

## 7. File Structure

```
packages/gh_automation_core/
  __init__.py            # public API re-exports
  proxy_catalog.py       # ProxyCatalog, find/resolve, ambiguity errors
  proxy_catalog.json     # live ComponentServer dump (regenerated, not hand-edited)
  validate.py            # GraphSpec/LiveState, validate_graph, compute_repair, repair_graph
  builder.py             # GHDefinitionBuilder, compile_single_shot
  inspect.py             # inspect_workspace, capture_viewport, capture_canvas, Bridge contract
  modules/               # (P3) module library — build(builder, params)
  generators/            # (P3) product generators — module composition
  compliance.py          # (P4) feature compliance + scoring
  audit.py               # (P5) generation.json writer
  recovery.py            # (P5) resume supervisor
tests/
  conftest.py  bridge.py
  test_graph_generation.py  test_save_reload.py  test_validation.py
  test_self_healing.py      test_geometry_generation.py  test_bake_pipeline.py
  test_inspection.py
docs/
  FRS-012-...  SDD-012-...  IDD-012-...
```

## 8. Verification

- Offline: pure-logic unit tests (validate, repair idempotency, catalog ambiguity,
  builder spec construction, save/reload round-trip, inspect._parse).
- Online: integration tests against a live RhinoClaw session (marked `integration`,
  skipped unless `RHINOCLAW_HOST` is set).
- Catalog regeneration: `dump_proxies.ghpy` via RhinoClaw -> `proxy_catalog.json`;
  count and spot-check GUIDs recorded as evidence.

## 9. Gates

- ste-lint (doc structure), openspec validate, pytest (offline must pass; integration
  skip without host), grep gate (no hardcoded GUIDs), CI continuous validation.

## 10. Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-10-26 | Initial architecture. |
