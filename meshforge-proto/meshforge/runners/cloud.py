"""Cloud GPU adapters. Credentials come only from environment variables; nothing is stored.

  MESHFORGE_CLOUD=mock    (default) fake job, returns a demo multi-part mesh; for UI demos, costs nothing
  MESHFORGE_CLOUD=modal   Modal serverless GPU (see cloud/modal_app.py). UNTESTED - needs `pip install modal`,
                          `modal token new` (or MODAL_TOKEN_ID / MODAL_TOKEN_SECRET) and `modal deploy cloud/modal_app.py`.
  MESHFORGE_CLOUD=remote  Another MeshForge server on a GPU box you own/rent, usually through an SSH tunnel:
                          ssh -L 9000:127.0.0.1:8000 user@gpu-host ; MESHFORGE_REMOTE_URL=http://127.0.0.1:9000
"""
from __future__ import annotations
import os, time
from pathlib import Path
import numpy as np
import requests
import trimesh
from .base import Runner, png_bytes, glb_to_parts


class CloudAdapter:
    name = "base"
    def ready(self) -> tuple[bool, str]: return True, ""
    def generate(self, engine_id, png: bytes, params: dict, progress) -> bytes: raise NotImplementedError


class MockAdapter(CloudAdapter):
    name = "mock"

    def generate(self, engine_id, png, params, progress):
        for i, msg in enumerate(["Queued on cloud (mock)", "Cold start (mock)", "Generating (mock)", "Downloading result (mock)"]):
            progress(0.2 + 0.13 * i, msg); time.sleep(0.6)
        body = trimesh.creation.capsule(height=1.0, radius=0.35); body.visual.vertex_colors = [180, 140, 90, 255]
        head = trimesh.creation.icosphere(3, radius=0.3); head.apply_translation([0, 0, 1.05]); head.visual.vertex_colors = [230, 200, 170, 255]
        sword = trimesh.creation.box([0.06, 0.06, 1.2]); sword.apply_translation([0.55, 0, 0.3]); sword.visual.vertex_colors = [200, 200, 210, 255]
        s = trimesh.Scene()
        for n, g in [("body", body), ("head", head), ("sword_R", sword)]:
            s.add_geometry(g, node_name=n, geom_name=n)
        s.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))  # Z-up -> Y-up
        return s.export(file_type="glb")


class ModalAdapter(CloudAdapter):
    """UNTESTED. Calls the `generate` function of the deployed Modal app `meshforge` (cloud/modal_app.py)."""
    name = "modal"

    def ready(self):
        try:
            import modal  # noqa: F401
        except ImportError:
            return False, "pip install modal, then modal token new and modal deploy cloud/modal_app.py"
        has_env = os.environ.get("MODAL_TOKEN_ID") and os.environ.get("MODAL_TOKEN_SECRET")
        has_file = (Path.home() / ".modal.toml").exists()
        return (bool(has_env or has_file), "" if (has_env or has_file) else "Set MODAL_TOKEN_ID / MODAL_TOKEN_SECRET")

    def generate(self, engine_id, png, params, progress):
        import modal
        fn = modal.Function.from_name(os.environ.get("MESHFORGE_MODAL_APP", "meshforge"), "generate")
        progress(0.25, "Submitted to Modal (cold start can take 30-90 s)")
        call = fn.spawn(engine_id, png, params)
        t0 = time.time()
        while True:
            try:
                return call.get(timeout=5)
            except TimeoutError:
                progress(min(0.7, 0.25 + (time.time() - t0) / 300), f"Running on Modal GPU... {int(time.time() - t0)} s")


class RemoteServerAdapter(CloudAdapter):
    """Posts to another MeshForge server (e.g. on a rented GPU reached via SSH tunnel) using its local runner."""
    name = "remote"

    def __init__(self):
        self.url = os.environ.get("MESHFORGE_REMOTE_URL", "").rstrip("/")

    def ready(self):
        return (bool(self.url), "" if self.url else "Set MESHFORGE_REMOTE_URL")

    def generate(self, engine_id, png, params, progress):
        form = {"engine": engine_id, "runner": "local", "remove_bg": "false",
                "params": __import__("json").dumps({**params, "postprocess": False})}
        r = requests.post(f"{self.url}/api/jobs", files={"image": ("in.png", png, "image/png")}, data=form, timeout=30)
        r.raise_for_status(); jid = r.json()["id"]
        while True:
            j = requests.get(f"{self.url}/api/jobs/{jid}", timeout=30).json()
            if j["status"] == "done":
                return requests.get(f"{self.url}/api/jobs/{jid}/mesh.glb", timeout=120).content
            if j["status"] == "error":
                raise RuntimeError(f"Remote error: {j['error']}")
            progress(0.2 + 0.5 * j["progress"], f"Remote: {j['message']}"); time.sleep(1)


ADAPTERS = {"mock": MockAdapter, "modal": ModalAdapter, "remote": RemoteServerAdapter}


class CloudRunner(Runner):
    id, label = "cloud", "Cloud GPU"

    def __init__(self):
        name = os.environ.get("MESHFORGE_CLOUD", "mock")
        self.adapter = ADAPTERS[name]()

    def status(self):
        ok, why = self.adapter.ready()
        return {"id": self.id, "label": self.label, "ready": ok, "adapter": self.adapter.name, "hint": why,
                "untested": self.adapter.name in ("modal",)}

    def run(self, engine_id, image, params, progress):
        ok, why = self.adapter.ready()
        if not ok:
            raise RuntimeError(f"Cloud adapter '{self.adapter.name}' not configured: {why}")
        return glb_to_parts(self.adapter.generate(engine_id, png_bytes(image), params, progress))
