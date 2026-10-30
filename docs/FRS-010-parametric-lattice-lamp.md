# FRS-010: Parametric Lattice Lamp Generator — Two-Layer Architecture

**Status**: PROPOSED → **ARCHITECTURAL DECISION v1.0**
**Version**: 1.2.0
**Author**: Hermes (Director)
**Date**: 2026-10-30
**Related**: FRS-008, FRS-009, FRS-011, IDD-010, IDD-011
**Supersedes**: FRS-010 v1.1.0 (adopts Option B dual-block panel)

---

## 1. Objective (Updated)

Build a **two-layer parametric lattice lamp system**:

| Layer | Role | Technology | Output |
|-------|------|------------|--------|
| **Layer 1: Design Authoring** | Parameter UI, visual feedback, design exploration | Grasshopper (manual authoring) | **Design Intent Package** (JSON, 12 Product DNA parameters) |
| **Layer 2: Certified Geometry Engine** | Deterministic geometry generation, topology certification, manufacturing validation | Python (`task034_engine.py`) | **Certified Geometry** (3DM for Rhino, STL for manufacturing) |

**Grasshopper NO LONGER produces final geometry.** It is a Design Studio: it authors intent and declares it. The certified Python generator (`packages/generator-certified/task034_engine.py`) is the single source of truth for manufacturing geometry.

---

## 2. Architectural Decision Record

### ADR-2026-10-30: Two-Layer Architecture

**Context**: TASK-043 proved the Grasshopper definition has an architectural mismatch with the certified Python generator:
- GH: Coordinate Grid → Gyroid Equation → IsoSurface (gyroid-only, 41× volume gap)
- Python: Wall SDF + Gyroid SDF + Collar SDF + Dome SDF → smin/smax field composition → Marching Cubes

**Decision**:
1. Freeze GH as a parameter authoring UI only
2. Python generator is authoritative for all manufacturing geometry
3. Parameter schema MUST match between GH sliders and Python BASE dict
4. GH exports Design Intent Package → Python consumes it → Certified Geometry

**Consequences**:
- Geometry pipeline requirements move from GH to the Python generator spec
- GH requirements reduce to Product DNA exposure + Preview/Publish Design + Current Design panel
- Inspection validates the GH Design Studio and the Python output as separate layers
- Manufacturing validation (TASK-044+) uses Python generator output only

### ADR-2026-10-30-b: Current Design Panel is a Product Configurator

**Context**: The original "parameter list" panel read as a debug readout and did not tell a designer what state their design was in, which package had been published, or which engine would manufacture it.

**Decision**: Replace the plain value list with a single read-only, monospaced **product configurator dashboard** that renders seven blocks in fixed order — Status, Published, Design Package, Product DNA, Preview Quality, Certified Geometry, Current Layer, Architecture — and that derives its Status from a three-state machine (DRAFT / READY / PUBLISHED).

**Consequences**:
- The panel is the single authoritative on-canvas statement of design state
- Status is computed from a parameter fingerprint, not from a manual flag
- Publish metadata persists across save/reopen via a sidecar JSON
- The panel displays only parameters the certified engine actually consumes

---

## 3. Current State (Updated)

| Component | Status | Role |
|-----------|--------|------|
| RhinoClaw TCP transport | ✅ Working (port 1999) | Layer 1 transport |
| Auth & Hermes bridge | ✅ Working | Layer 1 transport |
| Native GH commands | ✅ Working | Layer 1 automation |
| Recipe system | ❌ Broken | Not needed (bypassed) |
| **GH Parametric Definition** | ✅ **Repaired (TASK-043)** | **Layer 1: 12 sliders + Design Intent Package** |
| **Python Generator** | ✅ **Certified (TASK-037)** | **Layer 2: Authoritative geometry** |
| **Unified Workspace Inspection** | ⚠️ **Redefined** | Validates Layer 1 UI + Layer 2 output |

---

## 4. Layer 1: Grasshopper Design Studio

### 4.1 Product DNA (12 Required — Aligned with Python BASE Dict)

| Parameter | Type | Range | Default | Python BASE Key | Description |
|-----------|------|-------|---------|-----------------|-------------|
| `Height` | Float | 100–500 mm | 300 | `height` | Overall lamp height |
| `Diameter` | Float | 50–300 mm | 150 | `diameter` | Outer diameter at widest point |
| `Twist_Angle` | Float | 0–180° | 45 | `twist_deg` | Total helical twist from base to top |
| `Wall_Thickness` | Float | 1–10 mm | 1.6 | `wall_mm` | Structural wall thickness |
| `Gyroid_Cell_Size` | Float | 2–20 mm | 8.0 | `gyroid_cell` | TPMS gyroid unit cell dimension |
| `Gyroid_Thickness` | Float | 0.5–5 mm | 1.2 | `sheet_mm` | Gyroid sheet thickness |
| `Band_Width` | Float | 0–50 mm | 25.0 | `band_mm` | Gyroid band width from surface |
| `Bore_Diameter` | Float | 10–100 mm | 35.0 | `bore_diameter` | Central bore diameter |
| `Collar_Height` | Float | 0–100 mm | 30.0 | `collar_height` | Mounting collar height |
| `Dome_Height` | Float | 0–50 mm | 20.0 | `dome_height` | Top dome height |
| `Top_Closure_Ratio` | Float | 0–1.0 | 0.8 | — | Aperture ratio (visual only) |
| `Voxel_Resolution` | Float | 0.2–1.0 mm | 0.30 | `voxel_mm` | Marching cubes resolution |

**Key Changes from v0.3.0**:
- Removed: `Wave_Amplitude`, `Wave_Frequency`, `Interference_Density`, `Helical_Offset`, `Bulb_Concealment`, `Mount_Diameter` (not in Python BASE)
- Added: `Band_Width`, `Bore_Diameter`, `Collar_Height`, `Dome_Height`, `Voxel_Resolution`
- Ranges/defaults aligned with Python BASE dict and the TASK-037 convergence study

### 4.1.1 Design Studio Parameters (Not in Certified Engine)

These six parameters are **design vocabulary, not geometry inputs**. They are retained on the canvas and shown in the panel for design exploration and forward compatibility, but the certified generator does not consume them. The panel MUST label them as non-authoritative.

| Parameter | Type | Range | Default | Consumed by certified engine |
|-----------|------|-------|---------|------------------------------|
| `Wave_Amplitude` | Float | 0–50 mm | 5.0 | **No** |
| `Wave_Frequency` | Float | 0.5–10 cycles | 3.0 | **No** |
| `Interference_Density` | Float | 0–1.0 | 0.30 | **No** |
| `Helical_Offset` | Float | 0–1.0 | 0.00 | **No** |
| `Bulb_Concealment` | Float | 0–100 % | 50 | **No** |
| `Mount_Diameter` | Float | 10–60 mm | 40.0 | **No** |

Rules:

| ID | Requirement |
|----|-------------|
| FRS-010-47 | Studio parameters MUST NOT be exported into the Design Intent Package; the package MUST contain exactly the 12 certified keys plus `product` |
| FRS-010-48 | Studio parameters MUST NOT contribute to the certified fingerprint, so changing them MUST NOT invalidate a PUBLISHED state |
| FRS-010-49 | Studio parameters MUST be persisted in the publish-state sidecar so they survive save, close, and reopen |
| FRS-010-50 | The panel MUST state, in the studio block itself, that these parameters do not affect certified geometry |

### 4.2 GH Functional Requirements (Layer 1 Only)

| ID | Requirement |
|----|-------------|
| FRS-010-01 | GH definition MUST expose all 12 Product DNA parameters as named Number Sliders with ranges/defaults matching the Python BASE dict |
| FRS-010-02 | Parameters MUST be grouped logically (Geometry, Lattice, Manufacturing, Resolution) on the GH canvas |
| FRS-010-03 | Parameter changes MUST update the parameter display with no manual intervention |
| FRS-010-04 | GH MUST provide a **Preview Design** action — fast visual preview at a designer-friendly resolution (e.g. 38³ grid) |
| FRS-010-05 | GH MUST provide a **Publish Design** action — exports the Design Intent Package and triggers certified geometry generation |
| FRS-010-06 | GH geometry preview is OPTIONAL and NON-CERTIFIED — for visual feedback only |
| FRS-010-07 | GH MUST include a read-only **Current Design** panel (see 4.5) |

### 4.3 Parameter Export Contract — "Design Intent Package"

| ID | Requirement |
|----|-------------|
| FRS-010-08 | Publish Design MUST export all 12 parameters as JSON with exact keys matching the Python BASE dict, plus a `product` field |
| FRS-010-09 | Export path MUST be configurable (default: `C:/temp/lattice_lamp_params.json`) |
| FRS-010-10 | JSON format: `{"product":"LatticeLamp","height":300,"diameter":150,"twist_deg":45,"wall_mm":1.6,"gyroid_cell":8.0,"sheet_mm":1.2,"band_mm":25.0,"bore_diameter":35.0,"collar_height":30.0,"dome_height":20.0,"top_closure_ratio":0.8,"voxel_mm":0.30}` |
| FRS-010-11 | Publish Design MUST trigger Layer 2 certified geometry generation via a Hermes mission |
| FRS-010-12 | Preview Design MUST run a fast local preview (e.g. 38³ grid) without certification, without writing the Design Intent Package |

### 4.4 Responsibility Boundary (Non-Negotiable)

| Component | Responsible For | NOT Responsible For |
|-----------|-----------------|---------------------|
| Grasshopper (Design Studio) | Preview Design, Publish Design, export Design Intent Package, Current Design panel | Geometry generation, Python execution, geometry validation |
| Python (Certified Geometry Engine) | Generate geometry, validate geometry, produce 3DM and STL | Design authoring, viewport display |
| Bridge Layer | Read JSON, run `task034_engine.py`, load Certified 3DM, redraw viewport | Geometry decisions, design decisions |

| ID | Requirement |
|----|-------------|
| FRS-010-13 | The GH definition MUST NOT generate production geometry or execute geometry code |

### 4.5 Current Design Panel — Product Configurator

The panel is a single read-only, monospaced dashboard. It is the authoritative on-canvas statement of design state.

**Required render (PUBLISHED state):**

```
══════════════════════════════════════
          LATTICE LAMP V1
══════════════════════════════════════

Status
──────────────
PUBLISHED

Published
──────────────
2026-10-30 13:05

Design Package
──────────────
lattice_lamp_params.json

Certified Product DNA
──────────────
Height..............300.0 mm
Diameter............150.0 mm
Twist................45.0 °
Wall Thickness........1.6 mm
Cell Size.............8.0 mm
Sheet Thickness.......1.2 mm
Band Width...........25.0 mm
Bore Diameter........35.0 mm
Collar Height........30.0 mm
Dome Height..........20.0 mm
Top Closure..........0.80
Voxel Resolution.....0.30 mm

Design Studio Parameters
(Not in Certified Engine)
──────────────
Wave Amplitude........5.0 mm
Wave Frequency........3.0
Interference..........0.30
Helical Offset........0.00
Bulb Concealment.....50.0 %
Mount Diameter.......40.0 mm
─────────────────────
Does not affect
certified geometry

Preview Quality
──────────────
38 × 38 × 38

Certified Geometry
──────────────
Python Generator
(task034_engine.py)

Current Layer
──────────────
Lattice_Lamp_Certified

Architecture
──────────────
Design Studio
→ Design Intent Package
→ Certified Geometry Engine
→ Manufacturing Pipeline

══════════════════════════════════════
```

| ID | Requirement |
|----|-------------|
| FRS-010-14 | The panel MUST be a single read-only GH Panel with no input ports; designers MUST NOT be able to type into it |
| FRS-010-15 | The panel MUST render these blocks in this fixed order: Status, Published, Design Package, Certified Product DNA, Design Studio Parameters, Preview Quality, Certified Geometry, Current Layer, Architecture |
| FRS-010-16 | **Certified Product DNA** MUST list exactly the 12 certified parameters, in the order given in 4.1, each with unit suffix and dot-leader alignment |
| FRS-010-17 | **Design Studio Parameters** MUST be a separate block, visually distinguished from Certified Product DNA, headed `(Not in Certified Engine)` and closed with an explicit "does not affect certified geometry" note |
| FRS-010-51 | Studio parameters MUST NOT appear inside the Certified Product DNA block, and certified parameters MUST NOT appear inside the Design Studio block |
| FRS-010-52 | The two blocks MUST be visually distinguishable without relying on colour alone (separate heading, separate separator, explicit sub-header), so the distinction survives greyscale, colour-blindness, and printing |
| FRS-010-53 | A change to a studio-parameter slider MUST NOT alter Status, Published, or Design Package values |
| FRS-010-18 | The panel MUST reflect live slider values on every GH solve, with refresh < 200 ms |
| FRS-010-19 | The panel MUST derive Status from the three-state machine in 4.6, not from a manually set flag |
| FRS-010-20 | Published timestamp and Design Package filename MUST be shown only in the PUBLISHED state; otherwise `Not Published` and `Pending` respectively |
| FRS-010-21 | The panel MUST be placed immediately above the PUBLISH_DESIGN group on the canvas |
| FRS-010-22 | Parameter fingerprint MUST be SHA-256 of the canonical JSON of the 12 parameters rounded to 4 decimal places; it is the sole basis for state derivation |
| FRS-010-23 | Publish metadata MUST persist in a sidecar `lattice_lamp_publish_state.json` so status and timestamp survive save, close, and reopen |

### 4.6 Status State Machine

| State | Condition | Published block | Design Package block |
|-------|-----------|-----------------|----------------------|
| `DRAFT` | `current_fp ≠ published_fp` (including never published) AND `preview_fp ≠ current_fp` | `Not Published` / (last publish date if any) | `Pending` |
| `READY` | `preview_fp = current_fp` AND `current_fp ≠ published_fp` | `Pending` | `Pending` |
| `PUBLISHED` | `published_fp = current_fp` | ISO date-time of publish | filename of published package |

**Transitions**

| From | Event | To |
|------|-------|----|
| any | Slider value changes | `DRAFT` |
| `DRAFT` | Preview Design succeeds at current values | `READY` |
| `READY` | Publish Design succeeds at current values | `PUBLISHED` |
| `DRAFT` | Publish Design succeeds at current values | `PUBLISHED` |
| `PUBLISHED` | Slider value changes | `DRAFT` |

An empty or missing sidecar MUST render as `DRAFT` / `Not Published` / `Pending`, never as an error.

### 4.7 Dual Fingerprints

Two independent fingerprints exist, and only one of them governs Status.

| Fingerprint | Inputs | Governs | May invalidate PUBLISHED |
|-------------|--------|---------|--------------------------|
| `certified_fp` | the 12 certified parameters (4.1) | Status, Published, Design Package | **Yes** |
| `studio_fp` | the 6 studio parameters (4.1.1) | the studio block's advisory marker only | **No** |

| ID | Requirement |
|----|-------------|
| FRS-010-54 | The panel MUST compute and store both fingerprints separately |
| FRS-010-55 | The studio block MUST show an advisory marker, `matches published` or `changed since publish`, derived from `studio_fp` alone |
| FRS-010-56 | `certified_fp` MUST exclude studio parameters, so a studio-only edit leaves a PUBLISHED design PUBLISHED |

**Rationale**: the six studio parameters do not reach the generator. Treating them as status-bearing would force a designer to "republish" and would write a byte-identical Design Intent Package, teaching the user that publishing is meaningless. The advisory marker keeps the difference visible without corrupting the certification signal.

---

## 5. Layer 2: Python Certified Geometry Engine (Manufacturing Source)

### 5.1 Authoritative Generator

**Location**: `packages/generator-certified/task034_engine.py`

**Capabilities**:
- SDF composition: Wall + Gyroid + Collar + Dome via smin/smax (KS=0.30)
- Marching cubes extraction at configurable voxel resolution
- Convergence-validated at 0.30 mm (reference: 1,420,789 mm³)
- Topology-certified output (watertight, manifold, single-body)

### 5.2 Functional Requirements

| ID | Requirement |
|----|-------------|
| FRS-010-24 | **Base form**: tapered cylinder with twist (`twist_deg` drives phase along Z) |
| FRS-010-25 | **Lattice**: TPMS gyroid field `sin(Kx)cos(Ky)+sin(Ky)cos(Kz)+sin(Kz)cos(Kx)` with `K=2π/gyroid_cell`, thickness `sheet_mm` |
| FRS-010-26 | **Collar**: cylindrical bore (`bore_diameter`) for Z < `collar_height` |
| FRS-010-27 | **Dome**: spherical cap for Z > `height − dome_height` |
| FRS-010-28 | **Field composition**: `smin(smin(smin(d_wall, d_lat), d_col), d_dome)` with KS=0.30 |
| FRS-010-29 | **Extraction**: marching cubes at `voxel_mm` resolution, under a 90M voxel budget |
| FRS-010-30 | **Topology**: output MUST be watertight, manifold, single-body |
| FRS-010-31 | **Volume tolerance**: ±2% vs. reference (1,420,789 mm³ at 0.30 mm) |
| FRS-010-32 | **Dimensional tolerance**: ±0.5 mm on height/diameter, ±0.05 mm on sheet/cell |
| FRS-010-33 | **Parameter input**: read the Design Intent Package at the Layer 1 export path |

### 5.3 Execution Flow (Verifiable)

| ID | Requirement |
|----|-------------|
| FRS-010-34 | Layer 1: parameter change → GH slider update → Publish Design → Design Intent Package written (< 1 s) |
| FRS-010-35 | Layer 2: read package → generate geometry → write 3DM and STL (< 60 s at 0.30 mm) |
| FRS-010-36 | Hermes MUST drive Layer 2 by direct Python execution, not via Grasshopper |
| FRS-010-37 | Certified geometry MUST pass the TASK-044 topology gates |
| FRS-010-38 | **Feedback loop**: certified geometry MUST be loadable into Rhino for designer review |
| FRS-010-39 | Rhino layer `Lattice_Lamp_Certified` MUST receive the certified geometry for immediate visual validation |
| FRS-010-40 | The designer MUST see certified (not preview) geometry within 5 s of a successful publish |

---

## 6. Unified Workspace Inspection (Redefined)

### 6.1 Scope Change

`inspect_workspace` validates **two layers**:

| Layer | Validation Target |
|-------|-------------------|
| **Layer 1 (GH)** | 12 sliders exposed and grouped, Preview/Publish actions functional, Current Design panel present and state-consistent |
| **Layer 2 (Python)** | Certified geometry topology, volume, dimensions, features |

### 6.2 Updated Requirements

| ID | Requirement |
|----|-------------|
| FRS-010-41 | RhinoClaw Plugin MUST implement `inspect_workspace` with a `layer` parameter (1, 2, or "both") |
| FRS-010-42 | **Layer 1 inspection**: validates GH Design Studio compliance (sliders, groups, preview, publish, panel) |
| FRS-010-43 | **Layer 2 inspection**: validates Python generator output (topology, volume, dimensions, features) |
| FRS-010-44 | **Combined inspection**: runs both layers and returns a unified compliance score |
| FRS-010-45 | Feature detection MUST return evidence-backed results for both layers |
| FRS-010-46 | Response MUST include a per-layer compliance breakdown, including panel state consistency |

---

## 7. Acceptance Criteria (Updated)

| Criterion | Pass Condition | Layer |
|-----------|----------------|-------|
| AC-01 | All 12 parameters exposed as sliders in the GH definition | 1 |
| AC-02 | Slider ranges/defaults match the Python BASE dict exactly | 1 |
| AC-03 | Publish Design writes a Design Intent Package with correct keys/format | 1 |
| AC-04 | Hermes can load the GH definition and verify the parameter UI | 1 |
| AC-05 | Python generator reads the package and produces certified geometry | 2 |
| AC-06 | Certified geometry passes topology gates (watertight, manifold, single-body) | 2 |
| AC-07 | Volume within ±2% of reference (1,420,789 mm³) | 2 |
| AC-08 | Dimensions within ±0.5 mm, sheet/cell within ±0.05 mm | 2 |
| AC-09 | End-to-end (parameter change → certified geometry) < 60 s | 1+2 |
| AC-10 | Definition saved as `lattice_lamp_v1_FROZEN.gh` in the repo | 1 |
| AC-11 | `inspect_workspace(layer=1)` returns GH Design Studio compliance | 1 |
| AC-12 | `inspect_workspace(layer=2)` returns certified geometry compliance | 2 |
| AC-13 | `inspect_workspace(layer="both")` returns unified compliance ≥ 75 | 1+2 |
| AC-14 | Certified geometry loads into the `Lattice_Lamp_Certified` layer | 2 |
| AC-15 | Designer sees certified geometry in the viewport within 5 s of publish | 2 |
| **AC-16** | **Current Design panel renders all 8 blocks in the specified order** | **1** |
| **AC-17** | **Product DNA block lists exactly the 12 certified parameters, no phantom parameters** | **1** |
| **AC-18** | **Panel shows DRAFT before preview, READY after a successful preview, PUBLISHED after publish** | **1** |
| **AC-19** | **Changing any slider after publish returns the panel to DRAFT** | **1** |
| **AC-20** | **Status and publish timestamp survive save, close, and reopen** | **1** |
| **AC-21** | **Panel is read-only — no input ports, not typeable** | **1** |
| **AC-22** | **Design Studio Parameters block renders separately, with `(Not in Certified Engine)` heading and the "does not affect certified geometry" note** | **1** |
| **AC-23** | **Certified Product DNA block contains exactly 12 lines; Design Studio block exactly 6; no crossover** | **1** |
| **AC-24** | **Changing a studio parameter leaves Status `PUBLISHED` and shows `changed since publish` in the studio block** | **1** |
| **AC-25** | **Design Intent Package still contains exactly 13 keys (product + 12 certified) with no studio keys** | **1** |

---

## 8. Non-Functional (Updated)

| Requirement | Target | Layer |
|-------------|--------|-------|
| GH parameter export latency | < 1 s | 1 |
| Current Design panel refresh | < 200 ms per solve | 1 |
| Preview Design (fast, 38³) | < 5 s | 1 |
| Python generation time | < 60 s at 0.30 mm voxel | 2 |
| Certified geometry file size | 3DM and STL both produced | 2 |
| Mesh quality | 100% watertight, manifold, single-body | 2 |
| Reproducibility | Same parameters → identical geometry (bitwise) | 2 |
| Inspection latency (Layer 1) | < 2 s | 1 |
| Inspection latency (Layer 2) | < 10 s | 2 |

---

## 9. Decided — Legacy Parameter Set (Option B Adopted)

The product configurator draft supplied on 2026-10-30 listed six parameters the certified generator does not consume. On 2026-10-30 the sponsor selected **Option B**: retain them as a separately labelled block.

| Option | Description | Outcome |
|--------|-------------|---------|
| A | Panel shows only the 12 certified parameters | Rejected — loses design vocabulary |
| **B** | **Certified Product DNA + Design Studio Parameters (Not in Certified Engine) as a separate block** | **ADOPTED** |
| C | Re-introduce the six into the Python generator | Not adopted — would invalidate the TASK-037 certification baseline |

**Implementation consequences of B**

1. The panel carries two parameter blocks with distinct headings and separators (§4.5, FRS-010-15…-17, -51, -52).
2. Studio parameters are excluded from the Design Intent Package, which stays schema-identical to the certified engine (FRS-010-47).
3. Two fingerprints: `certified_fp` governs status, `studio_fp` only drives an advisory marker (§4.7).
4. Studio values persist in the sidecar (FRS-010-49) so they survive reopen and remain available if Option C is ever pursued.
5. A studio-only edit never forces a republish (FRS-010-53, FRS-010-56).

**Path to C, if ever wanted**: promote a studio parameter into the certified generator, then re-run convergence (TASK-037 style), re-derive the reference volume, and issue a new certification baseline. That is a certification project with its own task ID, not a panel change.

---

## 10. References

- FRS-008: Hermes ↔ RhinoClaw TCP Integration
- FRS-009: Grasshopper Recipe Catalog Fix (superseded by the two-layer approach)
- FRS-011: Agentic Grasshopper Automation (Design Studio role)
- IDD-010: Parametric Lattice Lamp — Interface Design
- IDD-011: Agentic Grasshopper Automation — Interface Contracts
- `packages/generator-certified/task034_engine.py` — certified Python generator
- `reference_manifest.json` — manufacturing baseline

---

## 11. Transition Plan (5 Steps)

| Step | Action | Owner | Status |
|------|--------|-------|--------|
| 1 | Freeze GH definition as Design Studio (`lattice_lamp_v1_FROZEN.gh`) | Hermes | ⏳ |
| 2 | Add Preview Design, Publish Design, and Current Design panel | Hermes | ⏳ |
| 3 | Verify Python generator reads the exported package natively | Hermes | ⏳ |
| 4 | Add the Layer 2 certified-geometry mission in Hermes | Hermes | ⏳ |
| 5 | Implement the certified-geometry feedback loop into Rhino | Hermes | ⏳ |

---

**End of FRS-010 v1.1.0**
