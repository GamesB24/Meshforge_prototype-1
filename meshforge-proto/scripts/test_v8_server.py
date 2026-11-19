"""v8 server checks: image cap, autosave rotation, and that a plugin key never hits disk or logs."""
from __future__ import annotations
import io
import logging
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["MESHFORGE_DATA"] = tempfile.mkdtemp(prefix="mf-v8-")
os.environ.setdefault("MESHFORGE_HOST", "127.0.0.1")

from PIL import Image
from fastapi.testclient import TestClient

from meshforge.preprocess import fit_input, clamp_input_size
from meshforge.autosave import check_dir, rotate_write, list_autosaves, scrub_text
from meshforge.server import app

KEY = "MFTESTKEY-v8-do-not-leak-91c4"
ROOT = Path(__file__).resolve().parents[1]


def test_input_cap():
    big = Image.new("RGB", (3000, 1500), (20, 40, 60))
    fitted = fit_input(big, 1024)
    assert max(fitted.size) == 1024, fitted.size
    assert fitted.size[0] > fitted.size[1]
    small = Image.new("RGB", (180, 90), (1, 2, 3))
    assert fit_input(small).size == (180, 90)
    assert clamp_input_size(4096) == 1024
    assert clamp_input_size(256) == 256
    asked = fit_input(big, 256)
    assert max(asked.size) == 256


def test_autosave_rotation_and_scrub():
    folder = Path(tempfile.mkdtemp(prefix="mf-as-"))
    assert check_dir(str(folder))["writable"] is True
    missing = check_dir("/proc/does-not-exist-mf/nope")
    assert missing["writable"] is False
    for i in range(7):
        rotate_write(folder, f"copy-{i}".encode(), "interval")
    names = [p.name for p in sorted(folder.glob("autosave-*.mfproj"))]
    assert names == [f"autosave-{i}.mfproj" for i in range(1, 6)], names
    newest = (folder / "autosave-1.mfproj").read_bytes()
    assert newest == b"copy-6"
    assert "copy-0" not in {p.read_bytes() for p in folder.glob("autosave-*.mfproj")}
    assert scrub_text(f"X-Plugin-Secret-Gemini: {KEY}") == "X-Plugin-Secret-Gemini: [REDACTED]"
    listed = list_autosaves(folder)
    assert len(listed) == 5


def test_key_does_not_land_on_disk():
    log = io.StringIO()
    handler = logging.StreamHandler(log)
    logging.getLogger().addHandler(handler)
    access = logging.getLogger("uvicorn.access")
    access.addHandler(handler)
    client = TestClient(app)
    try:
        job = client.post("/api/plugins/_example/work", headers={"X-Plugin-Secret-Gemini": KEY})
        assert job.status_code == 200, job.text
        job_id = job.json()["job_id"]
        status = {}
        for _ in range(40):
            status = client.get(f"/api/plugins/_example/jobs/{job_id}").json()
            if status["status"] in ("done", "error"):
                break
            time.sleep(0.05)
        assert status["status"] == "done", status
        assert KEY not in str(status)
        saved = client.post("/api/autosave?reason=test", content=b"PK\x03\x04project-without-key", headers={"X-Plugin-Secret-Gemini": KEY, "Content-Type": "application/octet-stream"})
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert KEY not in str(body)
        folder = Path(body["dir"])
        blob = (folder / "autosave-1.mfproj").read_bytes()
        assert KEY.encode() not in blob
        side = (folder / "autosave-1.json").read_text()
        assert KEY not in side
    finally:
        logging.getLogger().removeHandler(handler)
        access.removeHandler(handler)
    text = log.getvalue()
    assert KEY not in text, text
    hits = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if path.name == "test_v8_server.py":
            continue
        if any(part in {".venv", "node_modules", "__pycache__"} for part in path.parts):
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if KEY.encode() in data:
            hits.append(str(path))
    assert not hits, hits


if __name__ == "__main__":
    test_input_cap()
    test_autosave_rotation_and_scrub()
    test_key_does_not_land_on_disk()
    print("server tests ok")
