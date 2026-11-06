"""Post-processing module (CPU): cleanup -> feature-preserving smoothing -> low-poly remesh -> sharp-edge auto-shading.

Tools and licences: trimesh (MIT), fast-simplification (MIT, quadric decimation),
pynanoinstantmeshes (BSD-3, Python binding of Instant Meshes, quad-dominant remeshing). No GPL deps (pymeshlab is GPL-3, avoided).

Params (all from the UI):
  target_faces      low-poly target (triangles; quads when remesh="quad"). 0 = keep
  remesh            "decimate" (triangles, quadric) | "quad" (Instant Meshes quad-dominant) | "none"
  sharp_angle       dihedral angle in degrees above which an edge is "hard" (split normals / crease)
  smooth_strength   0..1 -> Taubin passes; 0 = off
"""
from __future__ import annotations
import numpy as np
import trimesh
from trimesh import smoothing


# ---------- 1. cleanup ----------
def clean(m: trimesh.Trimesh, min_component_ratio: float = 0.02) -> trimesh.Trimesh:
    m = m.copy()
    m.merge_vertices()
    m.update_faces(m.nondegenerate_faces())
    m.update_faces(m.unique_faces())
    m.remove_unreferenced_vertices()
    comps = m.split(only_watertight=False)
    if len(comps) > 1:  # drop floating fragments
        big = max(len(c.faces) for c in comps)
        m = trimesh.util.concatenate([c for c in comps if len(c.faces) >= big * min_component_ratio])
    trimesh.repair.fill_holes(m)
    trimesh.repair.fix_normals(m)  # consistent winding, outward normals
    return m


# ---------- 2. feature-preserving smoothing ----------
def smooth(m: trimesh.Trimesh, strength: float) -> trimesh.Trimesh:
    """Taubin lambda|mu smoothing (no volume shrinkage) - removes marching-cube terracing.
    Runs BEFORE remeshing so the remesher sees a clean surface; hard edges are re-asserted at shading time."""
    it = int(round(np.clip(strength, 0, 1) * 30))
    if it:
        smoothing.filter_taubin(m, lamb=0.5, nu=-0.53, iterations=it)
    return m


# ---------- 3. low-poly remesh ----------
def _carry_colors(src: trimesh.Trimesh, v: np.ndarray):
    if src.visual.kind == "vertex":
        _, idx = src.kdtree.query(v)
        return src.visual.vertex_colors[idx]
    return None


def decimate(m: trimesh.Trimesh, target_faces: int) -> trimesh.Trimesh:
    if target_faces <= 0 or len(m.faces) <= target_faces:
        return m
    import fast_simplification
    v, f = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces,
                                        target_reduction=1.0 - target_faces / len(m.faces), agg=7)
    out = trimesh.Trimesh(v, f, process=True)
    c = _carry_colors(m, out.vertices)
    if c is not None:
        out.visual.vertex_colors = c
    return out


def quad_remesh(m: trimesh.Trimesh, target_faces: int, sharp_angle: float):
    """Instant Meshes (BSD-3). posy=4 ends with one subdivision step (x4 faces), hence target//4. Returns (triangulated Trimesh for GLB, quad face array for OBJ)."""
    import pynanoinstantmeshes as pim
    v, f = pim.remesh(m.vertices.astype(np.float32), m.faces.astype(np.uint32), vertex_count=max(target_faces // 4, 50),
                      rosy=4, posy=4, creaseAngle=float(sharp_angle), smooth_iter=2, deterministic=True)
    v, quads = np.asarray(v, np.float64), np.asarray(f, np.int64)
    tris = np.vstack([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])
    tris = tris[(tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 0] != tris[:, 2])]
    out = trimesh.Trimesh(v, tris, process=False)
    trimesh.repair.fix_normals(out)
    c = _carry_colors(m, v)
    if c is not None:
        out.visual.vertex_colors = c
    return out, (v, quads)


# ---------- 4. sharp edges + auto-shading ----------
def sharp_edges(m: trimesh.Trimesh, angle_deg: float) -> np.ndarray:
    return m.face_adjacency_edges[m.face_adjacency_angles > np.radians(angle_deg)]


def auto_smooth(m: trimesh.Trimesh, angle_deg: float) -> trimesh.Trimesh:
    """Smooth shading with split normals at hard edges (like Blender 'Shade Auto Smooth')."""
    colors = m.visual.vertex_colors if m.visual.kind == "vertex" else None
    out = trimesh.graph.smooth_shade(m, angle=np.radians(angle_deg))
    if colors is not None:  # smooth_shade re-indexes vertices; remap colours by position
        _, idx = m.kdtree.query(out.vertices)
        out.visual.vertex_colors = colors[idx]
    return out


def process_mesh(m: trimesh.Trimesh, p: dict):
    target, mode = int(p.get("target_faces", 0)), p.get("remesh", "decimate")
    angle = float(p.get("sharp_angle", 40))
    m = smooth(clean(m), float(p.get("smooth_strength", 0.3)))
    quads = None
    if target >= len(m.faces):
        mode = "none"  # never up-sample a part that is already below budget
    if mode == "quad" and target > 0:
        m, quads = quad_remesh(m, target, angle)
    elif mode != "none":
        m = decimate(m, target)
    n_sharp = int(len(sharp_edges(m, angle)))
    shaded = auto_smooth(m, angle)
    return shaded, quads, {"sharp_edges": n_sharp, "faces": int(len(m.faces)), "quads": None if quads is None else int(len(quads[1]))}


def process_parts(parts: dict, params: dict, progress) -> tuple[dict, dict, dict]:
    if params.get("split_components") and len(parts) == 1:
        (_, m), = parts.items()
        comps = sorted(clean(m).split(only_watertight=False), key=lambda c: -len(c.faces))
        if len(comps) > 1:
            parts = {f"part_{i:02d}": c for i, c in enumerate(comps)}
    out, quads, info = {}, {}, {}
    total = sum(len(m.faces) for m in parts.values()) or 1
    for i, (name, m) in enumerate(parts.items()):
        pp = dict(params)  # share the face budget between parts by their original density
        if pp.get("target_faces"):
            pp["target_faces"] = max(int(pp["target_faces"] * len(m.faces) / total), 50)
        progress(0.75 + 0.15 * i / max(len(parts), 1), f"Post-processing {name}")
        out[name], q, info[name] = process_mesh(m, pp)
        if q is not None:
            quads[name] = q
    return out, quads, info


def _write_obj(parts: dict, quads: dict, path: str):
    """OBJ with one `o` per part; writes real quads when available (better for Blender retopo)."""
    lines, off = ["# MeshForge export"], 1
    for name, m in parts.items():
        lines.append(f"o {name}")
        if name in quads:  # real quad topology from Instant Meshes
            qv, q = quads[name]
            lines += [f"v {x:.6f} {y:.6f} {z:.6f}" for x, y, z in qv]
            lines += ["f " + " ".join(str(i + off) for i in dict.fromkeys(f.tolist())) for f in q]
            off += len(qv)
        else:
            lines += [f"v {x:.6f} {y:.6f} {z:.6f}" for x, y, z in m.vertices]
            lines += [f"f {a+off} {b+off} {c+off}" for a, b, c in m.faces]
            off += len(m.vertices)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")


def export(parts: dict, glb_path: str, obj_path: str, quads: dict | None = None, info: dict | None = None) -> dict:
    scene = trimesh.Scene()
    for name, m in parts.items():
        scene.add_geometry(m, node_name=name, geom_name=name)  # separate objects in Blender
    scene.export(glb_path, include_normals=True)  # keep the split (hard-edge) normals
    _write_obj(parts, quads or {}, obj_path)
    return {"parts": list(parts), "faces": int(sum(i["faces"] for i in (info or {}).values()) or sum(len(m.faces) for m in parts.values())),
            "quads": sum((i.get("quads") or 0) for i in (info or {}).values()) or None,
            "sharp_edges": sum(i.get("sharp_edges", 0) for i in (info or {}).values()),
            "vertices": int(sum(len(m.vertices) for m in parts.values()))}
