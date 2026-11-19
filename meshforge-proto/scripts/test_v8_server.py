"""v8 server checks: image cap, autosave rotation, and that a plugin key never hits disk or logs."""
from __future__ import annotations
import io
import json
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
GOOGLE = "MFTESTGOOGLE-v8-do-not-leak-22ab"
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


def test_agent_proxy_and_leak():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            return

        def _send(self, code, payload):
            raw = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            auth = self.headers.get("Authorization") or self.headers.get("x-api-key") or ""
            if KEY not in auth:
                self._send(401, {"error": "no"})
                return
            self._send(200, {"data": [{"id": "mock-model"}]})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            self.rfile.read(length)
            if self.path.endswith("/chat/completions"):
                self._send(200, {"choices": [{"message": {"content": "listed", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "list_objects", "arguments": "{}"}}]}}]})
                return
            if self.path.endswith("/messages"):
                if KEY not in (self.headers.get("x-api-key") or ""):
                    self._send(401, {"error": "no"})
                    return
                self._send(200, {"content": [{"type": "text", "text": "listed"}, {"type": "tool_use", "id": "c1", "name": "list_objects", "input": {}}]})
                return
            if self.path.endswith("/images/generations"):
                self._send(200, {"data": [{"b64_json": "aaaa"}]})
                return
            if "generateContent" in self.path:
                if self.headers.get("x-goog-api-key") != GOOGLE:
                    self._send(401, {"error": "no"})
                    return
                self._send(200, {"candidates": [{"content": {"parts": [{"inlineData": {"data": "bbbb"}}]}}]})
                return
            self._send(404, {})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    import threading
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}/v1"
    client = TestClient(app)
    bad = client.post("/api/plugins/ai-agent/connect", json={"provider": "openai", "base": base}, headers={"X-Plugin-Secret-Provider": "wrong-key"})
    assert bad.status_code == 200 and bad.json()["status"] == "invalid", bad.text
    assert KEY not in bad.text and "wrong-key" not in bad.text
    ok = client.post("/api/plugins/ai-agent/connect", json={"provider": "openai", "base": base}, headers={"X-Plugin-Secret-Provider": KEY})
    assert ok.json()["status"] == "connected", ok.text
    assert KEY not in ok.text
    xai = client.post("/api/plugins/ai-agent/connect", json={"provider": "xai", "base": base}, headers={"X-Plugin-Secret-Provider": KEY})
    assert xai.json()["status"] == "connected", xai.text
    anth = client.post("/api/plugins/ai-agent/chat", json={"provider": "anthropic", "base": base, "model": "mock-model", "messages": [{"role": "user", "content": "list"}], "tools": [{"name": "list_objects", "description": "list", "parameters": {"type": "object"}}]}, headers={"X-Plugin-Secret-Provider": KEY})
    assert anth.json()["tool_calls"][0]["name"] == "list_objects", anth.text
    assert KEY not in anth.text
    chat = client.post("/api/plugins/ai-agent/chat", json={"provider": "openai", "base": base, "model": "mock-model", "messages": [{"role": "user", "content": "list"}], "tools": [{"name": "list_objects", "description": "list", "parameters": {"type": "object"}}]}, headers={"X-Plugin-Secret-Provider": KEY})
    body = chat.json()
    assert body["tool_calls"][0]["name"] == "list_objects", body
    assert KEY not in chat.text
    image = client.post("/api/plugins/ai-agent/image", json={"provider": "openai", "base": base, "prompt": "boat"}, headers={"X-Plugin-Secret-Provider": KEY})
    assert image.json()["spends"] is True and image.json()["image"].startswith("data:image/png"), image.text
    views = client.post("/api/plugins/ai-agent/views", json={"prompt": "boat", "base": f"http://127.0.0.1:{port}"}, headers={"X-Plugin-Secret-Google": GOOGLE})
    assert len(views.json()["images"]) == 4, views.text
    assert GOOGLE not in views.text
    down = client.post("/api/plugins/ai-agent/connect", json={"provider": "openai", "base": "http://127.0.0.1:1/v1"}, headers={"X-Plugin-Secret-Provider": KEY})
    assert down.json()["status"] == "network"
    assert KEY not in down.text
    server.shutdown()
    hits = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.name.startswith("test_v8_"):
            continue
        if any(part in {".venv", "node_modules", "__pycache__"} for part in path.parts):
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        if KEY.encode() in data or GOOGLE.encode() in data:
            hits.append(str(path))
    assert not hits, hits


if __name__ == "__main__":
    test_input_cap()
    test_autosave_rotation_and_scrub()
    test_key_does_not_land_on_disk()
    test_agent_proxy_and_leak()
    print("server tests ok")
