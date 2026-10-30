# TASK-044 Manufacturing Constraints

**Status:** Active
**Version:** 1.0.0
**Owner:** Warren (design authority)
**Applies to:** TASK-044 Phase 3 onward (all manufacturing work on the Lattice Lamp)

This document records constraints that are not negotiable engineering trade-offs.
They are design requirements. Engineering options that violate them are out of
scope, regardless of how much they would improve a metric.

---

## CONSTRAINT-001 — The product shall remain a single-piece print

**Rule:** The Lattice Lamp shall be manufactured as one continuous printed part.
Split-part manufacturing is not permitted.

**Rationale:** The lamp is a sculptural object. A visible seam would compromise
the design intent more than any manufacturing convenience gained. Assembly
introduces joint failure modes, tolerance stack-up and a surface discontinuity
that is unacceptable on a decorative product.

**Consequences:**

- A joint study (sleeve, bayonet, lap, dowel) is **out of scope**.
- Multi-part assembly evaluation is **removed** from the study plan.
- The build envelope is now a **hard constraint on printer selection**, not a
  prompt to redesign the object.
- Print-time and cost optimisation must be achieved *within* a single piece,
  through toolpath strategy, printer choice, or (with explicit approval)
  geometry parameters.

**Supersedes:** the earlier "2-part vertical split with internal sleeve joint"
decision. That work is cancelled, not deferred.

---

## CONSTRAINT-002 — Certified parameters may not be changed without explicit approval

**Rule:** `height`, `diameter`, `twist_deg`, `wall_mm`, `gyroid_cell`,
`sheet_mm`, `band_mm`, `bore_mm`, `dome_mm` are frozen at their certified
values. Phase 3B may *quantify* the effect of changing them; it may not change
them.

**Rationale:** the certified reference geometry (Candidate E) and all topology
certification rest on these values. Changing them silently restarts certification
and invalidates the 0.30 mm reference.

**Exception process:** any parameter change requires explicit approval from
Warren, followed by re-certification under TASK-044.

---

## CONSTRAINT-003 — No Union All
Architectural/legacy construct. Out of scope for equivalence and manufacturing.

## CONSTRAINT-004 — No GH/Python equivalence work
Settled in TASK-043: Python is authoritative, Grasshopper is a design studio
only.

---

## Derived position (as of Phase 2 close)

| Dimension | Value | Status |
|---|---|---|
| Height | 375.45 mm | Exceeds all 256–360 mm class printers |
| Width × Depth | 151.40 × 151.38 mm | Fits typical beds |
| Material | 736.96 cm³ (~890 g) at 0.80 mm | High for a decorative object |
| Print time | 7 d 17 h 26 m at 0.80 mm | Not a production workflow |
| Topology | watertight, manifold, single body | Certified |

### Where the print time actually comes from

Forensics on the 908 MB Phase 2 G-code:

```
extruding moves      19,425,548
average segment      0.308 mm
segments under 2 mm  99.4%
travel               53% of all motion
retractions          1
```

The time is dominated by **move count at sub-millimetre segment length**, not by
material volume or by part height. At 0.3 mm segments the machine is
acceleration-limited on essentially every move.

**Therefore:** splitting the part would not have reduced print time even if it
had been permitted — it changes neither surface area nor path length. The
constraint costs less than it appears to.

### Printer compatibility

Scanning the OrcaSlicer profile library (95 machines) for build volumes that
accept 151.41 × 151.39 × 375.55 mm yields large-format machines only, including:

- Creality CR-10 Max — 450 × 450 × 470 mm
- Prusa XL — 360 × 360 × 360 mm (fails Z by 15.5 mm — excluded)
- Raise3D Pro3 Plus — 340 × 300 × 605 mm
- Tiertime UP600 HS — 500 × 400 × 600 mm
- re3D Gigabot 4 — 590 × 600 × 600 mm
- Z-Bolt S400 — 400 × 400 × 700 mm

Consumer 256 mm class machines are excluded by CONSTRAINT-001, not by preference.

---

---

## Priority ordering (ratified)

The geometry architecture and certification work are worth more than chasing
days off a slicer estimate. Manufacturing tuning is deferred until it becomes a
genuine commercial blocker.

| Priority | Work | Status |
|---|---|---|
| **HIGH** | **Milestone B** — Design Intent Package → Certified Geometry Engine → 3DM → Rhino feedback loop | In progress |
| MEDIUM | Phase 3A — printer / manufacturing feasibility | Deferred |
| LOW | Print-time optimisation, material studies, slicer micro-tuning | Deferred |

### Rationale

The 7-day print is **not a design failure** — it is the output of one specific
slicing configuration. Layer height, line width, wall count, speed, acceleration,
nozzle size, material and coarse/fine modes are all adjustable at print time
without dragging complexity back into the Design Studio architecture.

What is already established and valuable:

- geometry generation works
- topology is certified
- slicers import correctly
- toolpaths generate correctly
- single-piece constraint accepted
- design/geometry architecture proven

The design itself is not obviously wasteful; it was generated deliberately and
certified. Production tuning is the kind of thing refined later against real
prints.

## Open questions (deferred with LOW priority)

1. Is 7 d 17 h acceptable for a made-to-order sculptural object, or is ≤24 h a
   hard requirement? (Currently stated as a target, not a constraint.)
2. If toolpath resolution cannot close the gap, is a geometry parameter study
   (Phase 3B) authorised to proceed to *change*, or only to *quantify*?
3. Which production route: own large-format machine, print farm, or bureau?
