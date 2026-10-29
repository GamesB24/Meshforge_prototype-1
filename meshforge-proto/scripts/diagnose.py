"""Writes diagnose.txt next to the project root. Run via diagnose_windows.bat (works on Linux too)."""
import importlib, platform, shutil, subprocess, sys, sysconfig
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
out = []
def say(*a): out.append(" ".join(str(x) for x in a))

say("MeshForge diagnose")
say("OS:", platform.platform())
say("Python:", sys.version.replace("\n", " "), "|", sys.executable)
say("Project folder:", ROOT)
try:
    du = shutil.disk_usage(ROOT); say(f"Free disk: {du.free / 1e9:.1f} GB")
except Exception as e:
    say("Free disk: ?", e)
try:
    import torch
    say("torch:", torch.__version__, "| built for CUDA:", torch.version.cuda)
    ok = torch.cuda.is_available(); say("torch.cuda.is_available():", ok)
    if ok:
        free, total = torch.cuda.mem_get_info(0)
        say("GPU:", torch.cuda.get_device_name(0), f"| VRAM free {free/2**30:.2f} / {total/2**30:.2f} GB")
except Exception as e:
    say("torch: IMPORT FAILED:", repr(e))
for mod in ["torchvision", "transformers", "onnxruntime", "rembg", "trimesh", "skimage", "numpy", "PIL",
            "fastapi", "uvicorn", "fast_simplification", "pynanoinstantmeshes", "xatlas", "moderngl", "omegaconf", "einops"]:
    try:
        m = importlib.import_module(mod); say(f"{mod}:", getattr(m, "__version__", "ok"))
    except Exception as e:
        say(f"{mod}: MISSING/FAILED:", repr(e))
try:
    import onnxruntime as ort; say("onnxruntime providers:", ort.get_available_providers())
except Exception:
    pass
try:
    import torchmcubes; say("torchmcubes:", torchmcubes.__file__)
except Exception as e:
    say("torchmcubes: MISSING:", repr(e))
tsr = ROOT / "third_party" / "TripoSR"
say("TripoSR folder present:", (tsr / "tsr" / "system.py").is_file())
say("site-packages:", sysconfig.get_paths()["purelib"])
smi = shutil.which("nvidia-smi")
if smi:
    try:
        r = subprocess.run([smi], capture_output=True, text=True, timeout=30, errors="replace")
        say("--- nvidia-smi ---"); say(r.stdout.strip() or r.stderr.strip())
    except Exception as e:
        say("nvidia-smi failed:", e)
else:
    say("nvidia-smi: not found")
text = "\n".join(out) + "\n"
(ROOT / "diagnose.txt").write_text(text, encoding="utf-8")
print(text)
print("Saved to", ROOT / "diagnose.txt")
