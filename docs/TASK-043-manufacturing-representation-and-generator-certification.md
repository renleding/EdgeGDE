---
id: TASK-043
title: Manufacturing Representation and Generator Certification
status: proposed
owner: Hermes (Director)
created: 2026-10-29
updated: 2026-10-29
depends_on: [TASK-037, TASK-040, TASK-041]
governs:
  - .hermes/logs/missions/task-037/
  - .hermes/logs/missions/task-040/
  - .hermes/logs/missions/task-041/
implements: []
verification:
  - checksum manifests present and verified for task-037 / 040 / 041
  - topology gate defined and evaluated against candidate_5M.stl
  - generator provenance established for the certified product
  - manufacturing envelope verdict recorded against named printer profiles
gates: [topology-gate, envelope-gate, provenance-gate]
changelog:
  - {version: "1.0.0", date: "2026-10-29", note: "Initial brief. Corrects face-count and certification errors in the pre-brief discussion; replaces the proposed triangle-budget guard with a topology gate."}
---

# TASK-043 — Manufacturing Representation and Generator Certification

## 0. Objective

Establish, from evidence, **what the certified product actually is, what produced it,
and what a valid manufacturing representation of it must satisfy** — before any
component in the Grasshopper definition is repaired or removed.

This task does not repair the graph. Repair is out of scope and is explicitly deferred.

## 1. Corrections this brief exists to carry

Four errors entered the discussion before this brief and must not propagate into
implementation:

| # | Claim as circulated | What the evidence says | Source |
|---|---|---|---|
| 1 | "Candidate B = 5 M faces" | Candidate B is **80,515,998 faces / 4,025.8 MB**. The 5 M / −0.145 % artifact is a **remeshed derivative** (Candidate D). Two table rows were merged; the error is 16×. | `task-040/manufacturing_practicality_report_v2.json` |
| 2 | "Candidate B is a certified manufacturing representation" | Its certification was computed in index space, and an STL has no indices. After position welding: 865 over-used edges; the slicer reports `manifold: no`, 180 non-manifold edges, **16 parts**. `single_body: true` is refuted. | `task-040/production_candidate_B.json` vs `task-041/weld_diagnosis.json` |
| 3 | "TASK-041 ruled it NOT CERTIFIED" | The Phase 5 verdict string exists **only in `task041_reports_final.py`**; the JSON was never written (the run died during `slice_abs`). Cite the topology numbers, not the label. | `task-041/MANIFEST.md`, known-gap section |
| 4 | "Guard at 5,000,000 triangles" / "below 2,000,000" | Facet count does not predict the failure. BambuStudio consumes 5 M facets in **4.2 s at 1.3 GB RSS**; Rhino/GH stalls on the same order of geometry. A 5 M gate permits the crash; a 2 M gate blocks the only production-practical candidate. Both are withdrawn. | `task-041/import_validation_report.json` |

## 2. Phase 0 — Preservation (COMPLETE)

Evidence frozen 2026-10-29 with SHA-256 manifests:

```
.hermes/logs/missions/task-037/   21 files, 3.3 GB   SHA256SUMS.txt + MANIFEST.md
.hermes/logs/missions/task-040/   29 files, 552 MB   SHA256SUMS.txt + MANIFEST.md
.hermes/logs/missions/task-041/   30 files, 1.3 GB   SHA256SUMS.txt + MANIFEST.md
```

Provenance scripts (`task03X_*.py`, `task04X_*.py`) copied from
`.hermes/cache/scratch/` into the same directories so each artifact sits beside the code
that produced it.

**Open retention risk:** `.hermes/logs/` is gitignored (`.gitignore:21`). These 5.2 GB
are protected against mutation by checksum but **not against deletion**, and are not in
version control. Phase 6 addresses this.

## 3. Phase 1 — Forensics

Purpose: separate "the file is bad" from "the process ran out of something", which has
never been established. No conclusion about the crash is to be drawn before this phase.

1. Record the exact filenames and byte sizes of the `.3dm` and `.gh`/`.ghx` that crash.
2. Partition test on pc2:
   - **A.** Rhino in plugin-safe mode (Shift at launch), GH not loaded, open the `.3dm`.
     - Survives → the file is not the cause; GH is in the loop.
     - Dies → file or memory, continue to 4.
   - **B.** If A survives: enable GH, `Solutions → Disable Solver`, then open the `.gh`.
     - Loads with solver off → the crash is in solve.
     - Dies on load → serialisation or a component deserialise path.
3. Windows Event Viewer → Application, entries at crash time for `Rhino.exe` /
   `.NET Runtime`. Capture **faulting module** and **exception code**
   (e.g. `0xc0000005` access violation, `0xe0434352` managed exception) verbatim.
4. pc2 RAM total, and whether a pagefile is configured.
5. Whether these files **ever** opened successfully, and what changed in between.

Exit criterion: a written statement of which of {file size, topology, solve-time memory,
component fault, corrupt undo record} is ruled in and which is ruled out, each tied to an
observation.

## 4. Phase 2 — Graph health audit and classification

Enumerate every red/orange component in the definition. For each, record the component's
**own error text** — colour alone means "error exists", not which one or why.

Classify each into exactly one bucket before touching anything:

- **CRITICAL** — its failure prevents the product from existing.
- **LEGACY** — not on the path to the product, retained for historical reasons.
- **DEAD BRANCH** — produces nothing that any downstream component consumes.

Already established from TASK-040's ownership report, and to be confirmed rather than
re-derived:

| Component | Registered output | Status |
|---|---|---|
| `Gyroid IsoMesh` | empty mesh, volume 0 | produces nothing |
| `Gyroid Scalar Field` | no geometry output | produces nothing |
| `Union All` | **zero output recipients** | nothing consumes it |
| `Cylinder` | 300×300×300 Brep, volume 0 | not the product |
| `Top Dome` | 20 mm mesh, 4,019 mm3 | not the product |
| `Mount Collar` | 80 mm disc, no bore | not the product |

Note the consequence: **Union All is not a performance problem, it is an orphan.** It is
to be removed as a product-definition correction — because nothing downstream consumes
it — and not as a performance fix. That distinction matters because it is now the only
justification for removing it that the evidence supports.

## 5. Phase 3 — The gate that replaces the triangle budget

The failure mode is topological, not volumetric. Define and enforce:

```
REFUSE_TO_EXPORT_OR_BOOLEAN when any of:
    non_manifold_edges      > 0
    open_edges              > 0
    components              > 1
    zero_area_facets        > 0
    repeated_corner_facets  > 0
    enclosed_volume_mm3     < 0.98 * 1,423,008
```

Every clause is already computed by the tooling that produced TASK-041, and the whole
check runs in seconds. No facet-count ceiling is to be introduced.

Measured against the current 5 M candidate: **FAILS** on non-manifold edges (180 slicer /
865 pre-correction), components (16), zero-area facets (654), repeated-corner facets
(652). It passes import in 4.2 s and passes volume (−0.145 %) — which is precisely why a
size-based guard would never have caught it.

Gate must **fail closed**: missing or unreadable input ⇒ BLOCKED, never SAFE.

## 6. Phase 4 — Manufacturing envelope audit

Certified geometry is not the same as a printable object. Mandatory check on every
candidate:

- Measure X, Y, Z of the exported solid.
- Compare against each named printer profile and record FITS / DOES NOT FIT with the
  profile's actual build volume.

Established: candidate is **151.847 × 151.767 × 375.996 mm**. Stock Bambu build volumes
are A1/X1/X2D Z=256, H2S Z=340, H2D Z unset. **It does not fit any of them.** The
400×400×420 profile used in TASK-041's slice test was synthesised for that test and is
not a printer that exists in the environment.

This is a product constraint, not a mesh defect, and it belongs in the record rather than
in discussion. Whether the product is scaled, split, or a machine is specified, is a
decision for the owner — the task's obligation is to surface it.

## 7. Phase 5 — Generator provenance

TASK-040's ownership verdict, verbatim:

> EXTERNAL PYTHON. The certified product is produced entirely by `task034_engine.py` /
> `task037_converge.py`. The Grasshopper definition generates a 300 mm cylinder envelope,
> a 20 mm dome, an 80 mm collar disc and an empty gyroid mesh, and none of its outputs
> are consumed by a union. Certification does not depend on Grasshopper in any way.

`task037_converge.py` is now preserved in `task-037/`. **`task034_engine.py` is not
present anywhere in the mission tree or in `.hermes/cache/scratch/`.** The certified
product therefore exists in a form nobody can currently regenerate.

Required output of this phase: the exact code path that produced the certified defining
field — file, function, parameter set, and the random seed or numerical settings if any
affect the result — or a statement that it cannot be established, which is itself a
finding.

The repo's own builder is not that path: `tools/lamp_shade_gh_builder.py` contains a
stubbed gyroid block (line 282, `# ... sampling logic would go here`). Whatever generated
the product is neither that file nor anything currently under version control.

## 8. Phase 6 — Durability of evidence

Move or mirror the frozen evidence into a version-controlled location, or record an
explicit owner decision to keep it local. 5.2 GB is large for git; LFS, R2, or a
manifest-only commit with the binaries retained locally are all acceptable — silently
leaving it gitignored is not.

## 9. Explicit non-goals

- No component repair.
- No triangle-budget guard, at any threshold.
- No changes to the certified field definition or its parameters.
- No new decimation pass until Phase 3's gate exists — decimation is what damaged the
  topology in the first place (654 zero-area facets, 652 repeated-corner facets), and
  running it again without a check reproduces the same defect.

## 10. Acceptance criteria

The task is complete when all six hold:

1. Checksum manifests for task-037/040/041 verify (`shasum -a 256 -c SHA256SUMS.txt`).
2. A cause statement for the Rhino/GH crash, with ruled-in and ruled-out branches, each
   tied to a named observation.
3. Every red/orange component carries an error text and exactly one classification.
4. The topology gate is specified, tested against `candidate_5M.stl`, and fails closed.
5. An envelope verdict exists per named printer profile, including the observation that
   the product currently fits none.
6. The certified product's generating code path is identified and archived, or its
   unrecoverability is recorded as a blocking finding.

## 11. Known open items inherited

- Point-to-surface Hausdorff check outstanding; current fidelity metric has a ~0.3–0.4 mm
  floor.
- Sheet thickness: 1.104 mm realised against 1.200 mm requested — an 8 % generator defect
  that every representation faithfully reproduces.
- `task041_reports_final.py` Phase 4/5 never completed; do not re-run blind, it depends on
  the 4 GB native STL and BambuStudio CLI state.
- pc2 was not auditable during TASK-041 (SSH 22 timeout); nothing is claimed about its
  slicers or toolchain.
