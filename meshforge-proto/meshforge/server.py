"""FastAPI app: REST API + static single-page frontend. Run: python -m meshforge.server"""
from __future__ import annotations
import json, os, sys
from pathlib import Path
from dataclasses import asdict
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi import Request, Body

from .plugins.manager import PluginManager, install_log_filter
from . import autosave as autosave_mod

from .engines import list_engines, TRIPOSR_DIR_ON_PATH  # noqa: F401  (puts TripoSR on sys.path)
from .jobs import JobQueue
from .runners import RUNNERS

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
app = FastAPI(title="MeshForge prototype")
jobs = JobQueue()
PLUGINS = Path(__file__).resolve().parent.parent / "plugins"
plugin_manager = PluginManager(PLUGINS)
install_log_filter()




@app.get("/api/plugins")
def enabled_plugins():
    return [p for p in plugin_manager.scan() if p["enabled"]]


@app.get("/api/plugins/all")
def all_plugins():
    return plugin_manager.scan()


@app.post("/api/plugins/{pid}/enabled")
def set_plugin_enabled(pid: str, request: dict = Body(...)):
    plugin_manager.set_enabled(pid, bool(request.get("enabled")))
    return {"ok": True, "reloadRequired": True}


@app.get("/api/plugins/{pid}/jobs/{job_id}")
def plugin_job_status(pid: str, job_id: str):
    from .plugins import jobs as plugin_jobs
    job = plugin_jobs.get(pid, job_id)
    if not job:
        raise HTTPException(404, "No such plugin job")
    return job


# Zip install and backend import happen before the catch-all frontend mount.
for plugin in plugin_manager.scan(app):
    directory = PLUGINS / plugin["id"]
    if directory.is_dir():
        app.mount(f"/plugins/{plugin['id']}", StaticFiles(directory=str(directory)), name=f"plugin-{plugin['id']}")


@app.get("/api/autosave/settings")
def autosave_settings():
    return autosave_mod.status()


@app.post("/api/autosave/settings")
def autosave_settings_save(body: dict = Body(...)):
    if "dir" in body and body.get("dir"):
        info = autosave_mod.check_dir(body["dir"])
        if not info["ok"]:
            raise HTTPException(400, info["reason"] or "Folder is not writable")
        body = {**body, "dir": info["path"]}
    saved = autosave_mod.save_settings(body)
    return {"ok": True, "settings": saved, "status": autosave_mod.status()}


@app.post("/api/autosave/check")
def autosave_check(body: dict = Body(...)):
    return autosave_mod.check_dir(body.get("path") or body.get("dir") or "")


@app.post("/api/autosave/choose")
def autosave_choose():
    return autosave_mod.try_native_folder()


@app.post("/api/autosave")
async def autosave_write(request: Request):
    # Headers are ignored on purpose. A plugin secret must not land in the file or the manifest.
    data = await request.body()
    if len(data) > 80 * 1024 * 1024:
        raise HTTPException(413, "Autosave is too large")
    reason = request.query_params.get("reason") or "interval"
    folder = autosave_mod.active_dir()
    meta = autosave_mod.rotate_write(folder, data, reason)
    meta["dir"] = str(folder)
    return {"ok": True, **meta}


@app.get("/api/autosave/file/{name}")
def autosave_file(name: str):
    try:
        path = autosave_mod.read_copy(name)
    except FileNotFoundError:
        raise HTTPException(404, "No such autosave")
    return FileResponse(path, filename=name, media_type="application/zip")


@app.post("/api/projects/save")
async def project_save(request: Request):
    """Write a .mfproj the user named. The folder must already be writable."""
    raw = request.query_params.get("path") or ""
    if not raw.lower().endswith(".mfproj"):
        raise HTTPException(400, "Project path must end with .mfproj")
    dest = Path(raw).expanduser()
    info = autosave_mod.check_dir(str(dest.parent))
    if not info["ok"]:
        raise HTTPException(400, info["reason"] or "Folder is not writable")
    data = await request.body()
    if len(data) > 80 * 1024 * 1024:
        raise HTTPException(413, "Project is too large")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".mfproj.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    autosave_mod.save_settings({"projectPath": str(dest), "lastManualSave": __import__("time").time()})
    return {"ok": True, "path": str(dest)}


@app.get("/api/config")
def config():
    runners = []
    for r in RUNNERS.values():
        try: runners.append(r.status())
        except Exception: runners.append({"id": "local" if r is RUNNERS.get("local") else "cloud", "device": "Unavailable (dependencies not installed)", "adapter": "unavailable"})
    return {"engines": [asdict(e) for e in list_engines()], "runners": runners}


@app.post("/api/jobs")
async def create_job(image: UploadFile = File(...), engine: str = Form("triposr"), runner: str = Form("local"),
                     remove_bg: bool = Form(True), params: str = Form("{}")):
    data = await image.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "Image too large (20 MB max)")
    try:
        j = jobs.submit(data, engine, runner, remove_bg, json.loads(params or "{}"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return asdict(j)


@app.get("/api/jobs")
def list_jobs():
    return sorted((asdict(j) for j in jobs.jobs.values()), key=lambda j: -j["created"])


def _job(jid):
    j = jobs.jobs.get(jid)
    if not j:
        raise HTTPException(404, "No such job")
    return j


@app.get("/api/jobs/{jid}")
def get_job(jid: str):
    return asdict(_job(jid))


@app.get("/api/jobs/{jid}/{name}")
def job_file(jid: str, name: str):
    if name not in ("mesh.glb", "mesh.obj", "raw.glb", "input", "processed.png"):
        raise HTTPException(404)
    path = Path(_job(jid).dir) / name
    if not path.is_file():
        raise HTTPException(404, "Not ready")
    return FileResponse(path, filename=f"meshforge_{jid}_{name}" if name.endswith((".glb", ".obj")) else None)


@app.delete("/api/jobs/{jid}")
def delete_job(jid: str):
    import shutil
    j = _job(jid)
    if j.status in ("queued", "running"):
        raise HTTPException(409, "Job is still running")
    shutil.rmtree(j.dir, ignore_errors=True); jobs.jobs.pop(jid)
    return {"ok": True}


# v6: scene files (scene.json + meshes/) live in data/scenes/<name>/ (or MESHFORGE_SCENES_DIR) and are served at /scenes/
SCENES = Path(os.environ.get("MESHFORGE_SCENES_DIR") or (Path(__file__).resolve().parent.parent / "data" / "scenes"))
SCENES.mkdir(parents=True, exist_ok=True)


@app.get("/api/scenes")
def list_scenes():
    out = []
    for p in sorted(SCENES.glob("*/scene.json")) + sorted(SCENES.glob("*.json")):
        rel = p.relative_to(SCENES).as_posix()
        out.append({"name": p.parent.name if p.name == "scene.json" else p.stem, "url": f"/scenes/{rel}", "open": f"/?scene=/scenes/{rel}"})
    return out


app.mount("/scenes", StaticFiles(directory=str(SCENES)), name="scenes")
app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("MESHFORGE_PORT", "8000"))
    if os.environ.get("MESHFORGE_OPEN_BROWSER") == "1":  # set by run_windows.bat
        import threading, webbrowser
        threading.Timer(2.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    uvicorn.run(app, host=os.environ.get("MESHFORGE_HOST", "127.0.0.1"), port=port, log_config={"version": 1, "disable_existing_loggers": False, "filters": {"plugin_secrets": {"()": "meshforge.plugins.manager.SecretHeaderFilter"}}, "formatters": {"default": {"()": "uvicorn.logging.DefaultFormatter", "fmt": "%(levelprefix)s %(message)s"}, "access": {"()": "uvicorn.logging.AccessFormatter", "fmt": "%(levelprefix)s %(client_addr)s - \"%(request_line)s\" %(status_code)s"}}, "handlers": {"default": {"class": "logging.StreamHandler", "formatter": "default", "filters": ["plugin_secrets"]}, "access": {"class": "logging.StreamHandler", "formatter": "access", "filters": ["plugin_secrets"]}}, "loggers": {"uvicorn": {"handlers": ["default"], "level": "INFO"}, "uvicorn.error": {"level": "INFO"}, "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False}}})
