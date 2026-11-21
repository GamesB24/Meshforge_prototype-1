"""Runs engines in-process on the local GPU (CUDA) if present, else CPU."""
from ..engines import ENGINES
from .base import Runner


def detect_device() -> str:
    try:
        import torch
        return "cuda:0" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu (torch not installed)"


class LocalRunner(Runner):
    id, label = "local", "Local GPU"

    def __init__(self):
        self.device = None

    def status(self):
        try:
            import torch
            self.device = self.device or detect_device()
            name = torch.cuda.get_device_name(0) if self.device.startswith("cuda") else "CPU (no CUDA GPU found)"
            ready = True
        except ImportError:
            name = "CPU / Setup needed (torch not installed)"
            ready = False
        return {"id": self.id, "label": self.label, "ready": ready, "device": name}

    def run(self, engine_id, image, params, progress):
        eng = ENGINES.get(engine_id)
        if eng is None:
            raise ValueError(f"Engine '{engine_id}' is not available locally yet. Installed engines: {', '.join(ENGINES) or 'none'}.")
        if not self.status()["ready"]:
            raise ValueError("Local generation needs PyTorch. Install it with the MeshForge setup script, or switch Run on to Cloud GPU.")
        self.device = self.device or detect_device()
        if "torch not installed" in self.device:
            raise ValueError("Local generation needs PyTorch. Install it with the MeshForge setup script, or switch Run on to Cloud GPU.")
        try:
            if eng.model is None:
                progress(0.15, f"Loading {engine_id} on {self.device} (first run only)")
            eng.load(self.device)
            return eng.generate(image, params, progress).parts
        except ImportError as e:
            missing = getattr(e, "name", None) or "a required module"
            raise ValueError(f"Local generation could not start because '{missing}' is not installed. Use the setup script, or switch Run on to Cloud GPU.") from e
