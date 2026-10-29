"""TASK-037 PHASE 1 - high resolution convergence study.

Memory-lean version of the field build: the field is filled in z-slabs so peak RAM
stays near one field array. One resolution per invocation, results written per run
so a long study survives interruption.

usage: task037_converge.py <voxel_mm>
"""
import json
import os
import sys
import time

import numpy as np
from scipy import ndimage
from skimage import measure

ROOT = "/Users/warren/Documents/_HQ_AI/EdgeGDE"
OUT = os.path.join(ROOT, ".hermes/logs/missions/task-037")
os.makedirs(OUT, exist_ok=True)

VOX = float(sys.argv[1])
RESULT = os.path.join(OUT, "conv_%03d.json" % int(round(VOX * 100)))
if os.path.exists(RESULT):
    print("already done:", RESULT)
    sys.exit(0)

# frozen reference product parameters (TASK-033 Candidate A)
P = dict(diameter=150.0, height=300.0, twist_deg=45.0, wall_mm=1.6, gyroid_cell=8.0,
         sheet_mm=1.2, band_mm=25.0, bore_mm=40.0, dome_mm=1.6)
R = P["diameter"] / 2.0
H = P["height"]
WALL, CELL, SHEET = P["wall_mm"], P["gyroid_cell"], P["sheet_mm"]
BAND, BORE, DOME = P["band_mm"], P["bore_mm"], P["dome_mm"]
K = 2.0 * np.pi / CELL
C = SHEET / 2.0
KS = 0.30
PH = np.deg2rad(P["twist_deg"])

xs = np.arange(-R - 8.0, R + 8.0, VOX, dtype=np.float32)
zs = np.arange(-3.0, H + R + 6.0, VOX, dtype=np.float32)
nx, nz = len(xs), len(zs)
nvox = nx * nx * nz
print("grid %d x %d x %d = %.1f M voxels (%.2f GB float32)"
      % (nx, nx, nz, nvox / 1e6, nvox * 4 / 1e9), flush=True)
if nvox > 450_000_000:
    json.dump({"voxel_mm": VOX, "status": "refused_resource_limit", "voxels": int(nvox)},
              open(RESULT, "w"), indent=2)
    sys.exit(0)

X2, Y2 = np.meshgrid(xs, xs, indexing="ij")
R2 = np.sqrt(X2 * X2 + Y2 * Y2).astype(np.float32)
TH2 = np.arctan2(Y2, X2).astype(np.float32)

F = np.empty((nx, nx, nz), dtype=np.float32)
CH = 24
t0 = time.time()
for k0 in range(0, nz, CH):
    k1 = min(k0 + CH, nz)
    Z = zs[k0:k1][None, None, :]
    r = R2[:, :, None]
    th = TH2[:, :, None]
    ph = PH * (Z / H)
    R_eff = R - WALL / 2.0 + 0.9 * np.cos(3.0 * (th - ph))
    d_wall = np.maximum(np.abs(r - R_eff) - WALL / 2.0, np.abs(Z - H / 2.0) - H / 2.0)
    KX = K * X2[:, :, None]
    KY = K * Y2[:, :, None]
    KZ = K * Z
    g = (np.sin(KX) * np.cos(KY) + np.sin(KY) * np.cos(KZ)
         + np.sin(KZ) * np.cos(KX))
    d_lat = np.abs(g) - C
    d_lat = 0.5 * (d_lat + (r - (R - WALL + 0.9)) + np.sqrt((d_lat - (r - (R - WALL + 0.9))) ** 2 + KS * KS))
    d_lat = 0.5 * (d_lat + ((R - WALL - BAND) - r) + np.sqrt((d_lat - ((R - WALL - BAND) - r)) ** 2 + KS * KS))
    d_lat = 0.5 * (d_lat + (2.2 - Z) + np.sqrt((d_lat - (2.2 - Z)) ** 2 + KS * KS))
    d_lat = 0.5 * (d_lat + (Z - (H - 1.0)) + np.sqrt((d_lat - (Z - (H - 1.0))) ** 2 + KS * KS))
    d_col = np.maximum(np.abs(r - (BORE / 2.0 + R) / 2.0) - (R - BORE / 2.0) / 2.0, np.abs(Z - 1.0) - 1.0)
    d_dome = np.maximum(np.abs(np.sqrt(r * r + (Z - H) ** 2) - R) - DOME / 2.0, (H - 1.0) - Z)
    a = 0.5 * (d_wall + d_lat - np.sqrt((d_wall - d_lat) ** 2 + KS * KS))
    b = 0.5 * (d_col + d_dome - np.sqrt((d_col - d_dome) ** 2 + KS * KS))
    F[:, :, k0:k1] = 0.5 * (a + b - np.sqrt((a - b) ** 2 + KS * KS))
    del Z, r, th, ph, R_eff, d_wall, g, d_lat, d_col, d_dome, a, b, KX, KY, KZ
build_s = time.time() - t0
print("field built in %.1f s" % build_s, flush=True)

# same generation corrections as the certified pipeline: fill sub-voxel air pockets,
# keep the largest solid component. no mesh repair.
solid = F < 0.0
air = ~solid
alab, an = ndimage.label(air)
filled = 0
if an > 1:
    asizes = ndimage.sum(air, alab, range(1, an + 1))
    border = set()
    for idx in (alab[0].ravel(), alab[-1].ravel(), alab[:, 0].ravel(),
                alab[:, -1].ravel(), alab[:, :, 0].ravel(), alab[:, :, -1].ravel()):
        border.update(np.unique(idx).tolist())
    small = [k for k in range(1, an + 1) if k not in border and asizes[k - 1] <= 200]
    if small:
        mask = np.isin(alab, small)
        solid[mask] = True
        filled = len(small)
        F[mask] = -0.05
        F[(~solid)] = np.maximum(F[~solid], 0.05)
    del border
del air, alab
lab, nreg = ndimage.label(solid)
if nreg > 1:
    sizes = ndimage.sum(solid, lab, range(1, nreg + 1))
    keep = int(np.argmax(sizes)) + 1
    F = np.where(lab == keep, F, 2.0).astype(np.float32)
    nreg_kept = 1
else:
    nreg_kept = nreg
del solid, lab
print("regions %d -> %d, pockets filled %d" % (nreg, nreg_kept, filled), flush=True)

t1 = time.time()
v, f, _, _ = measure.marching_cubes(F, level=0.0, spacing=(VOX, VOX, VOX))
mc_s = time.time() - t1
v = v + np.array([xs[0], xs[0], zs[0]], dtype=np.float32)
print("marching cubes: %d faces in %.1f s" % (len(f), mc_s), flush=True)
del F

# volume and area in face chunks to keep temporaries small
vol = 0.0
area = 0.0
n = len(f)
step = 5_000_000
for i in range(0, n, step):
    sl = f[i:i + step]
    a = v[sl[:, 0]]
    b = v[sl[:, 1]]
    c = v[sl[:, 2]]
    vol += float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0
    area += float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()) / 2.0
vol = abs(vol)

e = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
e.sort(axis=1)
u, cnt = np.unique(e, axis=0, return_counts=True)
naked = int((cnt == 1).sum())
nonman = int((cnt > 2).sum())
del e, u, cnt
bb0, bb1 = v.min(axis=0), v.max(axis=0)

# ---- root cause: |grad g| is not 1, so "SHEET" is not the sheet thickness -----
samp = v[::max(1, len(v) // 400_000)]
rr = np.hypot(samp[:, 0], samp[:, 1])
m = (rr > R - WALL - BAND + 2.0) & (rr < R - WALL - 2.0) & (samp[:, 2] > 3.0) & (samp[:, 2] < H - 3.0)
s = samp[m]
grad_stats = None
if len(s) > 1000:
    kx, ky, kz = K * s[:, 0], K * s[:, 1], K * s[:, 2]
    gx = K * (np.cos(kx) * np.cos(ky) - np.sin(kz) * np.sin(kx))
    gy = K * (-np.sin(kx) * np.sin(ky) + np.cos(ky) * np.cos(kz))
    gz = K * (-np.sin(ky) * np.sin(kz) + np.cos(kz) * np.cos(kx))
    gn = np.sqrt(gx * gx + gy * gy + gz * gz)
    thick = SHEET / np.maximum(gn, 1e-6)
    grad_stats = {"samples": int(len(s)),
                  "grad_abs_min": round(float(gn.min()), 4),
                  "grad_abs_p05": round(float(np.percentile(gn, 5)), 4),
                  "grad_abs_median": round(float(np.median(gn)), 4),
                  "grad_abs_p95": round(float(np.percentile(gn, 95)), 4),
                  "grad_abs_max": round(float(gn.max()), 4),
                  "implied_sheet_thickness_mm_min": round(float(thick.min()), 3),
                  "implied_sheet_thickness_mm_p05": round(float(np.percentile(thick, 5)), 3),
                  "implied_sheet_thickness_mm_median": round(float(np.median(thick)), 3),
                  "implied_sheet_thickness_mm_p95": round(float(np.percentile(thick, 95)), 3),
                  "implied_sheet_thickness_mm_max": round(float(thick.max()), 3),
                  "nominal_sheet_mm": SHEET}

res = {
    "voxel_mm": VOX, "status": "ok", "params": P,
    "grid": [nx, nx, nz], "voxels": int(nvox),
    "faces": int(len(f)), "vertices": int(len(v)),
    "volume_mm3": round(vol, 1), "surface_area_mm2": round(area, 1),
    "dim": [round(float(bb1[i] - bb0[i]), 2) for i in range(3)],
    "naked_edges": naked, "nonmanifold_edges": nonman,
    "components_from_label": int(nreg_kept), "air_pockets_filled": int(filled),
    "build_s": round(build_s, 1), "mc_s": round(mc_s, 1),
    "total_s": round(time.time() - t0, 1),
    "grad_g_on_surface": grad_stats,
    "mass_g_pla_1p24": round(vol / 1000.0 * 1.24, 1),
}
json.dump(res, open(RESULT, "w"), indent=2)
print(json.dumps({k: res[k] for k in ("voxel_mm", "faces", "volume_mm3", "surface_area_mm2",
                                      "dim", "naked_edges", "total_s")}, indent=1))
if grad_stats:
    print("sheet thickness implied by |grad g|: median %.2f mm (p05 %.2f, p95 %.2f) - nominal %.2f"
          % (grad_stats["implied_sheet_thickness_mm_median"],
             grad_stats["implied_sheet_thickness_mm_p05"],
             grad_stats["implied_sheet_thickness_mm_p95"], SHEET))
