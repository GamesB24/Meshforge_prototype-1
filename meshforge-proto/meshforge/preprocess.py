import numpy as np
from PIL import Image

_session = None


def preprocess(img: Image.Image, remove_bg: bool, fg_ratio: float = 0.85) -> Image.Image:
    """Optional rembg background removal, recentring, then composite on grey (what TripoSR expects)."""
    global _session
    if remove_bg:
        import rembg
        from tsr.utils import remove_background, resize_foreground  # available once TripoSR is on sys.path
        if _session is None:
            try:
                import torch  # noqa: F401  on Windows this loads the CUDA DLLs that onnxruntime-gpu needs
            except Exception:
                pass
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.enable_cpu_mem_arena = False   # the default arena held ~9 GB of RAM on CPU after one image
            so.enable_mem_pattern = False
            _session = rembg.new_session("u2net", sess_opts=so)
        img = remove_background(img.convert("RGB"), _session)
        img = resize_foreground(img, fg_ratio)
    if img.mode == "RGBA":
        a = np.asarray(img).astype(np.float32) / 255.0
        a = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
        img = Image.fromarray((a * 255).astype(np.uint8))
    return img.convert("RGB")
