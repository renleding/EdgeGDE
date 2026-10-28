---
id: FRS-014
title: Visual Geometry Verification & Closed-Loop Design Validation
status: proposed
owner: Hermes (Director)
created: 2026-10-26
updated: 2026-10-26
depends_on: [FRS-011, FRS-012, FRS-013]
governs: [tests/test_frs014_closed_loop_validation.py, inspection/]
implements: []
verification: [test_frs014_closed_loop_validation.py (10 phases, evidence artifacts)]
gates: [ste-lint, openspec validate, pytest]
changelog:
  - {version: "1.0.0", date: "2026-10-26", note: "Initial 10-phase visual/geometric closed-loop validation spec."}
---

# FRS-014 — Visual Geometry Verification & Closed-Loop Design Validation

> NUMBERING CAVEAT (2026-10-26): macOS TCC read-block on `~/Documents` prevented the
> mandatory `ls docs/ | grep FRS-` collision check. User directive named this FRS-014.
> `write_file` refuses to clobber existing same-named files, so no overwrite occurred.

## 1. Purpose

FRS-011/012/013 proved the system can build graphs, wire them, solve, and bake. Those
checks do NOT prove the generated geometry matches the intended design — a valid graph
can still produce incorrect geometry. FRS-014 establishes the visual, geometric, and
parametric validation requirements that prove the artifact IS the intended design,
via a 10-phase executable harness with machine-readable evidence.

## 2. Scope

In scope: baseline inspection, control discovery, height/twist modification tests,
gyroid existence proof, density sensitivity, union preservation, bake validation,
closed-loop optimisation to a target dimension, multi-variant design exploration with
automatic winner selection. Out of scope: graph authoring (FRS-011/012), recovery
framework (FRS-012 P5).

## 3. Glossary

- **inspect_workspace** — evidence bundle: scene_summary, viewport.png, canvas.png,
  geometry_metrics (per-output bbox), mesh_stats, feature compliance.
- **height proxy** — the Z-size of the output geometry with the largest Z extent
  (the lamp shell), measured from the LIVE solved graph (no bake needed).
- **viewport_difference_detected** — sha256 of captured viewport PNG differs between
  two states (vision feedback proxy; exact pixel diff is a future enhancement).
- **feature compliance** — evidence-based booleans: gyroid_lattice, parametric_controls,
  mounting_collar, printable_mesh.

## 4. Requirements (10 phases)

Each phase has a named failure code; a phase passes only with geometry evidence.

| ID | Phase | Requirement (SHALL/MUST) | Failure code |
|----|-------|--------------------------|--------------|
| F14-F01 | 1 Baseline | inspect_workspace SHALL capture viewport.png, canvas.png, scene_summary, geometry_metrics into inspection/baseline/. | INSPECTION_FAILED |
| F14-F02 | 2 Control discovery | System SHALL identify Height, Diameter, Twist_Angle, Gyroid_Cell_Size, Gyroid_Thickness; control_count SHALL be >= 5. | CONTROL_DISCOVERY_FAILED |
| F14-F03 | 3 Height mod | Height*2 SHALL increase bbox Z (bbox_after.z > bbox_before.z) AND viewport_difference_detected SHALL be true. | GEOMETRY_UNCHANGED |
| F14-F04 | 4 Twist mod | Twist_Angle 45→180 SHALL produce visual_difference_detected AND geometry_difference_detected. | TWIST_NOT_APPLIED |
| F14-F05 | 5 Gyroid verify | gyroid_mesh_count>0, gyroid_vertices>0, gyroid_faces>0 SHALL hold; gyroid_only.png captured. | GYROID_NOT_GENERATED |
| F14-F06 | 6 Density sensitivity | Gyroid_Cell_Size 20 vs 80 SHALL yield face_count_A != face_count_B AND visual_difference_detected. | PARAMETER_HAS_NO_EFFECT |
| F14-F07 | 7 Union validation | Union All output SHALL contain gyroid geometry (union_output_contains_lattice=true); input/output counts reported. | LATTICE_LOST_IN_UNION |
| F14-F08 | 8 Bake validation | baked_mesh_count>0, baked_face_count>0, lattice_visible_in_viewport=true. | BAKE_FAILED |
| F14-F09 | 9 Closed-loop optimisation | From Height=100, system SHALL auto-iterate (inspect→measure→adjust→solve) to 500±5mm within 10 iterations, no human intervention. | OPTIMISATION_FAILED |
| F14-F10 | 10 Multi-variant | System SHALL generate 5 variants, evaluate height/volume/lattice_density/printability, emit ranking_report.json, and auto-select best_variant. | DESIGN_SELECTION_FAILED |

## 5. Scenarios

### Scenario: Height change is detected (F14-F03)
- **Given** the lamp definition with Height=300 and a solved shell output
- **When** Height is set to 600 (slider range extended if needed) and the graph is solved
- **Then** the height-proxy bbox Z after > before
- **And** the viewport PNG sha256 differs from baseline

### Scenario: Gyroid existence is proven, not assumed (F14-F05)
- **Given** a solved graph
- **When** the Gyroid IsoMesh output is measured
- **Then** mesh_count>0, vertices>0, faces>0
- **And** if any is 0, the phase FAILS with GYROID_NOT_GENERATED (graph success ≠ geometry success)

### Scenario: Closed loop reaches target without intervention (F14-F09)
- **Given** Height=100 and target 500±5
- **When** the loop reads geometry, adjusts the slider, solves, re-measures
- **Then** within 10 iterations measured height ∈ [495, 505]
- **And** every iteration is recorded in the evidence trace

## 6. Test harness

- File: `tests/test_frs014_closed_loop_validation.py`
- Execution: `python tests/test_frs014_closed_loop_validation.py`
- Expected runtime: < 5 minutes (healthy session)
- Emits: `inspection/{baseline,height_test,twist_test,gyroid_test,density_test,union_test,bake_test,optimisation_test}/`, `ranking_report.json`, `inspection.json`, `inspection.md`

## 7. Verification

- Each phase asserts its acceptance predicate and records pass/fail + evidence.
- Harness SHALL fail fast and honestly on session wedge (RHINO_BUSY) — reporting
  SESSION_WEDGED with cause + recovery, never fabricating a pass.
- Gyroid/density/union/bake phases require real geometry counts; zero counts FAIL.

## 8. Gates

- ste-lint, openspec validate, pytest, harness run (all 10 phases green).

## 9. Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2026-10-26 | Initial 10-phase spec. |
