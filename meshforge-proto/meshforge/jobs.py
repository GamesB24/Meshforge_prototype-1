"""In-process job queue: one worker thread (GPU jobs run one at a time), progress, persisted history."""
from __future__ import annotations
import json, os, queue, sys, threading, time, traceback, uuid
from pathlib import Path
from dataclasses import dataclass, field, asdict
from PIL import Image
from .preprocess import preprocess
from .postprocess import process_parts, export
from .runners import RUNNERS

DATA = Path(os.environ.get("MESHFORGE_DATA") or Path(__file__).resolve().parent.parent / "data")


@dataclass
class Job:
    id: str
    engine: str
    runner: str
    remove_bg: bool
    params: dict
    status: str = "queued"       # queued | running | done | error
    progress: float = 0.0
    message: str = "Queued"
    error: str = ""
    created: float = field(default_factory=time.time)
    seconds: float = 0.0
    stats: dict = field(default_factory=dict)

    @property
    def dir(self) -> str: return str(DATA / "jobs" / self.id)


def _release_memory():
    """Return freed CPU tensors to the OS (glibc keeps them otherwise; matters on 16 GB machines)."""
    import gc, ctypes
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    if sys.platform.startswith("linux"):  # glibc-only; Windows/macOS allocators release memory themselves
        try:
            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except Exception:
            pass


def _save_raw(parts: dict, path: Path) -> bool:
    try:
        import trimesh
        scene = trimesh.Scene()
        for name, m in parts.items():
            scene.add_geometry(m, node_name=name, geom_name=name)
        scene.export(str(path))
        return True
    except Exception:
        traceback.print_exc()
        return False


class JobQueue:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.q: queue.Queue[str] = queue.Queue()
        (DATA / "jobs").mkdir(parents=True, exist_ok=True)
        self._load_history()
        threading.Thread(target=self._worker, daemon=True).start()

    def _load_history(self):
        for f in (DATA / "jobs").glob("*/job.json"):
            try:
                j = Job(**json.loads(f.read_text(encoding="utf-8")))
            except Exception:
                continue  # skip a corrupt/partial history entry instead of refusing to start
            if j.status in ("queued", "running"):
                j.status, j.error = "error", "Server restarted"
            self.jobs[j.id] = j

    def _save(self, j: Job):
        tmp = Path(j.dir) / "job.json.tmp"
        tmp.write_text(json.dumps(asdict(j)), encoding="utf-8")
        os.replace(tmp, Path(j.dir) / "job.json")  # atomic on Windows and POSIX

    def submit(self, image_bytes: bytes, engine: str, runner: str, remove_bg: bool, params: dict) -> Job:
        if runner not in RUNNERS:
            raise ValueError(f"Unknown runner {runner}")
        j = Job(uuid.uuid4().hex[:12], engine, runner, remove_bg, params)
        Path(j.dir).mkdir(parents=True)
        (Path(j.dir) / "input").write_bytes(image_bytes)
        self.jobs[j.id] = j; self._save(j); self.q.put(j.id)
        return j

    def _worker(self):
        while True:
            j = self.jobs[self.q.get()]
            t0 = time.time()

            def progress(p, msg):
                j.progress, j.message = round(float(p), 3), msg

            try:
                j.status = "running"; progress(0.05, "Preprocessing image")
                with Image.open(Path(j.dir) / "input") as im:  # close handle: Windows can't delete open files
                    im.load(); img = im.copy()
                proc = preprocess(img, j.remove_bg, float(j.params.get("fg_ratio", 0.85)))
                proc.save(Path(j.dir) / "processed.png")
                parts = RUNNERS[j.runner].run(j.engine, proc, j.params, progress)
                raw_ok = _save_raw(parts, Path(j.dir) / "raw.glb")  # unprocessed engine output, for comparison
                quads, info = {}, {}
                if j.params.get("postprocess", True):
                    parts, quads, info = process_parts(parts, j.params, progress)
                progress(0.92, "Exporting GLB / OBJ")
                j.stats = export(parts, str(Path(j.dir) / "mesh.glb"), str(Path(j.dir) / "mesh.obj"), quads, info)
                j.stats["raw"] = raw_ok
                j.status, j.message = "done", "Done"; progress(1.0, "Done")
            except Exception as e:
                traceback.print_exc()
                j.status, j.error, j.message = "error", str(e), "Failed"
            j.seconds = round(time.time() - t0, 1)
            self._save(j)
            _release_memory()
