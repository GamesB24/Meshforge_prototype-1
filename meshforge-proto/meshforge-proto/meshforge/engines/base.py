"""Engine interface. An engine turns a preprocessed image into one or more named meshes (parts)."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional
import trimesh
from PIL import Image

Progress = Callable[[float, str], None]  # (0..1, message)


@dataclass
class EngineInfo:
    id: str
    name: str
    licence: str
    min_vram_gb: Optional[float]
    supports_parts: bool = False
    available: bool = True
    note: str = ""


@dataclass
class EngineResult:
    parts: Dict[str, trimesh.Trimesh]          # name -> mesh; single-mesh engines return {"mesh": m}
    meta: dict = field(default_factory=dict)


class Engine:
    info: EngineInfo

    def load(self, device: str) -> None:  # heavy model load, called once per process
        raise NotImplementedError

    def generate(self, image: Image.Image, params: dict, progress: Progress) -> EngineResult:
        raise NotImplementedError
