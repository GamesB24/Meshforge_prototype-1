# MeshForge integration entry point (v5.1)

> v6: to load **whole multi-object scenes** (scene.json or a multi-node GLB), see [scene-import.md](scene-import.md): `MeshForge.loadScene(...)`, `?scene=<url>`, `meshforge.scene.write_manifest/validate_manifest`.

For other programs (e.g. the Scene From Photo bot) that need **one mesh from one cut-out image** without the browser.
Three ways in: Python function, CLI, HTTP. All three run the same pipeline as the UI's Generate button
(`meshforge.jobs.run_pipeline`: preprocess → engine → raw.glb → cleanup/smooth/decimate or quad-remesh → mesh.glb + mesh.obj).

## 1. Python: `meshforge.api.generate_mesh`

Run from the repo root (or put it on `PYTHONPATH`), inside the venv that `setup_windows.bat` / `run.sh` created.

```python
from meshforge.api import generate_mesh, generate_many

r = generate_mesh(
    "cutouts/chair.png", "out/chair",
    engine="triposr",        # only local engine today
    device="auto",           # "auto" | "cpu" | "cuda" | "cuda:0" (applies on first load in the process)
    remove_bg=False,         # rembg; skipped automatically when the image already has alpha
    mc_resolution=256,       # marching-cubes grid, 32..512 (UI default 256)
    simplify_faces=None,     # triangle budget, e.g. 8000; None = keep engine density
    quads=False,             # quad remesh to ~simplify_faces (needs simplify_faces); OBJ gets real quads
    formats=("glb", "obj"),
    foreground_ratio=0.85,   # object size in frame after recentring (0.3..1.0)
    seed=None,
    runner="local",          # extra: "cloud" uses MESHFORGE_CLOUD (default "mock" = free demo mesh, no GPU)
    progress=None,           # extra: callback(fraction, message)
)
if r["ok"]:
    print(r["glb"], r["obj"], r["raw_glb"], r["stats"])
else:
    print("failed:", r["error"])
```

Return value (always a dict, never raises):

```json
{"ok": true, "glb": ".../mesh.glb", "obj": ".../mesh.obj", "raw_glb": ".../raw.glb",
 "processed_png": ".../processed.png", "out_dir": "...", "error": "", "api_version": "1",
 "stats": {"vertices": 6125, "triangles": 12088, "quads": null, "parts": ["mesh"], "seconds": 31.2,
           "device": "cuda:0", "engine": "triposr", "runner": "local", "had_alpha": true,
           "remove_bg_ran": false, "params": {...}}}
```

Notes
- Output files in `out_dir`: `mesh.glb`, `mesh.obj`, `raw.glb` (unprocessed engine output), `processed.png` (what the engine saw), `result.json`. Existing files are overwritten; use one `out_dir` per object.
- Both GLB and OBJ are always written; `formats` only controls which paths are reported.
- The engine is loaded on the first call (TripoSR weights come from Hugging Face on first ever use, ~1.7 GB) and stays cached for later calls in the same process. Calls are serialised with a lock (one GPU). For many objects, keep one Python process alive or use `generate_many`.
- Output is Y-up, metres are arbitrary (TripoSR outputs roughly unit size). The mesh is not placed or scaled for a scene; the caller does that.
- Alpha cut-outs: the alpha bounding box is cropped, padded so the object fills `foreground_ratio`, and composited on grey (what TripoSR expects). A fully transparent image returns `ok=false`. RGB input without `remove_bg=True` is used as-is.
- Difference from the UI: the UI only recentres when it runs rembg; the API also recentres images that already have alpha. Same engine, same postprocess.

Batch:

```python
results = generate_many([
    {"id": "chair", "image_path": "cut/chair.png", "out_dir": "out/chair"},
    {"id": "lamp",  "image_path": "cut/lamp.png",  "out_dir": "out/lamp", "simplify_faces": 4000},
], mc_resolution=256)          # keyword defaults apply to every job; per-job keys win
# -> list of result dicts in order, each with "index" and your "id"; stop_on_error=False by default
```

## 2. CLI

```
python -m meshforge.api --image cut/chair.png --out out/chair [--simplify-faces 8000] [--quads]
       [--mc-resolution 256] [--foreground-ratio 0.85] [--device auto|cpu|cuda] [--remove-bg]
       [--formats glb,obj] [--seed N] [--runner local|cloud] [--quiet]
python -m meshforge.api --batch jobs.json          # list of {image_path, out_dir, ...}
```

stdout is exactly one JSON document (the result dict, or a list for `--batch`); progress and native-library chatter go to stderr. Exit code 0 = ok, 1 = generation failed, 2 = bad CLI input.

## 3. HTTP (server running: `run_windows.bat` or `python -m meshforge.server`, default http://127.0.0.1:8000)

- `POST /api/jobs` multipart form: `image` (file, ≤20 MB), `engine` (default `triposr`), `runner` (`local`|`cloud`, default `local`), `remove_bg` (bool, **default true**), `params` (JSON string). Returns the job object (`id`, `status`, ...).
- `params` keys: `resolution` (mc grid), `fg_ratio`, `remesh` (`none`|`decimate`|`quad`), `target_faces` (0 = none), `sharp_angle`, `smooth_strength`, `split_components`, `postprocess` (default true).
- `GET /api/jobs/{id}` → `status` (`queued`|`running`|`done`|`error`), `progress`, `message`, `error`, `stats`.
- `GET /api/jobs/{id}/{name}` with name in `mesh.glb`, `mesh.obj`, `raw.glb`, `processed.png`, `input`.
- `GET /api/jobs` lists history, `DELETE /api/jobs/{id}` deletes a finished job, `GET /api/config` lists engines/runners.
- The HTTP route does not do the API's alpha recentring (it matches the UI exactly).

```python
import json, time, requests
BASE = "http://127.0.0.1:8000"
params = {"resolution": 256, "fg_ratio": 0.85, "remesh": "decimate", "target_faces": 8000,
          "sharp_angle": 40, "smooth_strength": 0.3}
with open("cut/chair.png", "rb") as f:
    r = requests.post(f"{BASE}/api/jobs", files={"image": ("chair.png", f, "image/png")},
                      data={"engine": "triposr", "runner": "local", "remove_bg": "false",
                            "params": json.dumps(params)}, timeout=30)
r.raise_for_status(); jid = r.json()["id"]
while True:
    j = requests.get(f"{BASE}/api/jobs/{jid}", timeout=30).json()
    if j["status"] in ("done", "error"): break
    print(f"{j['progress']:.0%} {j['message']}"); time.sleep(1)
if j["status"] == "error": raise RuntimeError(j["error"])
for name in ("mesh.glb", "mesh.obj", "raw.glb"):
    resp = requests.get(f"{BASE}/api/jobs/{jid}/{name}", timeout=120)
    if resp.ok: open(f"out_{name}", "wb").write(resp.content)
print(j["stats"])
```

## 4. JS: load a result into the MeshForge viewer/editor

`frontend/app.js` exposes `window.MeshForge` (additive; `window.__meshforge` is unchanged):

```js
// in the MeshForge page (devtools, a bookmarklet, or Playwright page.evaluate)
await MeshForge.loadGLB('/api/jobs/<id>/mesh.glb');      // URL
await MeshForge.loadGLB(fileOrBlob);                     // Blob / File
await MeshForge.loadGLB(arrayBuffer);                    // ArrayBuffer
const blob = await MeshForge.exportGLB();                // current model incl. edits/sculpting -> Blob (model/gltf-binary)
MeshForge.model;                                         // the loaded THREE.Object3D
```

`loadGLB` replaces the current model (like the import button), resolves with the loaded object and rejects on a bad URL/file. `exportGLB` rejects if no model is loaded.
