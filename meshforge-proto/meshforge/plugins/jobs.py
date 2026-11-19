"""Small thread-backed job queue shared by plugin backends."""
from __future__ import annotations
import sys
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

_exec = ThreadPoolExecutor(max_workers=4, thread_name_prefix="meshforge-plugin")
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def submit(plugin_id: str, fn, *args, **kwargs) -> str:
    job_id = uuid.uuid4().hex
    state = {"status": "queued", "progress": 0.0, "message": "Queued", "result": None, "error": None}
    with _lock:
        _jobs[(plugin_id, job_id)] = state

    def progress(pct, msg=""):
        # Accept percentages in either Blender-style 0..100 or API-style 0..1.
        value = float(pct)
        if value > 1:
            value /= 100.0
        with _lock:
            state["progress"] = max(0.0, min(1.0, value))
            state["message"] = str(msg)

    def run():
        with _lock:
            state.update(status="running", message="Running")
        try:
            result = fn(progress, *args, **kwargs)
            with _lock:
                state.update(status="done", progress=1.0, message="Done", result=result)
        except Exception as exc:  # a plugin failure must never kill the host process
            traceback.print_exc()
            with _lock:
                state.update(status="error", message="Plugin job failed", error=str(exc))

    _exec.submit(run)
    return job_id


def start(fn, *args, **kwargs) -> str:
    """Start ``fn(progress, *args)`` in a worker and return its job id."""
    # Exact PID is stamped on the loaded backend: module-name normalization is lossy.
    module = sys.modules.get(getattr(fn, "__module__", ""))
    plugin_id = getattr(module, "_meshforge_plugin_id", "global")
    return submit(plugin_id, fn, *args, **kwargs)


def get(plugin_id: str, job_id: str) -> dict | None:
    with _lock:
        state = _jobs.get((plugin_id, job_id))
        return dict(state) if state else None
