"""Before/after benchmark of the post-processing module on a TripoSR mesh. Usage: python tools_compare.py mesh.obj docs/img/compare.png"""
import sys, io, contextlib, os, time, numpy as np, trimesh, matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meshforge import postprocess as pp

raw = trimesh.load(sys.argv[1], force="mesh", process=False)
cfgs = [("Raw TripoSR", None), ("Clean + Taubin 0.3", dict(remesh="none", smooth_strength=0.3)),
        ("Decimate 8k tris", dict(remesh="decimate", target_faces=8000, smooth_strength=0.3, sharp_angle=40)),
        ("Decimate 3k tris", dict(remesh="decimate", target_faces=3000, smooth_strength=0.3, sharp_angle=40)),
        ("Quad remesh ~4k", dict(remesh="quad", target_faces=4000, smooth_strength=0.3, sharp_angle=40)),
        ("Quad remesh ~1.5k", dict(remesh="quad", target_faces=1500, smooth_strength=0.3, sharp_angle=40))]
fig = plt.figure(figsize=(15, 11)); rows = []
for k, (name, p) in enumerate(cfgs):
    t = time.time()
    if p is None:
        m, info = raw, {"faces": len(raw.faces), "quads": None, "sharp_edges": len(pp.sharp_edges(raw, 40))}
    else:
        with contextlib.redirect_stdout(io.StringIO()):
            m, q, info = pp.process_mesh(raw, p)
    dt = time.time() - t
    lab = f"{info['quads']} quads" if info["quads"] else f"{info['faces']} tris"
    rows.append((name, lab, info["sharp_edges"], f"{dt:.1f}s"))
    v = m.vertices - raw.vertices.mean(0); tri = v[m.faces]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    L = np.array([0.5, -0.8, 0.6]); L /= np.linalg.norm(L)
    shade = np.clip(n @ L, 0, 1) * 0.65 + 0.3
    ax = fig.add_subplot(2, 3, k + 1, projection="3d")
    low = len(m.faces) < 40000
    ax.add_collection3d(Poly3DCollection(tri, facecolors=np.c_[np.repeat(shade[:, None], 3, 1) * [0.85, 0.82, 0.78]],
                                         edgecolors=(0, 0, 0, 0.25) if low else None, linewidths=0.15 if low else 0))
    r = 0.62 * np.abs(raw.vertices - raw.vertices.mean(0)).max(); ax.set_xlim(-r, r); ax.set_ylim(-r, r); ax.set_zlim(-r, r)
    ax.view_init(elev=12, azim=-60); ax.axis("off"); ax.set_title(f"{name}\n{lab}", fontsize=10)
fig.savefig(sys.argv[2], dpi=110, bbox_inches="tight")
print("| Stage | Faces | Hard edges (>40°) | CPU time |\n|---|---|---|---|")
for r in rows: print("| " + " | ".join(map(str, r)) + " |")
