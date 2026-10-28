---
id: FRS-012
title: Production & Enterprise Readiness Roadmap
status: accepted
owner: Hermes (Director)
created: 2026-10-26
updated: 2026-10-26
depends_on: [FRS-011]
governs: [packages/gh_automation_core, tests/, proxy_catalog.json, docs/FRS-012]
implements: []
verification: [pytest harness, inspect_workspace, compliance engine, golden regression]
gates: [ste-lint, openspec validate, pytest]
changelog:
  - {version: "1.0", date: "2026-10-26", note: "Initial 5-phase roadmap: production readiness, scaling, reusable platform, design intelligence, enterprise architecture."}
---

# FRS-012 — Production & Enterprise Readiness Roadmap

> NUMBERING CAVEAT (2026-10-26): a macOS TCC read-block on `~/Documents` prevented the
> mandatory `ls docs/ | grep FRS-` collision check before authoring. The user directive
> named this FRS-012. If a `docs/FRS-012-*` (agentic-SDLC Droid executor) already exists
> on main, renumber this file to FRS-013 and update `depends_on`/cross-references.
> `write_file` refuses to clobber a same-named file, so no overwrite occurred.

## 1. Purpose

Move the Hermes → RhinoClaw → Grasshopper platform from a working prototype to a
production-grade and eventually enterprise-grade autonomous design system. The
roadmap is a capability ladder: each phase has an explicit acceptance gate, and no
phase is considered complete until its gate passes with evidence.

The governing principle (carried from FRS-011): **graph generation success is never
conflated with geometry generation success.** A definition that loads and solves to a
smooth shell is a failed result if no lattice geometry exists.

## 2. Scope

In scope: automation hardening, deterministic validation harness, self-healing, live
proxy catalog, GH definition builder, single-shot compilation, reusable module library,
product generators, feature-compliance engine, regression testing, versioning, audit
logging, traceability, recovery, continuous validation.

Out of scope: changes to Rhino/Grasshopper products; changes to the RhinoClaw wire
protocol (consumed as-is via the bridge adapter).

## 3. Glossary

- **GraphSpec** — declarative target graph (nodes + intended edges); the single source of truth for what a definition SHOULD contain.
- **LiveState** — serialized snapshot of a live Grasshopper document (nodes, error flags, wires).
- **WireOp** — one intended wire: `(src_node, src_param, dst_node, dst_param)`.
- **ProxyCatalog** — authoritative lookup over the live Grasshopper ComponentServer proxies.
- **Single-shot** — build graph in memory → one IronPython execution → save once → solve once.
- **Module** — a reusable, parameterized GraphSpec fragment (e.g. GyroidField, TwistModifier).
- **Compliance score** — per-generation feature-conformance percentage.

## 4. Requirements

Requirement keywords follow RFC 2119. Each requirement is verifiable.

### Phase 1 — Production Readiness

Goal: prove the system works reliably without human intervention.

| ID | Requirement | Verification |
|----|-------------|--------------|
| F12-F01.1 | The system SHALL generate Grasshopper definitions automatically from a GraphSpec. | test_graph_generation |
| F12-F01.2 | The system SHALL create all components automatically (no manual component placement). | test_graph_generation |
| F12-F01.3 | The system SHALL create all wires automatically (no manual wiring). | test_self_healing, test_graph_generation |
| F12-F01.4 | Save/reload cycle SHALL preserve graph integrity (nodes, edges, groups). | test_save_reload |
| F12-F01.5 | No manual Grasshopper edits SHALL be required for any supported generation. | inspect_workspace red/wire audit |
| F12-F02.1 | Graph validation SHALL pass with 0 issues on a conforming definition. | test_validation |
| F12-F02.2 | Validation SHALL report 0 disconnected inputs. | test_validation |
| F12-F02.3 | Validation SHALL report 0 disconnected outputs. | test_validation |
| F12-F02.4 | Validation SHALL report 0 missing components. | test_validation |
| F12-F02.5 | Validation SHALL report 0 missing wires. | test_self_healing |
| F12-F03.1 | Geometry SHALL be generated (mesh/brep outputs non-empty). | test_geometry_generation |
| F12-F03.2 | Generated geometry SHALL be valid (non-null, positive volume where applicable). | test_geometry_generation |
| F12-F03.3 | Geometry SHALL be bakeable to the Rhino document. | test_bake_pipeline |
| F12-F03.4 | Baked geometry SHALL survive a save/reload cycle. | test_save_reload |
| F12-F04.1 | `inspect_workspace()` SHALL return a structured report and pass on a healthy session. | test_inspection |
| F12-F04.2 | Viewport screenshots SHALL be captured to a path. | test_inspection |
| F12-F04.3 | Canvas screenshots SHALL be captured to a path. | test_inspection |
| F12-F04.4 | A validation report SHALL be generated per generation. | test_inspection |
| F12-F05.1 | Deterministic generation: generating the same lamp 3 times SHALL yield identical components, wires, geometry, and outputs. | test_graph_generation |
| F12-F05.2 | Save/reload verification SHALL pass validation after reload. | test_save_reload |
| F12-F05.3 | Self-healing: after deleting a random wire, `repair_graph()` SHALL restore it and validation SHALL report 0 missing wires. | test_self_healing |
| F12-F05.4 | Geometry verification SHALL assert mesh exists, faces>0, vertices>0, volume>0. | test_geometry_generation |

### Phase 2 — Production Scaling

Goal: increase speed and robustness.

| ID | Requirement | Verification |
|----|-------------|--------------|
| F12-F06.1 | `proxy_catalog.json` SHALL be auto-generated from the live Grasshopper ComponentServer proxies (no hand-editing). | catalog regeneration script |
| F12-F06.2 | The catalog SHALL provide `find(query)` and `resolve(query)` lookup by name/nickname/category. | test harness (ProxyCatalog) |
| F12-F06.3 | No hardcoded component GUIDs SHALL appear in generation code; all GUIDs resolve via the catalog. | grep gate + resolve() |
| F12-F06.4 | Lookup SHALL be ambiguity-safe: `resolve()` SHALL raise `AmbiguousProxyError` when >1 candidate remains, never silently pick. | test harness |
| F12-F07.1 | A GH Definition Builder SHALL expose `add_slider()`, `add_component()`, `connect()`, `group()`, `save()`, `validate()`. | test harness (GHDefinitionBuilder) |
| F12-F07.2 | The builder SHALL be the sole graph authoring engine. | architecture gate |
| F12-F08.1 | Generation SHALL use single-shot compilation: build graph in memory → one IronPython execution → save once → solve once. | compile_single_shot |
| F12-F08.2 | Single-shot SHALL target a 10–100x speed improvement over per-component create/redraw. | benchmark (Phase 2 exit) |

### Phase 3 — Reusable Design Platform

Goal: stop generating lamps; start generating reusable design systems.

| ID | Requirement | Verification |
|----|-------------|--------------|
| F12-F09.1 | A module library SHALL provide reusable modules: ProfileGenerator, RevolvedShell, TwistModifier, WaveModifier, GyroidField, LatticeMesher, TopClosure, MountingCollar, InspectionModule, ExportSTL. | module tests |
| F12-F09.2 | Each module SHALL expose a uniform `build(builder, params)` contract and be build-once/reuse-forever. | IDD contract test |
| F12-F10.1 | Product generators (LatticeLampGenerator, DiffuserGenerator, VaseGenerator, FacadeGenerator, SconceGenerator) SHALL be assembled from modules. | generator tests |
| F12-F10.2 | Product generators SHALL contain no direct Grasshopper authoring — only module composition. | grep gate |

### Phase 4 — Design Intelligence

Goal: validate design intent, not just geometry.

| ID | Requirement | Verification |
|----|-------------|--------------|
| F12-F11.1 | A feature-compliance engine SHALL emit per-generation JSON (e.g. gyroid_lattice, parametric_controls, mounting_collar, printable_mesh booleans). | compliance tests |
| F12-F11.2 | Each generation SHALL receive a compliance score with per-axis percentages (controls, lattice, printability, geometry integrity). | compliance tests |
| F12-F11.3 | Reference ("golden") designs SHALL be maintained (golden_lamp_v1, golden_vase_v1, golden_diffuser_v1). | golden fixtures |
| F12-F11.4 | All future generations SHALL be compared automatically against golden references (regression). | regression runner |

### Phase 5 — Enterprise Architecture

Goal: support multiple projects, agents, versions, and users.

| ID | Requirement | Verification |
|----|-------------|--------------|
| F12-F12.1 | The architecture SHALL be versioned (ProxyCatalog vX, GHBuilder vX, Module Library vX, Inspection Engine vX). | version registry |
| F12-F12.2 | Every generation SHALL report the versions used. | generation.json |
| F12-F13.1 | Every generation SHALL emit `generation.json` audit log (prompt, modules, parameters, versions, execution_time, compliance_score). | audit test |
| F12-F14.1 | Every artifact SHALL be traceable: who generated it, which prompt, which graph, which modules, which versions. | traceability test |
| F12-F14.2 | Generation SHALL be fully reproducible from the audit record. | replay test |
| F12-F15.1 | The system SHALL resume automatically after Rhino crash, Grasshopper crash, RhinoClaw disconnect, or network interruption. | recovery test |
| F12-F16.1 | A continuous-validation pipeline SHALL run on code change: generate test designs → validate graphs → validate geometry → compliance checks → pass/fail. | CI gate |

### Maturity Targets

| ID | Requirement | Verification |
|----|-------------|--------------|
| F12-F17.1 | Production grade SHALL require: deterministic generation, save/reload verification, self-healing, geometry validation, automated inspection, zero human intervention; target 95/100 reliability. | Phase 1 gate |
| F12-F17.2 | Enterprise grade SHALL add: reusable module library, versioning, audit logging, traceability, recovery, continuous validation, multi-project scalability; target 99.9% reliability and repeatability. | Phase 5 gate |

## 5. Scenarios

### Scenario: Self-healing restores a deleted wire (F12-F05.3)
- **Given** a conforming GraphSpec with edge `c1.Circle -> e1.Base`
- **When** the live document has that wire deleted
- **Then** `compute_repair(spec, live)` returns exactly that WireOp
- **And** `repair_graph(spec, live)` emits an auditable IronPython script
- **And** after applying, `validate_graph(spec, live).ok == True`
- **And** a second `compute_repair` returns zero ops (idempotent)

### Scenario: Ambiguous component is never silently resolved (F12-F06.4)
- **Given** the live catalog contains 3 components nicknamed "Bounding Box"
- **When** `resolve("Bounding Box")` is called without a category
- **Then** `AmbiguousProxyError` is raised listing the candidates
- **And** `resolve("Bounding Box", category="Surface", exact=True)` still requires disambiguation if >1 Surface Bounding Box exists

### Scenario: Geometry absence is a failure, not a success (F12-F05.4)
- **Given** a definition that solves to a smooth shell with zero lattice
- **When** the geometry verification runs
- **Then** mesh faces == 0 → test fails
- **And** the generation is NOT reported successful

## 6. Verification

- Offline (pure logic): validate_graph, compute_repair, repair_graph idempotency, ProxyCatalog find/resolve/ambiguity, builder spec construction, save/reload round-trip, inspect._parse.
- Online (integration, requires live RhinoClaw session): graph generation against real Grasshopper, save/reload of .ghpy, geometry generation (gyroid iso-mesh faces>0), bake pipeline, inspect_workspace against a live document.
- Evidence standard: every gate produces a machine-readable artifact (JSON report, screenshot, or catalog dump).

## 7. Gates

- **ste-lint**: FRS/SDD/IDD structural lint (header block, RFC 2119 table form, changelog).
- **openspec validate**: spec format + scenario coverage.
- **pytest**: Phase 1 harness (pure-logic tests must pass offline; integration tests skip without a live host).
- **grep gate**: no hardcoded component GUIDs in generation code (all GUIDs via ProxyCatalog).
- **CI**: continuous validation (F12-F16.1) runs the harness on every change.

## 8. Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-10-26 | Initial 5-phase roadmap. |
