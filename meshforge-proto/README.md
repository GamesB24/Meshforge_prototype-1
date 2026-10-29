# MeshForge prototype - image → 3D, local GPU or cloud GPU

Drop an image, pick an engine and **Run on: Local GPU / Cloud GPU**, get a cleaned, low-poly (optionally quad) mesh as GLB/OBJ in a DCC-style 3D viewport.
Engine now: **TripoSR** (MIT). Planned: PartCrafter (next, fits 8 GB), OmniPart, TRELLIS.2 (cloud).

![viewport](docs/img/ui_viewport.png)

Docs: [requirements & cloud research](docs/requirements.md) · [architecture](docs/architecture.md) · [post-processing benchmark](docs/postprocessing.md) · [licensing](docs/licensing.md)

## Windows (RTX 4060) - native, recommended
**See [WINDOWS.md](WINDOWS.md).** No Ubuntu/WSL: double-click `setup_windows.bat` once, then `run_windows.bat`
(opens http://127.0.0.1:8000). `diagnose_windows.bat` writes `diagnose.txt` for troubleshooting.

<details><summary>Alternative: WSL2 (advanced)</summary>

In **PowerShell (admin)**: `wsl --install -d Ubuntu-22.04`, reboot, open Ubuntu. Keep the normal NVIDIA Windows driver; don't install a Linux driver in WSL.
```bash
sudo apt update && sudo apt install -y python3.11 python3.11-venv git build-essential
nvidia-smi                                  # must show the RTX 4060
git clone <your repo url> meshforge-proto && cd meshforge-proto   # or copy this folder in
PYTHON=python3.11 ./run.sh --setup          # first time: venv, CUDA torch, TripoSR, deps
./run.sh                                     # every other time
```
Open **http://127.0.0.1:8000** in your Windows browser. Stop with Ctrl+C.
</details>

## Linux
```bash
sudo apt install -y python3.11 python3.11-venv git build-essential
PYTHON=python3.11 ./run.sh --setup && ./run.sh
```
No NVIDIA GPU? `run.sh` installs CPU wheels; a generation then takes ~25–45 s and ~3 GB RAM.

## Cloud GPU (optional - costs money)
- `MESHFORGE_CLOUD=mock ./run.sh` (default): demo adapter, free, returns a sample 3-part mesh.
- **Modal (coded, UNTESTED):** `pip install modal && modal token new && modal deploy cloud/modal_app.py`, then `MESHFORGE_CLOUD=modal ./run.sh`. Credentials only via `modal token new` or `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET`; nothing is stored by MeshForge.
- **Your own GPU box:** run MeshForge there, then locally `ssh -L 9000:127.0.0.1:8000 user@gpu-host` and `MESHFORGE_CLOUD=remote MESHFORGE_REMOTE_URL=http://127.0.0.1:9000 ./run.sh`. Never expose the port publicly.

## Viewport controls
MMB drag orbit · Shift+MMB pan · wheel zoom · left button follows the tool shelf (orbit/pan/zoom) · Numpad 1/3/7 front/right/top (Ctrl = opposite; 1/3/7 on the top row also work) · 5 persp/ortho · `.` or Home frame · Z toggle wireframe · click gizmo axes to snap. Shading: wireframe / solid / matcap / vertex colour, wireframe overlay, grid.

## Layout
```
meshforge/  server.py (FastAPI) · jobs.py (queue + history) · preprocess.py · postprocess.py
            engines/ (base.py, triposr.py, registry) · runners/ (local.py, cloud.py: mock/modal/remote)
frontend/   index.html · style.css · app.js · vendor/ (three.js 0.170, MIT)
cloud/      modal_app.py (untested)
tools_compare.py   before/after post-processing benchmark
run.sh             one-command setup/launch (Linux/WSL)
*_windows.bat      Windows setup / run / diagnose (call scripts/*.ps1)
```
API: `POST /api/jobs` (multipart: image, engine, runner, remove_bg, params JSON) · `GET /api/jobs[/{id}]` · `GET /api/jobs/{id}/mesh.glb|mesh.obj|input|processed.png` · `DELETE /api/jobs/{id}` · `GET /api/config`.
Params: `resolution` 128–384, `remesh` decimate|quad|none, `target_faces`, `sharp_angle` (deg), `smooth_strength` 0–1, `split_components`.
