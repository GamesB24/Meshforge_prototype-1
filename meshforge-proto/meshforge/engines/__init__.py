"""Engine registry. Add PartCrafter / OmniPart / TRELLIS.2 here as they are implemented."""
from .base import EngineInfo
import os, sys
from .triposr import TripoSREngine, TRIPOSR_DIR

if TRIPOSR_DIR not in sys.path:
    sys.path.insert(0, TRIPOSR_DIR)  # tsr.utils is used by preprocessing
TRIPOSR_DIR_ON_PATH = True

ENGINES = {"triposr": TripoSREngine()}

# Planned engines, shown greyed-out in the UI so the roadmap is visible.
PLANNED = [
    EngineInfo("partcrafter", "PartCrafter (parts, 8 GB+)", "MIT", 8.0, True, False, "planned: next engine for the RTX 4060"),
    EngineInfo("omnipart", "OmniPart (mask-guided parts)", "MIT", None, True, False, "planned: cloud GPU; VRAM unverified"),
    EngineInfo("trellis2", "TRELLIS.2 (high quality)", "MIT + NVIDIA deps", 24.0, False, False, "planned: cloud GPU only (24 GB+)"),
]


def list_engines():
    return [e.info for e in ENGINES.values()] + PLANNED
