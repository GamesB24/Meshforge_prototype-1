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


# Working-image cap. 1024 is the default. Larger than that is refused so an 8 GB
# GPU is not handed a multi-thousand-pixel upload on top of TripoSR. The old
# Generate slider only set the marching-cubes grid (default 256) and the mesh
# looked like a 256 texture. This size is the image, not that grid.
INPUT_SIZE_DEFAULT = 1024
INPUT_SIZE_MAX = 1024


def clamp_input_size(size) -> int:
    try:
        size = int(size)
    except (TypeError, ValueError):
        size = INPUT_SIZE_DEFAULT
    if size < 128:
        size = 128
    if size > INPUT_SIZE_MAX:
        size = INPUT_SIZE_MAX
    return size


def fit_input(img: Image.Image, size: int = INPUT_SIZE_DEFAULT) -> Image.Image:
    """Downscale so the longest side is at most `size`. Never upscale. Never uses 256 unless asked."""
    size = clamp_input_size(size)
    w, h = img.size
    longest = max(w, h)
    if longest <= size:
        return img
    scale = size / float(longest)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    return img.resize((nw, nh), Image.Resampling.LANCZOS)


def preprocess(img: Image.Image, remove_bg: bool, fg_ratio: float = 0.85, recenter_alpha: bool = False, input_size: int = INPUT_SIZE_DEFAULT) -> Image.Image:
    """Optional rembg background removal, recentring, then composite on grey (what TripoSR expects)."""
    img = fit_input(img, input_size)
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
