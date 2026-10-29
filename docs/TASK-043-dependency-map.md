# TASK-043 Phase 1 — GH ↔ Python Dependency Map

**Created:** 2026-10-29  
**Objective:** Map every Python field term in `packages/generator-certified/task034_engine.py` to the Grasshopper component(s) that must reproduce it. This is the single source of truth for TASK-043 repairs.

---

## Python Generator — Complete Field Architecture

### Parameters (BASE dict, line 16-18)

| Parameter | Python key | Value | GH Slider (nickname) | Component Instance ID |
|-----------|------------|-------|---------------------|----------------------|
| Diameter | `diameter` | 150.0 | Diameter | `0f589f45-b8f4-4227-8548-7d84af2209e4` |
| Height | `height` | 300.0 | Height | `36647b10-0521-4460-ad24-bf81b3cf7349` |
| Twist (deg) | `twist_deg` | 45.0 | Twist_Angle | `b55fcb0c-36bb-4766-b334-47fc7d197ad5` |
| Wall thickness | `wall_mm` | 1.6 | Wall_Thickness | `d0148cd5-98dd-4c73-9cd7-da762f308351` |
| Gyroid cell | `gyroid_cell` | 8.0 | Gyroid_Cell_Size | `2a1fdf7d-df3e-49b1-9fef-4ce9eb430175` |
| Sheet thickness | `sheet_mm` | 1.2 | Gyroid_Thickness | `b8f3b06c-cd9a-44ef-804d-3f34184102f6` |
| Band width | `band_mm` | 25.0 | (no direct slider) | — |
| Bore diameter | `bore_mm` | 40.0 | Mount_Diameter | `3e5d08b9-ab1c-46f5-b4d7-8e774363757d` |
| Dome thickness | `dome_mm` | 1.6 | (no direct slider) | — |
| Voxel size | `voxel_mm` | 0.8 | (internal) | — |

**Derived constants (lines 32-42):**
- `R = diameter / 2.0` = 75.0
- `H = height` = 300.0
- `WALL = wall_mm` = 1.6
- `CELL = gyroid_cell` = 8.0
- `SHEET = sheet_mm` = 1.2
- `BAND = band_mm` = 25.0
- `BORE = bore_mm` = 40.0
- `DOME = dome_mm` = 1.6
- `VOX = voxel_mm` = 0.8
- `KS = 0.30` (smooth blend sharpness)
- `K = 2π / CELL` = 0.785398... (gyroid wave number)
- `PH = deg2rad(twist_deg)` = 0.785398... (45° in radians)

---

### Coordinate Fields (lines 51-55)

| Field | Python Expression | GH Equivalent Needed |
|-------|-------------------|---------------------|
| X, Y, Z | `np.meshgrid(xs, xs, zs, indexing="ij")` | 3D grid of points (Populate 3D Grid output) |
| r | `sqrt(X² + Y²)` | Distance from Z-axis (Polar coordinates) |
| th | `arctan2(Y, X)` | Angle around Z-axis (Polar coordinates) |

**GH Mapping:** `Populate 3D Grid` (instance `50f854d0-cf1b-4616-b49e-8efeb08d01bc`) outputs `Points` (P), `BoxAsMesh` (M), `xRes/yRes/zRes`. These must feed the polar coordinate conversion.

---

### Phase / Twist Field (line 57-58)

| Term | Python Expression | Purpose |
|------|-------------------|---------|
| `phase` | `deg2rad(twist_deg) * (Z / H)` | Linear twist along Z |
| `R_eff` | `R - WALL/2 + 0.9 * cos(3*(th - phase))` | Effective radius with 3-lobe modulation + twist |

**GH Mapping:** 
- `Twist_Angle` slider (instance `b55fcb0c-36bb-4766-b334-47fc7d197ad5`) → feeds `Twist` component (instance `f374a7cb-8f86-4a92-b9a4-09f03d19c6ba`)
- **ERROR:** `Twist` component reports "Data conversion failed from Vector to Line" — the input wiring is wrong type.

---

### Field Terms (lines 59-72)

#### 1. Wall Field — `d_wall` (line 59)

```
d_wall = max( |r - R_eff| - WALL/2 , |Z - H/2| - H/2 )
```

- Signed distance to a twisted, lobed cylindrical shell of thickness WALL
- First term: radial distance to effective radius minus half-thickness
- Second term: axial distance to top/bottom caps minus half-height

**GH Target:** A component that computes this exact signed distance field. Currently missing — the wall is supposedly built by `Wall Thickness` (instance `4023ba6e-edc0-4a52-ba4b-8643562c787d`, type `Heron.MultiSDiff`) but its inputs S and D "failed to collect data".

---

#### 2. Gyroid Lattice Field — `d_lat` (lines 61-66)

**Core gyroid implicit function (line 61-62):**
```
g = sin(K*X)*cos(K*Y) + sin(K*Y)*cos(K*Z) + sin(K*Z)*cos(K*X)
```
where `K = 2π / CELL`

**Lathe field construction (lines 63-66):**
```
d_lat = smax( |g| - SHEET/2 , r - (R - WALL + 0.9) , KS )     # sheet thickness + outer bound
d_lat = smax( d_lat , (R - WALL - BAND) - r , KS )             # inner band boundary
d_lat = smax( d_lat , 2.2 - Z , KS )                           # bottom cutoff (z > 2.2)
d_lat = smax( d_lat , Z - (H - 1.0) , KS )                     # top cutoff (z < H-1)
```

- `smax(a,b,k) = 0.5*(a+b+sqrt((a-b)²+k²))` — smooth maximum (blend radius k=KS=0.30)
- The gyroid sheet exists only where `|g| < SHEET/2` (thickness SHEET=1.2mm)
- Band limits: radial range `R-WALL-BAND` to `R-WALL+0.9` (25mm band, 0.9mm outer overshoot)
- Z limits: 2.2mm above base to H-1.0mm below top

**GH Target Components:**
| Python Term | GH Component (Current) | Instance ID | Status |
|-------------|------------------------|-------------|--------|
| `g` (gyroid field) | `Gyroid Scalar Field` | `7295dc15-93eb-483d-ad79-68c423f009e6` | Outputs scalar field, feeds `Gyroid IsoMesh` |
| `d_lat` construction | `Gyroid IsoMesh` (Isosurface Scalar Field) | `38df9a66-b997-4bc9-a694-e48d813e2318` | **ERROR: Null reference** |
| Grid population | `Populate 3D Grid` (Populate Box with Grid) | `50f854d0-cf1b-4616-b49e-8efeb08d01bc` | **ERROR: Null reference** |
| Cell size | `Gyroid_Cell_Size` slider | `2a1fdf7d-df3e-49b1-9fef-4ce9eb430175` | OK (8.0) |
| Sheet thickness | `Gyroid_Thickness` slider | `b8f3b06c-cd9a-44ef-804d-3f34184102f6` | OK (0.1 — **WRONG**, should be 1.2) |

**Critical parameter mismatch:** `Gyroid_Thickness` slider value is 0.1 but Python uses `sheet_mm = 1.2`. The slider max is 1.0 — **cannot reach 1.2**.

---

#### 3. Collar Bore Field — `d_col` (lines 68-69)

```
d_col = max( |r - (BORE/2 + R)/2| - (R - BORE/2)/2 , |Z - 1| - 1 )
```

- Toroidal distance field for the collar bore at base
- Centered at radius `(BORE/2 + R)/2` = (20+75)/2 = 47.5mm
- Tube radius `(R - BORE/2)/2` = (75-20)/2 = 27.5mm
- Height 2mm centered at Z=1

**GH Target:** Currently built by `Mount Collar` (instance `3148b934-ad05-43f1-aab5-b45e21656b8d`, type `Extrude`) but produces a 20mm dome, not the 150mm annulus with 40mm bore. The `Mount_Diameter` slider (40mm) exists but isn't wired correctly.

---

#### 4. Top Dome Field — `d_dome` (lines 70-71)

```
d_dome = max( |sqrt(X²+Y²+(Z-H)²) - R| - DOME/2 , (H-1) - Z )
```

- Spherical cap of radius R=75mm, shell thickness DOME=1.6mm
- Only exists above Z = H-1 = 299mm

**GH Target:** `Top Dome` (instance `af44044d-34b5-4ec0-938e-c474cc89c387`) produces a 20mm mesh, not the 151mm spherical cap. Inputs are not wired to produce the correct geometry.

---

#### 5. Field Blending — Final `field` (line 72)

```
field = smin( smin(d_wall, d_lat, KS), smin(d_col, d_dome, KS), KS )
```

- Two-level smooth minimum with blend radius KS=0.30
- First: blend wall with lattice (gyroid)
- Second: blend collar with dome
- Third: blend the two groups together

**GH Target:** No equivalent component exists. The blending is done implicitly by `Union All` (Solid Union) which operates on **Brep/Mesh**, not scalar fields. This is the architectural mismatch: Python blends **fields**, GH tries to union **geometries**.

---

### Post-Processing (lines 73-97)

| Step | Python | Purpose |
|------|--------|---------|
| `solid = field < 0` | Threshold field | Inside/outside |
| `ndimage.label(air)` | Label connected air pockets | Find voids |
| Fill small interior pockets (≤200 voxels) | Remove trapped air | Watertightness |
| `ndimage.label(solid)` | Label solid components | Find disconnected parts |
| Keep largest component only | Single body | `components == 1` |

---

### Meshing & Metrics (lines 99-115)

| Step | Python | GH Equivalent |
|------|--------|---------------|
| `measure.marching_cubes(field, level=0, spacing=(VOX,VOX,VOX))` | Extract isosurface at 0 | `Gyroid IsoMesh` should do this |
| Volume via divergence theorem | `vol = |Σ a·(b×c)|/6` | `Volume` component |
| Naked edges | `cnt == 1` on half-edges | `Mesh Edges` / `Naked Edges` |
| Non-manifold edges | `cnt > 2` | `Non-Manifold Edges` |
| Connected components | Graph connectivity on edge adjacency | `Mesh Components` |

---

## GH Component Inventory — Current State

| GH Component | Nickname | Instance ID | Type | Current Status | Python Field Term |
|--------------|----------|-------------|------|----------------|-------------------|
| `Populate Box with Grid` | Populate 3D Grid | `50f854d0-cf1b-4616-b49e-8efeb08d01bc` | `Nautilus.Populate.BoxPopulateGridComponent1` | **ERROR: Null ref** | X,Y,Z grid → r, th |
| `Isosurface Scalar Field` | Gyroid IsoMesh | `38df9a66-b997-4bc9-a694-e48d813e2318` | `Nautilus.MeshMake.IsoSurfaceScalarFieldComponent1` | **ERROR: Null ref** | Marching cubes on `d_lat` |
| `Twist` | Twist | `f374a7cb-8f86-4a92-b9a4-09f03d19c6ba` | `SquishyXMorphs.Twist` | **ERROR: Vector→Line** | `R_eff` modulation |
| `Solid Union` | Union All | `f30d6eca-9df4-4f59-9950-135a675fcbca` | `SurfaceComponents.SolidComponents.Component_BooleanUnion` | **ERROR: Mesh→Brep** | `smin` blending (wrong level) |
| `Multi SDiff` | Wall Thickness | `4023ba6e-edc0-4a52-ba4b-8643562c787d` | `Heron.MultiSDiff` | WARN: S,D no data | `d_wall` |
| `Diamond Grid` | Diamond Grid | `361461dc-457f-4ffb-9c77-d3fe33c013b6` | `LunchBox.DiamondGrid` | WARN: Srf no data | — (legacy) |
| `LiveSoap` | LiveSoap | `8c3e67e5-309c-46c9-acc8-22ff3e0e3d6b` | `Kangaroo2Component...LiveSoapComponent` | WARN: M no data | — (legacy) |
| `Weld` | Weld | `869da028-aa7f-4d6b-88ec-8b53e6386569` | `Nautilus.MeshMake.WeldMeshAverageComponent` | WARN: M no data | — (legacy) |
| `Mesh Brep` | Mesh Brep | `de9b7bd3-5ad0-4757-967b-a94781d04a6e` | `SurfaceComponents.MeshComponents.Component_MeshBRep` | WARN: B no data | — (legacy) |
| `Extrude` | Mount Collar | `3148b934-ad05-43f1-aab5-b45e21656b8d` | `Extrude` | Outputs 20mm disc | `d_col` (wrong) |
| `Bounding Box` | BBox Twist | `b4d5311f-a678-485a-a2b7-af251299a868` | `Bounding Box` | Feeds `Populate 3D Grid` | Grid bounds |

---

## Repair Scope — Exactly Three Components

| Priority | GH Component | Instance ID | Python Term to Implement | Blocking Error |
|----------|--------------|-------------|-------------------------|----------------|
| 1 | **Populate 3D Grid** | `50f854d0-cf1b-4616-b49e-8efeb08d01bc` | X,Y,Z grid → r, th coordinates | Null reference — no grid = no field eval |
| 2 | **Gyroid Scalar Field** | `7295dc15-93eb-483d-ad79-68c423f009e6` | `g = sin(KX)cos(KY)+sin(KY)cos(KZ)+sin(KZ)cos(KX)` | Feeds IsoMesh; currently produces no output |
| 3 | **Gyroid IsoMesh** | `38df9a66-b997-4bc9-a694-e48d813e2318` | Marching cubes on `d_lat` field | Null reference — no input field |

**Twist** (instance `f374a7cb-8f86-4a92-b9a4-09f03d19c6ba`) is also critical but its error "Vector→Line" suggests a wiring fix rather than a new component — the twist modulation `R_eff = R - WALL/2 + 0.9*cos(3*(th - phase))` must be computed as a scalar field and fed to the wall field.

**Union All** is **not** in the repair scope — it operates at the wrong level (geometry union vs field blend). Once the three field components work, the isosurface produces a single watertight mesh; no boolean needed.

---

## Equivalence Test — Quantitative Gates (UPDATED)

**Reference target:** 0.30 mm converged geometry (TASK-037 certified), not the 0.8 mm extraction.

| Metric | Python Reference (0.30 mm) | GH Target | Tolerance |
|--------|---------------------------|-----------|-----------|
| Volume | **1,423,008 mm³** | — | **≤ 2%** |
| Dimensions (X,Y,Z) | 151.85, 151.77, 375.996 mm | — | ≤ 0.5 mm |
| Watertight | True | — | Must pass |
| Manifold | True | — | Must pass |
| Single body | True (1 component) | — | Must pass |
| Naked edges | 0 | — | 0 |
| Non-manifold edges | 0 | — | 0 |
| Gyroid cell size | 8.0 mm | — | ±0.1 mm |
| Sheet thickness | 1.104 mm (measured) | — | ±0.05 mm |
| Wall thickness | 1.66 mm (measured) | — | ±0.05 mm |
| All 4 features | True | — | All True |

> **Why the change:** TASK-037 proved the 0.8 mm extraction is 44 % low on volume (marching-cubes bias). Certifying against it would let a broken GH reproduce the *same error* and "pass." The 0.30 mm converged volume is the only geometry that has been independently validated (voxel-count + half-voxel + Brep decomposition, three estimators within 0.16 %).

---

## Next Action (Phase 2)

For each of the three critical components:
1. Open `lattice_lamp_final_BROKEN_REFERENCE.gh` in Grasshopper
2. Locate the component by Instance ID
3. Diagnose the null reference / wiring error
4. Implement the exact Python field term
5. Re-run solve → verify error clears
6. When all three clear, run equivalence test

**No other components are to be touched.** Voronoi, LiveSoap, Diamond Grid, Mesh Brep, Weld, Extrude, Union All remain as-is (legacy/dead branch).

---

*End of Phase 1 Map. Phase 2 begins when you confirm the map is accurate.*