"""TripoSR engine (MIT, stabilityai/TripoSR). Uses the TripoSR repo checkout pointed to by TRIPOSR_DIR."""
from __future__ import annotations
import os, sys, threading
from pathlib import Path
from PIL import Image
from .base import Engine, EngineInfo, EngineResult, Progress

TRIPOSR_DIR = str(Path(os.environ.get("TRIPOSR_DIR") or Path(__file__).resolve().parents[2] / "third_party" / "TripoSR").resolve())


class TripoSREngine(Engine):
    info = EngineInfo("triposr", "TripoSR (fast, single mesh)", "MIT", 6.0,
                      note="~6 GB VRAM at defaults per official README; CPU fallback ~20-40 s")

    def __init__(self):
        self.model = None
        self.device = "cpu"
        self._lock = threading.Lock()

    def load(self, device: str) -> None:
        with self._lock:
            if self.model is not None:
                return
            if TRIPOSR_DIR not in sys.path:
                sys.path.insert(0, TRIPOSR_DIR)
            from tsr.system import TSR
            m = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt")
            m.renderer.set_chunk_size(8192 if device.startswith("cuda") else 2048)
            self.model, self.device = m.to(device), device

    def generate(self, image: Image.Image, params: dict, progress: Progress) -> EngineResult:
        import torch
        progress(0.35, "Encoding image (transformer)")
        with torch.no_grad():
            if self.device.startswith("cuda"):
                with torch.autocast("cuda", dtype=torch.float16):
                    codes = self.model([image], device=self.device)
            else:
                codes = self.model([image], device=self.device)
        # autocast leaves the triplane codes in half precision; the decoder weights are float32.
        codes = codes.float()
        progress(0.6, "Extracting surface (marching cubes)")
        res = int(params.get("resolution", 256))
        with torch.no_grad():
            mesh = self.model.extract_mesh(codes, True, resolution=res)[0]
        from tsr.utils import to_gradio_3d_orientation
        mesh = to_gradio_3d_orientation(mesh)  # TripoSR is Z-up; glTF/three.js expect Y-up
        return EngineResult({"mesh": mesh}, {"resolution": res, "device": self.device})
