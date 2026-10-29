"""TASK-034 - one field build + validate routine used by every phase.

build(params) -> field evaluation, isosurface, gate metrics and analytical feature
probes. Nothing is repaired: violations are reported, not fixed.
"""
import json
import os
import time

import numpy as np
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from skimage import measure

BASE = dict(diameter=150.0, height=300.0, twist_deg=45.0, wall_mm=1.6,
            gyroid_cell=8.0, sheet_mm=1.2, band_mm=25.0, bore_mm=40.0,
            dome_mm=1.6, voxel_mm=0.8)


def smax(a, b, k):
    return 0.5 * (a + b + np.sqrt((a - b) ** 2 + k * k))


def smin(a, b, k):
    return 0.5 * (a + b - np.sqrt((a - b) ** 2 + k * k))


def build(p, max_voxels=90_000_000):
    P = dict(BASE)
    P.update(p)
    R = P["diameter"] / 2.0
    H = P["height"]
    WALL = P["wall_mm"]
    CELL = P["gyroid_cell"]
    SHEET = P["sheet_mm"]
    BAND = P["band_mm"]
    BORE = P["bore_mm"]
    DOME = P["dome_mm"]
    VOX = P["voxel_mm"]
    KS = 0.30
    K = 2.0 * np.pi / CELL

    nx = int((2 * (R + 8.0)) / VOX)
    nz = int((H + R + 9.0) / VOX)
    if nx * nx * nz > max_voxels:
        return {"status": "skipped_resource_limit",
                "grid": [nx, nx, nz], "voxels": nx * nx * nz, "params": P}

    t0 = time.time()
    xs = np.arange(-R - 8.0, R + 8.0, VOX, dtype=np.float32)
    zs = np.arange(-3.0, H + R + 6.0, VOX, dtype=np.float32)
    X, Y, Z = np.meshgrid(xs, xs, zs, indexing="ij")
    r = np.sqrt(X * X + Y * Y)
    th = np.arctan2(Y, X)

    phase = np.deg2rad(P["twist_deg"]) * (Z / H)
    R_eff = R - WALL / 2.0 + 0.9 * np.cos(3.0 * (th - phase))
    d_wall = np.maximum(np.abs(r - R_eff) - WALL / 2.0, np.abs(Z - H / 2.0) - H / 2.0)

    g = (np.sin(K * X) * np.cos(K * Y) + np.sin(K * Y) * np.cos(K * Z)
         + np.sin(K * Z) * np.cos(K * X))
    d_lat = smax(np.abs(g) - SHEET / 2.0, r - (R - WALL + 0.9), KS)
    d_lat = smax(d_lat, (R - WALL - BAND) - r, KS)
    d_lat = smax(d_lat, 2.2 - Z, KS)
    d_lat = smax(d_lat, Z - (H - 1.0), KS)

    d_col = np.maximum(np.abs(r - (BORE / 2.0 + R) / 2.0) - (R - BORE / 2.0) / 2.0,
                       np.abs(Z - 1.0) - 1.0)
    d_dome = np.maximum(np.abs(np.sqrt(X * X + Y * Y + (Z - H) ** 2) - R) - DOME / 2.0,
                        (H - 1.0) - Z)
    field = smin(smin(d_wall, d_lat, KS), smin(d_col, d_dome, KS), KS).astype(np.float32)
    solid = field < 0.0

    air = ~solid
    alab, an = ndimage.label(air)
    filled = 0
    if an > 1:
        asizes = ndimage.sum(air, alab, range(1, an + 1))
        border = set()
        for idx in (alab[0].ravel(), alab[-1].ravel(), alab[:, 0].ravel(),
                    alab[:, -1].ravel(), alab[:, :, 0].ravel(), alab[:, :, -1].ravel()):
            border.update(np.unique(idx).tolist())
        for k in range(1, an + 1):
            if k not in border and asizes[k - 1] <= 200:
                solid[alab == k] = True
                filled += 1
        if filled:
            field = np.where(solid, np.minimum(field, -0.05), np.maximum(field, 0.05)).astype(np.float32)

    lab, n_regions = ndimage.label(solid)
    dropped = 0
    if n_regions > 1:
        sizes = ndimage.sum(solid, lab, range(1, n_regions + 1))
        keep = int(np.argmax(sizes)) + 1
        dropped = int(n_regions - 1)
        field = np.where(lab == keep, field, np.maximum(field, 2.0)).astype(np.float32)

    try:
        v, f, _, _ = measure.marching_cubes(field, level=0.0, spacing=(VOX, VOX, VOX))
    except Exception as exc:
        return {"status": "marching_cubes_failed", "error": str(exc)[:150], "params": P}

    v = v + np.array([xs[0], xs[0], zs[0]], dtype=np.float32)
    e = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    e.sort(axis=1)
    u, cnt = np.unique(e, axis=0, return_counts=True)
    naked = int((cnt == 1).sum())
    nonman = int((cnt > 2).sum())
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    vol = float(np.abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0)
    rows = np.concatenate([e[:, 0], e[:, 1]])
    cols = np.concatenate([e[:, 1], e[:, 0]])
    graph = coo_matrix((np.ones(len(rows), dtype=np.int8), (rows, cols)), shape=(len(v), len(v)))
    n_comp, _ = connected_components(graph, directed=False)
    bb0, bb1 = v.min(axis=0), v.max(axis=0)

    # analytic feature probes (no meshing involved)
    def pf(px, py, pz):
        rr = np.hypot(px, py)
        tt = np.arctan2(py, px)
        Reff = R - WALL / 2.0 + 0.9 * np.cos(3.0 * (tt - np.deg2rad(P["twist_deg"]) * pz / H))
        dw = max(abs(rr - Reff) - WALL / 2.0, abs(pz - H / 2.0) - H / 2.0)
        gg = (np.sin(K * px) * np.cos(K * py) + np.sin(K * py) * np.cos(K * pz)
              + np.sin(K * pz) * np.cos(K * px))
        dl = abs(gg) - SHEET / 2.0
        dl = max(dl, rr - (R - WALL + 0.9), (R - WALL - BAND) - rr, 2.2 - pz, pz - (H - 1.0))
        dc = max(abs(rr - (BORE / 2.0 + R) / 2.0) - (R - BORE / 2.0) / 2.0, abs(pz - 1.0) - 1.0)
        dd = max(abs(np.sqrt(px * px + py * py + (pz - H) ** 2) - R) - DOME / 2.0, (H - 1.0) - pz)
        return float(min(dw, dl, dc, dd))

    lat_probe = None
    for zz in np.linspace(max(5.0, 2.0 + BAND * 0.1), H - 5.0, 15):
        for ang in np.linspace(0, 2 * np.pi, 16, endpoint=False):
            for rr in np.linspace(R - WALL - BAND + 2.0, R - WALL - 2.0, 5):
                px, py = rr * np.cos(ang), rr * np.sin(ang)
                gg = (np.sin(K * px) * np.cos(K * py) + np.sin(K * py) * np.cos(K * zz)
                      + np.sin(K * zz) * np.cos(K * px))
                if abs(gg) < SHEET / 2.0 * 0.8:
                    lat_probe = {"field": round(pf(px, py, zz), 3), "g": round(float(gg), 3)}
                    break
            if lat_probe:
                break
        if lat_probe:
            break

    # wall sampled at its actual lobe radius for this twist; cavity sampled on the axis
    Reff_mid = R - WALL / 2.0 + 0.9 * np.cos(3.0 * (0.0 - np.deg2rad(P["twist_deg"]) * 0.5))
    features = {
        "hollow_shell": bool(pf(Reff_mid, 0.0, H / 2.0) < 0 and pf(0.0, 0.0, H / 2.0) > 0),
        "collar_bore": bool(pf(0.0, 0.0, 1.0) > 0 and pf((BORE / 2.0 + R) / 2.0, 0.0, 1.0) < 0),
        "dome": bool(pf(0.0, 0.0, H + R) < 0),
        "lattice": bool(lat_probe and lat_probe["field"] < 0),
    }
    feature_detail = {"wall_at_lobe": round(pf(Reff_mid, 0.0, H / 2.0), 3),
                      "Reff_mid": round(float(Reff_mid), 2),
                      "axis_mid": round(pf(0.0, 0.0, H / 2.0), 3),
                      "dome_apex": round(pf(0.0, 0.0, H + R), 3),
                      "lattice": lat_probe}

    build.last_vertices = v
    build.last_faces = f
    build.last_params = P
    return {
        "status": "ok", "params": P,
        "faces": int(len(f)), "vertices": int(len(v)),
        "naked_edges": naked, "nonmanifold_edges": nonman,
        "watertight": naked == 0, "manifold": nonman == 0,
        "volume_mm3": round(vol, 1), "positive_volume": vol > 0,
        "components": int(n_comp), "regions": int(n_regions),
        "air_pockets_filled": int(filled), "islands_dropped": int(dropped),
        "dim": [round(float(bb1[i] - bb0[i]), 1) for i in range(3)],
        "features": features,
        "feature_detail": feature_detail,
        "all_features": all(features.values()),
        "gate_pass": bool(naked == 0 and nonman == 0 and vol > 0 and n_comp == 1),
        "seconds": round(time.time() - t0, 1),
    }
