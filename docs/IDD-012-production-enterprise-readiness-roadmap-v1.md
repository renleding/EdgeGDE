---
id: IDD-012
title: Production & Enterprise Readiness — Interface Contracts
status: accepted
owner: Hermes (Director)
created: 2026-10-26
updated: 2026-10-26
depends_on: [IDD-011, FRS-012, SDD-012]
governs: [packages/gh_automation_core public API, generation.json, compliance JSON]
implements: [FRS-012]
verification: [IDD contract tests, pytest]
gates: [ste-lint, openspec validate, pytest]
changelog:
  - {version: "1.0", date: "2026-10-26", note: "Initial interface contracts for the readiness roadmap."}
---

# IDD-012 — Production & Enterprise Readiness: Interface Contracts

## 1. Purpose

Pin the exact contracts between the readiness-roadmap components so that the builder,
validator, inspector, catalog, modules, generators, compliance engine, and audit logger
can be developed, tested, and versioned independently. All contracts are deterministic
and auditable.

## 2. Data Structures

### Proxy record (proxy_catalog.json element)
```
{"g": "<uuid>", "n": "<Name>", "k": "<NickName>", "c": "<Category>"}
```
- `g` Grasshopper component GUID; `n` component Name; `k` NickName; `c` Category.
- Catalog top level: `{"meta": {...}, "proxies": [... ]}`. Regenerated from the live
  ComponentServer; never hand-edited.

### WireOp
`(src_node, src_param, dst_node, dst_param)` — the atomic unit of graph intent.

### GraphSpec
- `nodes: dict[node_id -> GraphNode]` where GraphNode = `{id, name, category, nickname, guid}`.
- `edges: list[WireOp]` — intended wires.
- `groups: dict[group_name -> [node_id]]`.

### LiveState (serialized live GH document)
- `nodes: dict[node_id -> LiveNode]` where LiveNode = `{id, name, error: bool, error_msg}`.
- `wires: list[LiveWire]` where LiveWire = `{src_node, src_param, dst_node, dst_param}`.

## 3. Interface Contracts

### 3.1 ProxyCatalog (F12-F06)
```
ProxyCatalog(catalog_path=None)
  .count -> int
  .get(guid) -> proxy dict | None
  .find(query, category=None, exact=False) -> list[proxy dict]   # ranked best-first
  .resolve(query, category=None, exact=False) -> guid str
  .categories() -> list[str]
  .summary() -> dict
find(query, category=None, exact=False)      # module-level, uses default catalog
resolve(query, category=None, exact=False)   # module-level
```
- **Invariant:** `resolve()` returns exactly one GUID or raises.
- **Errors:** `NotFoundProxyError` (0 hits); `AmbiguousProxyError` (>1 hit, carries
  `.candidates`). Callers MUST disambiguate via `category` and/or exact matching.
- **Ranking (find):** exact name+nickname (0) < exact name (1) < exact nickname (2) <
  substring (3); category filter applied first.

### 3.2 GHDefinitionBuilder (F12-F07)
```
GHDefinitionBuilder(catalog=None)
  .add_slider(name, value, minimum=0.0, maximum=10.0, step=0.1) -> node_id
  .add_component(name, category=None, nickname=None, params=None) -> node_id
  .connect(src_node, src_param, dst_node, dst_param) -> self
  .group(name, node_ids) -> self
  .validate(live_state=None) -> ValidationReport
  .save(path) -> path            # writes .ghspec JSON
  .spec -> GraphSpec
compile_single_shot(builder) -> str   # ONE IronPython script
```
- **Invariant:** `add_component` resolves the GUID via `catalog.resolve(name,
  category, exact=True)`; no GUID is ever a literal in caller code.
- **Errors:** propagates `AmbiguousProxyError` / `NotFoundProxyError` from resolve.
- **.ghspec JSON shape:** `{"format":"ghspec/1","nodes":[{id,name,category,nickname,guid}],
  "edges":[[s,sp,d,dp],...],"groups":{name:[ids]}}`.

### 3.3 Validator / Repairer (F12-F02, F12-F05)
```
validate_graph(spec: GraphSpec, live: LiveState) -> ValidationReport
compute_repair(spec, live) -> list[WireOp]
repair_graph(spec, live, executor=None) -> dict
```
- `ValidationReport` fields: `missing_wires`, `disconnected_inputs`,
  `disconnected_outputs`, `red_components`, `missing_components` (lists of
  `ValidationIssue(kind, node, param, detail)`), `issues` (flattened); properties
  `ok: bool`, `issue_count: int`; method `as_dict()`.
- `compute_repair` returns ONLY missing wires (set difference spec.edges - live.wires).
- `repair_graph` returns `{missing_wire_count, wire_ops, ironpython_script, applied,
  executor_output}`. When `executor` is None, no side effects occur (plan only) —
  auditable. **Invariant:** idempotent — after applying the emitted script, a second
  `compute_repair` returns `[]`.

### 3.4 Inspector + Bridge (F12-F04)
```
inspect_workspace(bridge) -> dict
capture_viewport(bridge, path, width=1600, height=1000)
capture_canvas(bridge, path, width=1600, height=1000)
```
- `inspect_workspace` returns:
  `{"grasshopper": {"components": int, "red": int, "red_names": [str], "wires": int},
    "rhino": {"objects": int, "meshes": int, "breps": int, "mesh_faces": int, "mesh_verts": int},
    "raw": str}`
- **Bridge contract (adapter):** any object exposing
  `execute(gh_script: str) -> str`. Recommended full adapter also exposes
  `new_definition()`, `load_definition(path)`, `solve()`, `bake()`,
  `screenshot(kind, path) -> path`. The bridge is the ONLY RhinoClaw-aware layer.

### 3.5 Module contract (F12-F09)
```
build(builder: GHDefinitionBuilder, params: dict) -> node_id   # returns the module's output node
```
- Every module receives a builder and a params dict, appends its nodes/edges to the
  shared GraphSpec, and returns its primary output node id so modules can chain.
- **Invariant:** modules never touch Grasshopper directly; they only call builder
  methods. This makes modules reusable and independently testable.

### 3.6 Product generator contract (F12-F10)
```
generate(params: dict) -> GenerationResult
```
- A generator composes modules (no direct GH authoring) and returns a
  `GenerationResult` (see 3.8).

### 3.7 Compliance engine (F12-F11)
```
evaluate(generation_result) -> ComplianceReport
```
- `ComplianceReport` shape:
  ```
  {"features": {"gyroid_lattice": bool, "parametric_controls": bool,
                "mounting_collar": bool, "printable_mesh": bool},
   "scores": {"controls": 0-100, "lattice": 0-100, "printability": 0-100,
              "geometry_integrity": 0-100},
   "total": 0-100}
  ```

### 3.8 Audit record — generation.json (F12-F13, F12-F14)
```
{
  "artifact_id": "<uuid>",
  "prompt": "<original natural-language prompt>",
  "generator": "<product generator name + version>",
  "modules": [{"name": "...", "version": "..."}],
  "parameters": {...},
  "graph_spec": {"nodes": N, "edges": M, "groups": G},
  "versions": {"proxy_catalog": "...", "gh_builder": "...", "modules": "...",
               "inspection_engine": "...", "rhinoclaw": "...", "grasshopper": "..."},
  "validation": {"ok": bool, "issue_count": int, "report": {...}},
  "geometry": {"mesh_exists": bool, "vertices": int, "faces": int, "volume": float,
               "bbox": [...]},
  "compliance_score": 0-100,
  "execution_time_sec": float,
  "generated_by": "<agent/user id>",
  "generated_at": "<ISO8601 UTC>",
  "rhino_file": "<path>",
  "gh_definition": "<path>",
  "evidence": {"viewport_png": "<path>", "canvas_png": "<path>"}
}
```
- **Traceability invariant:** every baked artifact is reproducible from this record
  (prompt + modules + parameters + versions + graph_spec).

## 4. Error Contracts

| Error | Raised by | Meaning | Caller action |
|-------|-----------|---------|---------------|
| `NotFoundProxyError` | `ProxyCatalog.resolve` | 0 catalog hits | check name/category spelling; regenerate catalog |
| `AmbiguousProxyError` | `ProxyCatalog.resolve` | >1 candidate | disambiguate via `category`/`exact`; inspect `.candidates` |
| `ValidationReport.ok == False` | `validate_graph` | graph defects present | run `repair_graph` or fix spec |
| `RuntimeError` (bridge) | `Bridge.execute` | transport/session failure | Recovery Supervisor (F12-F15) resumes |

## 5. Verification

- Contract tests assert signatures, return shapes, error types, and invariants
  (resolve raises on ambiguity; repair idempotent; module build returns node id;
  generation.json contains all traceability fields).
- Offline tests cover pure-logic contracts; integration tests (live host) cover the
  bridge adapter and geometry gates.

## 6. Gates

- ste-lint, openspec validate, pytest, IDD contract tests, CI continuous validation.

## 7. Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-10-26 | Initial interface contracts. |
