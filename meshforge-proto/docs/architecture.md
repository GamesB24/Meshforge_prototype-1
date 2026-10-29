# MeshForge architecture (prototype)

```
Browser SPA (three.js, no build step)
   │  REST: POST /api/jobs (image + engine + runner + params), GET /api/jobs/{id} (progress), files
FastAPI server (meshforge/server.py)
   └─ JobQueue (meshforge/jobs.py): 1 worker thread → GPU jobs run one at a time, progress 0..1 + message,
        history persisted in data/jobs/<id>/{job.json,input,processed.png,mesh.glb,mesh.obj}
        1. preprocess   rembg background removal (optional) → recentre → grey composite
        2. runner.run   → {part_name: Trimesh}
        3. postprocess  clean → smooth → remesh → hard edges + auto-smooth  (per part)
        4. export       GLB (one node per part, split normals) + OBJ (one `o` per part, real quads)
```

## Engines (`meshforge/engines/`)
`Engine.load(device)` once, `Engine.generate(image, params, progress) -> EngineResult(parts={name: Trimesh})`.
Single-mesh engines return `{"mesh": m}`; part engines return `{"helmet": m1, "boot_L": m2, ...}` and everything
downstream (post-processing, GLB/OBJ export, viewer) already handles multiple named objects.
- `triposr` - implemented.
- `partcrafter` - next (8 GB laptop). `omnipart` - takes an extra mask input (your colour-coded parts). `trellis2` - cloud only.
Planned engines are listed greyed-out in the UI from `engines/__init__.py`.

## Runners (`meshforge/runners/`)
`Runner.run(engine_id, image, params, progress) -> parts`, `Runner.status()` for the UI.
- `local` - in-process; CUDA automatically if `torch.cuda.is_available()`, else CPU.
- `cloud` - wraps a `CloudAdapter.generate(engine, png, params, progress) -> glb bytes`, chosen by `MESHFORGE_CLOUD`:
  - `mock` (default) - fake progress, returns a 3-part demo mesh; free, for demos.
  - `modal` - **coded but untested**; `cloud/modal_app.py` (L4 GPU, weights cached in a Modal Volume). Creds only from `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` or `modal token new`.
  - `remote` - another MeshForge server on any GPU box via SSH tunnel (`MESHFORGE_REMOTE_URL`). This is the "remote SSH" runner.
Raw meshes come back from the cloud; post-processing always runs locally on CPU, so it is identical for every runner.

## Post-processing (`meshforge/postprocess.py`) - user-controllable, CPU
| Step | Method | UI control |
|---|---|---|
| Clean | merge duplicate verts, drop degenerate/duplicate faces, remove floating fragments (<2% of largest), fill holes, fix winding/normals | - |
| Smooth | Taubin λ/μ (0.5/−0.53): removes marching-cube terracing without Laplacian shrinkage | Smoothing 0–1 (→0–30 passes) |
| Remesh | `decimate`: quadric edge collapse (fast-simplification, MIT). `quad`: Instant Meshes field-aligned quad remesh (pynanoinstantmeshes, BSD-3) with crease angle | Remesh mode, Target faces |
| Hard edges | dihedral angle > threshold → hard edge; auto-smooth = smooth shading with normals split at hard edges (exported in GLB) | Sharp angle |
| Parts | one object per engine part, or "split loose pieces"; face budget shared by part size | checkbox |

See `postprocessing.md` for the before/after benchmark.

## Path to the game-engine vision
- Every generation is a job with typed inputs/outputs → the same queue can later run **other tools** (texture, rig, LOD, collider, script generation) as pipeline stages; jobs become nodes of an asset graph.
- Parts as named objects are the seed of a **scene graph**: later stages attach materials, colliders and scripts per part (e.g. `sword_R` → pickup + damage script).
- Runners make compute location a setting, which an engine/editor needs for heavy models (TRELLIS.2 cloud, light tools local).
- The SPA viewport becomes the editor viewport; the REST API becomes the tool API that an AI agent drives ("make the helmet lower-poly", "add a door script").
- Export stays open formats (GLB/OBJ) so assets work in Blender, Unity, Unreal and Godot meanwhile.
