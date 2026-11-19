"""Server-side project autosave. Original MIT code.

Secrets never belong in these files. The writer stores only the uploaded
project bytes plus a tiny manifest (time, reason, size). Request headers
are not copied. The fallback folder is data/autosave/, which is gitignored.
A saved project uses a folder next to that project, or the folder the user picked.
"""
from __future__ import annotations
import json
import os
import re
import time
from pathlib import Path

KEEP = 5
DEFAULT_INTERVAL = 120
_SECRET = re.compile(
    r"(?i)(x-plugin-secret-[a-z0-9_-]+\s*[:=]\s*)\S+|(bearer\s+)\S+|(api[_-]?key\s*[:=]\s*)\S+"
)


def scrub_text(text: str) -> str:
    def repl(m):
        return (m.group(1) or m.group(2) or m.group(3) or "") + "[REDACTED]"
    return _SECRET.sub(repl, text)


def app_root() -> Path:
    return Path(__file__).resolve().parent.parent


def fallback_dir() -> Path:
    d = Path(os.environ.get("MESHFORGE_DATA") or (app_root() / "data")) / "autosave"
    d.mkdir(parents=True, exist_ok=True)
    return d


def settings_path() -> Path:
    p = fallback_dir().parent / "autosave-settings.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_settings() -> dict:
    try:
        data = json.loads(settings_path().read_text("utf8"))
    except (OSError, ValueError):
        data = {}
    interval = int(data.get("intervalSec") or DEFAULT_INTERVAL)
    interval = min(3600, max(30, interval))
    return {
        "dir": str(data.get("dir") or ""),
        "intervalSec": interval,
        "projectPath": str(data.get("projectPath") or ""),
        "lastManualSave": float(data.get("lastManualSave") or 0),
    }


def save_settings(data: dict) -> dict:
    cur = load_settings()
    if "dir" in data:
        cur["dir"] = str(data.get("dir") or "")
    if "intervalSec" in data and data["intervalSec"] is not None:
        cur["intervalSec"] = min(3600, max(30, int(data["intervalSec"])))
    if "projectPath" in data:
        cur["projectPath"] = str(data.get("projectPath") or "")
    if "lastManualSave" in data:
        cur["lastManualSave"] = float(data["lastManualSave"] or 0)
    # Never persist anything except these four fields.
    clean = {k: cur[k] for k in ("dir", "intervalSec", "projectPath", "lastManualSave")}
    path = settings_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(clean, indent=2), "utf8")
    os.replace(tmp, path)
    return clean


def check_dir(path: str) -> dict:
    if not path or not str(path).strip():
        return {"ok": False, "writable": False, "path": "", "reason": "Enter a folder path."}
    p = Path(path).expanduser()
    try:
        p.mkdir(parents=True, exist_ok=True)
        probe = p / ".meshforge-write-test"
        probe.write_text("ok", "utf8")
        probe.unlink()
    except OSError as exc:
        return {"ok": False, "writable": False, "path": str(p), "reason": str(exc)}
    return {"ok": True, "writable": True, "path": str(p.resolve()), "reason": ""}


def active_dir(settings: dict | None = None) -> Path:
    s = settings or load_settings()
    project = s.get("projectPath") or ""
    if project:
        parent = Path(project).expanduser().parent
        d = parent / "meshforge-autosave"
        try:
            d.mkdir(parents=True, exist_ok=True)
            return d
        except OSError:
            pass
    chosen = s.get("dir") or ""
    if chosen:
        info = check_dir(chosen)
        if info["ok"]:
            return Path(info["path"])
    return fallback_dir()


def _slots(folder: Path):
    return [folder / f"autosave-{i}.mfproj" for i in range(1, KEEP + 1)]


def rotate_write(folder: Path, payload: bytes, reason: str) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    slots = _slots(folder)
    for older, newer in zip(reversed(slots), reversed(slots[:-1])):
        if newer.is_file():
            os.replace(newer, older)
    dest = slots[0]
    tmp = dest.with_suffix(".mfproj.tmp")
    tmp.write_bytes(payload)
    os.replace(tmp, dest)
    manifest = {
        "savedAt": time.time(),
        "reason": scrub_text(str(reason or "interval"))[:80],
        "bytes": len(payload),
        "file": dest.name,
    }
    man = dest.with_suffix(".json")
    man.write_text(json.dumps(manifest), "utf8")
    return manifest


def list_autosaves(folder: Path | None = None) -> list[dict]:
    folder = folder or active_dir()
    out = []
    for path in _slots(folder):
        if not path.is_file():
            continue
        man = path.with_suffix(".json")
        meta = {}
        try:
            meta = json.loads(man.read_text("utf8"))
        except (OSError, ValueError):
            meta = {"savedAt": path.stat().st_mtime, "reason": "", "bytes": path.stat().st_size}
        out.append({"file": path.name, "savedAt": float(meta.get("savedAt") or 0), "reason": meta.get("reason") or "", "bytes": int(meta.get("bytes") or path.stat().st_size), "dir": str(folder)})
    return out


def status() -> dict:
    s = load_settings()
    folder = active_dir(s)
    items = list_autosaves(folder)
    latest = items[0] if items else None
    newer = bool(latest and latest["savedAt"] > float(s.get("lastManualSave") or 0) + 1)
    return {
        "settings": s,
        "dir": str(folder),
        "fallback": str(fallback_dir()),
        "usingFallback": str(folder.resolve()) == str(fallback_dir().resolve()) and not s.get("projectPath"),
        "copies": items,
        "latest": latest,
        "newerThanSave": newer,
    }


def read_copy(name: str, folder: Path | None = None) -> Path:
    if name not in {f"autosave-{i}.mfproj" for i in range(1, KEEP + 1)}:
        raise FileNotFoundError(name)
    path = (folder or active_dir()) / name
    if not path.is_file():
        raise FileNotFoundError(name)
    return path


def try_native_folder() -> dict:
    """Optional OS folder dialog. Headless servers get needsEntry instead."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        try:
            root.attributes("-topmost", True)
        except Exception:
            pass
        chosen = filedialog.askdirectory(title="MeshForge autosave folder")
        root.destroy()
    except Exception as exc:
        return {"ok": False, "needsEntry": True, "path": "", "reason": str(exc)}
    if not chosen:
        return {"ok": False, "needsEntry": True, "path": "", "reason": "No folder selected"}
    info = check_dir(chosen)
    info["needsEntry"] = not info["ok"]
    return info
