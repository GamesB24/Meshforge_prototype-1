import numpy as np
from PIL import Image

_session = None


def recenter_rgba(img: Image.Image, fg_ratio: float = 0.85) -> Image.Image:
    """Crop an RGBA cut-out to its alpha bounding box, pad to a square so the object fills fg_ratio of it."""
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.nonzero(a > 8)
    if len(xs) == 0:
        raise ValueError("Image alpha channel is fully transparent (no object)")
    crop = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    side = int(round(max(crop.size) / max(min(fg_ratio, 1.0), 0.05)))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
    return canvas


def has_alpha(img: Image.Image) -> bool:
    if img.mode not in ("RGBA", "LA", "PA") and not (img.mode == "P" and "transparency" in img.info):
        return False
    return bool((np.asarray(img.convert("RGBA"))[:, :, 3] < 250).any())


def preprocess(img: Image.Image, remove_bg: bool, fg_ratio: float = 0.85, recenter_alpha: bool = False) -> Image.Image:
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
    elif recenter_alpha and has_alpha(img):  # API path: cut-out already has alpha, just recentre it
        img = recenter_rgba(img.convert("RGBA"), fg_ratio)
    if img.mode != "RGBA" and has_alpha(img):
        img = img.convert("RGBA")
    if img.mode == "RGBA":
        a = np.asarray(img).astype(np.float32) / 255.0
        a = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
        img = Image.fromarray((a * 255).astype(np.uint8))
    return img.convert("RGB")
