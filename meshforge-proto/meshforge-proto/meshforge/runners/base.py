"""Runner interface: where an engine executes. Input is a preprocessed RGB image; output is {name: Trimesh}."""
from __future__ import annotations
import io
import trimesh
from PIL import Image


class Runner:
    id = "base"
    label = "base"

    def status(self) -> dict:  # shown in the UI: is it usable, on what device
        return {"id": self.id, "label": self.label, "ready": True}

    def run(self, engine_id: str, image: Image.Image, params: dict, progress) -> dict:
        raise NotImplementedError


def png_bytes(img: Image.Image) -> bytes:
    b = io.BytesIO(); img.save(b, format="PNG"); return b.getvalue()


def glb_to_parts(data: bytes) -> dict:
    loaded = trimesh.load(io.BytesIO(data), file_type="glb", force=None)
    if isinstance(loaded, trimesh.Scene):
        parts = {}
        for node in loaded.graph.nodes_geometry:
            T, gname = loaded.graph[node]
            parts[node] = loaded.geometry[gname].copy().apply_transform(T)
        return parts
    return {"mesh": loaded}
