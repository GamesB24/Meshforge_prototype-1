"""FastAPI app: REST API + static single-page frontend. Run: python -m meshforge.server"""
from __future__ import annotations
import json, os, sys
from pathlib import Path
from dataclasses import asdict
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .engines import list_engines, TRIPOSR_DIR_ON_PATH  # noqa: F401  (puts TripoSR on sys.path)
from .jobs import JobQueue
from .runners import RUNNERS

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
app = FastAPI(title="MeshForge prototype")
jobs = JobQueue()


@app.get("/api/config")
def config():
    return {"engines": [asdict(e) for e in list_engines()], "runners": [r.status() for r in RUNNERS.values()]}


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


app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("MESHFORGE_PORT", "8000"))
    if os.environ.get("MESHFORGE_OPEN_BROWSER") == "1":  # set by run_windows.bat
        import threading, webbrowser
        threading.Timer(2.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    uvicorn.run(app, host=os.environ.get("MESHFORGE_HOST", "127.0.0.1"), port=port)
