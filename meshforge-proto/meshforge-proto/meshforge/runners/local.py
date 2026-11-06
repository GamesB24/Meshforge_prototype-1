"""Runs engines in-process on the local GPU (CUDA) if present, else CPU."""
from ..engines import ENGINES
from .base import Runner


def detect_device() -> str:
    import torch
    return "cuda:0" if torch.cuda.is_available() else "cpu"


class LocalRunner(Runner):
    id, label = "local", "Local GPU"

    def __init__(self):
        self.device = None

    def status(self):
        import torch
        self.device = self.device or detect_device()
        name = torch.cuda.get_device_name(0) if self.device.startswith("cuda") else "CPU (no CUDA GPU found)"
        return {"id": self.id, "label": self.label, "ready": True, "device": name}

    def run(self, engine_id, image, params, progress):
        eng = ENGINES.get(engine_id)
        if eng is None:
            raise ValueError(f"Engine '{engine_id}' is not available locally yet")
        self.device = self.device or detect_device()
        if eng.model is None:
            progress(0.15, f"Loading {engine_id} on {self.device} (first run only)")
        eng.load(self.device)
        return eng.generate(image, params, progress).parts
