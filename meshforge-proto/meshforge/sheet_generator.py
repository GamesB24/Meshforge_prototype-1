"""4-Sided Model Sheet Preprocessor and Multi-View Alignment.
Splits 4-view orthographic sheets (Front, Right, Back, Left) for 3D generation.
"""
from __future__ import annotations
import io
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from PIL import Image

def slice_model_sheet(
    image_input: Image.Image,
    layout: str = "auto"  # "2x2", "1x4", or "auto"
) -> Dict[str, Image.Image]:
    """Slices a character/model sheet into 4 canonical orthographic views:
    'front', 'right', 'back', 'left'.
    """
    img = image_input.convert("RGBA")
    w, h = img.size

    # Auto-detect layout
    if layout == "auto":
        aspect = w / max(h, 1)
        if aspect > 2.5:
            layout = "1x4"  # Horizontal strip
        else:
            layout = "2x2"  # 2x2 grid

    views: Dict[str, Image.Image] = {}

    if layout == "1x4":
        cell_w = w // 4
        # Standard DCC sheet layout: Front, Right, Back, Left
        names = ["front", "right", "back", "left"]
        for i, name in enumerate(names):
            box = (i * cell_w, 0, (i + 1) * cell_w, h)
            views[name] = img.crop(box)
    else:  # 2x2 grid
        half_w = w // 2
        half_h = h // 2
        # Top-Left: Front, Top-Right: Right, Bottom-Left: Back, Bottom-Right: Left
        views["front"] = img.crop((0, 0, half_w, half_h))
        views["right"] = img.crop((half_w, 0, w, half_h))
        views["back"] = img.crop((0, half_h, half_w, h))
        views["left"] = img.crop((half_w, half_h, w, h))

    return views

def normalize_view(view: Image.Image, target_size: int = 512, padding_ratio: float = 0.1) -> Image.Image:
    """Recentres an orthographic view on a transparent background with uniform padding."""
    bbox = view.getbbox()
    if not bbox:
        return view.resize((target_size, target_size), Image.Resampling.LANCZOS)
    
    cropped = view.crop(bbox)
    cw, ch = cropped.size
    
    # Calculate scale factor to fit within target_size minus padding
    max_dim = int(target_size * (1.0 - padding_ratio * 2))
    scale = min(max_dim / max(cw, 1), max_dim / max(ch, 1))
    new_w = max(1, int(cw * scale))
    new_h = max(1, int(ch * scale))
    
    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Place on square transparent canvas
    out = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
    x_offset = (target_size - new_w) // 2
    # Bottom align slightly for character feet placement
    y_offset = (target_size - new_h) // 2
    out.paste(resized, (x_offset, y_offset), resized)
    return out

def process_4sided_sheet(
    image_input: Image.Image | bytes | Path | str,
    target_size: int = 512
) -> Dict[str, Image.Image]:
    """Complete pipeline: loads sheet, slices into 4 views, and normalizes each view."""
    if isinstance(image_input, Image.Image):
        img = image_input
    elif isinstance(image_input, (str, Path)):
        img = Image.open(image_input)
    else:
        img = Image.open(io.BytesIO(image_input))
        
    raw_views = slice_model_sheet(img)
    normalized = {name: normalize_view(v, target_size=target_size) for name, v in raw_views.items()}
    return normalized
