# TASK-044 Lessons Learned

**Status:** Active
**Version:** 1.0.0

Entries are recorded in the form Observed / Initial hypothesis / Verified cause /
Corrective action / Status. The purpose is to stop future investigations from
chasing an already-disproved hypothesis.

---

## LL-044-01 — "Rhino froze" was a modal dialog, not mesh complexity

**Observed:** Rhino appeared frozen during STL import. Reads of the document
returned `RHINO_BUSY` for tens of minutes; the import never completed.

**Initial hypothesis:** the 12.6M-facet / 631 MB mesh exhausted Rhino's
responsiveness.

**Verified cause:** Rhino's STL importer is **interactive**. It raised a command
prompt —

```
Set STL import options ( Weld=Yes  WeldAngle=22.5  SplitDisjointMeshes=Yes  ModelUnits=Millimeters )
```

— and blocked the UI thread waiting for a keypress. The mesh size was never the
blocker. Pressing ENTER in Rhino completed the import immediately.

RhinoClaw cannot clear this: even `send_keystrokes` is queued behind the blocked
UI thread.

**Corrective action:** never call Rhino's command-driven STL importer from
automation. Read the mesh programmatically and construct it with RhinoCommon:

```
STL  ->  parse  ->  Rhino.Geometry.Mesh  ->  doc.Objects.AddMesh()  ->  Redraw
```

No dialog, no UI-thread blocking, deterministic, identical local and remote.

**Status:** Resolved.

---

## LL-044-02 — Voxel-resampled previews have a fidelity cliff

**Observed:** a 2.5 mm preview built in 2.5 s produced a 27 MB mesh that imported
cleanly, but the lamp's height collapsed from 375.5 mm to 338.4 mm.

**Initial hypothesis:** coarse previews degrade smoothly — less detail, same shape.

**Verified cause:** features thinner than the sample spacing are dropped outright.
Measured on the certified package:

```
voxel    faces        z_mm     STL_MB   z_error vs 0.8 mm
1.6      1,882,576    375.1     94.1    -0.3 mm
1.8      1,188,184    366.4     59.4    -9.1 mm
2.0        233,700    351.3     11.7   -24.1 mm
2.2        415,420    342.1     20.8   -33.3 mm
2.5        543,924    338.4     27.2   -37.1 mm
```

`dome_mm = 1.6` is sub-voxel at 2.5 mm, so the dome is not sampled at all — the
preview is a different object, not a degraded one. Face counts are also
non-monotonic (2.0 mm → 233k, then 2.2 mm → 415k): aliasing, where thin lattice
sheets alternately vanish and smear into blobs.

The floor is Nyquist-like: the thinnest certified features are `sheet_mm = 1.2`
and `dome_mm = 1.6`, so any preview voxel coarser than ~1.6 mm loses them.

**Corrective action:** a preview must be validated on **dimensions**, not on file
size and build time. File size and speed are necessary but not sufficient.
Acceptable options: preview at 1.6 mm (94 MB, −0.3 mm), or decimate the correct
0.8 mm mesh — decimation preserves the silhouette because it simplifies the real
surface instead of re-sampling the field. Topology loss is irrelevant for a
viewport artifact, though fatal for manufacturing.

**Status:** Resolved — 1.6 mm adopted as the fidelity floor; decimation kept as a
future refinement.
