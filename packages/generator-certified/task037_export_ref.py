"""Build the 0.30 mm fidelity-reference mesh and save it as .3dm for the viewport."""
import json
import os
import sys
import time

import numpy as np
import rhino3dm as r3
from scipy import ndimage
from skimage import measure

OUT = "/Users/warren/Documents/_HQ_AI/EdgeGDE/.hermes/logs/missions/task-037"
P = dict(diameter=150.0, height=300.0, twist_deg=45.0, wall_mm=1.6, gyroid_cell=8.0,
         sheet_mm=1.2, band_mm=25.0, bore_mm=40.0, dome_mm=1.6)
VOX = 0.30
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
print("grid %dx%dx%d = %.1fM" % (nx, nx, nz, nx * nx * nz / 1e6), flush=True)

X2, Y2 = np.meshgrid(xs, xs, indexing="ij")
R2 = np.sqrt(X2 * X2 + Y2 * Y2).astype(np.float32)
TH2 = np.arctan2(Y2, X2).astype(np.float32)
F = np.empty((nx, nx, nz), dtype=np.float32)
t0 = time.time()
for k0 in range(0, nz, 24):
    k1 = min(k0 + 24, nz)
    Z = zs[k0:k1][None, None, :]
    r = R2[:, :, None]
    th = TH2[:, :, None]
    ph = PH * (Z / H)
    Reff = R - WALL / 2.0 + 0.9 * np.cos(3.0 * (th - ph))
    dw = np.maximum(np.abs(r - Reff) - WALL / 2.0, np.abs(Z - H / 2.0) - H / 2.0)
    KX = K * X2[:, :, None]
    KY = K * Y2[:, :, None]
    KZ = K * Z
    g = np.sin(KX) * np.cos(KY) + np.sin(KY) * np.cos(KZ) + np.sin(KZ) * np.cos(KX)
    dl = np.abs(g) - C
    for other in (r - (R - WALL + 0.9), (R - WALL - BAND) - r, 2.2 - Z, Z - (H - 1.0)):
        dl = 0.5 * (dl + other + np.sqrt((dl - other) ** 2 + KS * KS))
    dc = np.maximum(np.abs(r - (BORE / 2.0 + R) / 2.0) - (R - BORE / 2.0) / 2.0, np.abs(Z - 1.0) - 1.0)
    dd = np.maximum(np.abs(np.sqrt(r * r + (Z - H) ** 2) - R) - DOME / 2.0, (H - 1.0) - Z)
    a = 0.5 * (dw + dl - np.sqrt((dw - dl) ** 2 + KS * KS))
    b = 0.5 * (dc + dd - np.sqrt((dc - dd) ** 2 + KS * KS))
    F[:, :, k0:k1] = 0.5 * (a + b - np.sqrt((a - b) ** 2 + KS * KS))
    del Z, r, th, ph, Reff, dw, g, dl, dc, dd, a, b, KX, KY, KZ
print("field %.1fs" % (time.time() - t0), flush=True)

solid = F < 0.0
air = ~solid
alab, an = ndimage.label(air)
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
        F[mask] = -0.05
        F[~solid] = np.maximum(F[~solid], 0.05)
    del border
del air, alab
lab, nreg = ndimage.label(solid)
if nreg > 1:
    sizes = ndimage.sum(solid, lab, range(1, nreg + 1))
    F = np.where(lab == int(np.argmax(sizes)) + 1, F, 2.0).astype(np.float32)
del solid, lab

v, f, _, _ = measure.marching_cubes(F, level=0.0, spacing=(VOX, VOX, VOX))
del F
v += np.array([xs[0], xs[0], zs[0]], dtype=np.float32)
print("mesh %d faces %d verts" % (len(f), len(v)), flush=True)

vol = 0.0
step = 5_000_000
for i in range(0, len(f), step):
    sl = f[i:i + step]
    a, b, c = v[sl[:, 0]], v[sl[:, 1]], v[sl[:, 2]]
    vol += float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0
vol = abs(vol)
print("volume %.1f mm3" % vol, flush=True)

m = r3.Mesh()
t = time.time()
for p in v:
    m.Vertices.Add(float(p[0]), float(p[1]), float(p[2]))
print("verts written %.1fs" % (time.time() - t), flush=True)
t = time.time()
for tri in f:
    m.Faces.AddFace(int(tri[0]), int(tri[1]), int(tri[2]))
print("faces written %.1fs" % (time.time() - t), flush=True)
t = time.time()
m.Normals.ComputeNormals()
m.Compact()
model = r3.File3dm()
model.Objects.AddMesh(m)
path = os.path.join(OUT, "reference_030mm.3dm")
model.Write(path, 8)
print("saved %s %.2f GB in %.1fs" % (path, os.path.getsize(path) / 1e9, time.time() - t), flush=True)
json.dump({"voxel_mm": VOX, "faces": int(len(f)), "vertices": int(len(v)),
           "volume_mm3": round(vol, 1), "path": path,
           "bytes": os.path.getsize(path)},
          open(os.path.join(OUT, "reference_030mm.json"), "w"), indent=2)
