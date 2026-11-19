"""Discovery, zip installation, state and trusted Python plugin loading."""
from __future__ import annotations
import importlib.util
import json
import logging
import traceback
import os
import re
import shutil
import sys
sys.dont_write_bytecode = True
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from fastapi import APIRouter, HTTPException
from . import jobs

_ID = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$")
HOST_VERSION = "8.0"


def _version_tuple(text: str):
    parts = []
    for bit in str(text).split("."):
        n = ""
        for ch in bit:
            if ch.isdigit():
                n += ch
            else:
                break
        parts.append(int(n) if n else 0)
    return tuple(parts or (0,))


def _version_newer(need: str, host: str = HOST_VERSION) -> bool:
    return _version_tuple(need) > _version_tuple(host)


class SecretHeaderFilter(logging.Filter):
    """Defence in depth: even a custom access logger cannot emit secret headers."""
    def filter(self, record):
        try:
            text = record.getMessage()
            clean = scrub_text(text)
            if clean != text:
                record.msg, record.args = clean, ()
        except Exception:
            pass
        return True


_SECRET_TEXT = re.compile(
    r"(?i)(x-plugin-secret-[a-z0-9_-]+\s*[:=]\s*)\S+|(bearer\s+)\S+|(api[_-]?key\s*[:=]\s*)\S+"
)


def scrub_text(text: str) -> str:
    def repl(m):
        return (m.group(1) or m.group(2) or m.group(3) or "") + "[REDACTED]"
    return _SECRET_TEXT.sub(repl, str(text))


def install_log_filter():
    for name in ("uvicorn.access", "uvicorn.error", "gunicorn.access"):
        log = logging.getLogger(name)
        if not any(isinstance(f, SecretHeaderFilter) for f in log.filters):
            log.addFilter(SecretHeaderFilter())


class PluginManager:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.state_path = root / "plugins-state.json"
        self.mounted: set[str] = set()

    def _read_state(self):
        try:
            data = json.loads(self.state_path.read_text("utf8"))
            return {"enabled": data.get("enabled", {}), "errors": data.get("errors", {})}
        except (OSError, ValueError, TypeError):
            return {"enabled": {}, "errors": {}}

    def _write_state(self, state):
        # Only enabled flags and error strings. Tokens, keys and logins are dropped.
        enabled = {}
        for k, v in (state.get("enabled") or {}).items():
            if isinstance(k, str) and _ID.fullmatch(k):
                enabled[k] = bool(v)
        errors = {}
        for k, v in (state.get("errors") or {}).items():
            if isinstance(k, str):
                errors[k] = scrub_text(v)[:500]
        clean = {"enabled": enabled, "errors": errors}
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(clean, indent=2), "utf8")
        os.replace(tmp, self.state_path)

    def manifests(self):
        found = {}
        if not self.root.exists():
            return found
        for path in sorted(self.root.glob("*/plugin.json")):
            pid = path.parent.name
            if not _ID.fullmatch(pid):
                continue
            try:
                m = json.loads(path.read_text("utf8"))
                required = ("id", "name", "version", "licence", "entry")
                if any(k not in m for k in required) or m["id"] != pid or not _ID.fullmatch(str(m["id"])):
                    raise ValueError("manifest id is missing, invalid, or differs from its folder")
                m = dict(m)
                m["_dir"] = path.parent
                found[pid] = m
            except Exception as exc:
                state = self._read_state()
                state["errors"][pid] = f"Manifest: {exc}"
                self._write_state(state)
        return found

    def install_zips(self):
        for archive in sorted(self.root.glob("*.zip")):
            target = None
            try:
                with tempfile.TemporaryDirectory(prefix="mf-plugin-") as td:
                    dest = Path(td)
                    with zipfile.ZipFile(archive) as zf:
                        total = 0
                        for info in zf.infolist():
                            name = info.filename.replace("\\", "/")
                            p = PurePosixPath(name)
                            if p.is_absolute() or ".." in p.parts or (info.external_attr >> 16) & 0o170000 == 0o120000:
                                raise ValueError("unsafe path or symbolic link in plugin zip")
                            total += info.file_size
                            if total > 100 * 1024 * 1024:
                                raise ValueError("plugin zip expands beyond 100 MB")
                        zf.extractall(dest)
                    candidates = list(dest.glob("*/plugin.json")) + list(dest.glob("plugin.json"))
                    if len(candidates) != 1:
                        raise ValueError("zip must contain exactly one plugin.json")
                    source = candidates[0].parent
                    manifest = json.loads(candidates[0].read_text("utf8"))
                    pid = manifest.get("id")
                    if not isinstance(pid, str) or not _ID.fullmatch(pid):
                        raise ValueError("invalid plugin id")
                    target = self.root / pid
                    if target.exists():
                        raise ValueError(f"plugin {pid} already exists; remove it before upgrading")
                    shutil.copytree(source, target)
                archive.unlink()  # consumed only after a complete, safe install
            except Exception as exc:
                state = self._read_state()
                state["errors"][archive.stem] = f"Install: {exc}"
                self._write_state(state)
                try:
                    archive.rename(archive.with_suffix(".zip.error"))
                except OSError:
                    pass

    def scan(self, app=None):
        self.install_zips()
        state = self._read_state()
        manifests = self.manifests()
        out = []
        for pid, manifest in manifests.items():
            # Plugins are opt-in, except the bundled deliberately disabled example.
            enabled = bool(state["enabled"].get(pid, False))
            if bool(state["errors"].get(pid)) and str(state["errors"].get(pid)).startswith("Backend:"):
                enabled = False
            source_manifest = dict(manifest)
            manifest = {k: v for k, v in manifest.items() if not k.startswith("_")}
            entry = {"id": pid, "manifest": manifest, "enabled": enabled, "error": state["errors"].get(pid)}
            if enabled and manifest.get("minMeshForge") and _version_newer(str(manifest["minMeshForge"]), "8.0"):
                entry.update(enabled=False, error="Requires a newer MeshForge")
            if enabled and app is not None and manifest.get("backend") and pid not in self.mounted:
                self.mount_backend(app, pid, source_manifest, entry)
            out.append(entry)
        for pid, err in state["errors"].items():
            if pid not in manifests:
                out.append({"id": pid, "manifest": None, "enabled": False, "error": err})
        return out

    def mount_backend(self, app, pid, manifest, entry):
        backend = self.root / pid / manifest["backend"]
        modname = f"_meshforge_plugin_{pid.replace('-', '_')}_backend"
        try:
            if backend.suffix != ".py" or backend.parent != self.root / pid:
                raise ValueError("backend must be a .py file in the plugin folder")
            spec = importlib.util.spec_from_file_location(modname, backend)
            module = importlib.util.module_from_spec(spec)
            module._meshforge_plugin_id = pid
            sys.modules[modname] = module
            spec.loader.exec_module(module)
            router = getattr(module, "router")
            if not isinstance(router, APIRouter):
                raise TypeError("backend must export a FastAPI APIRouter named router")
            app.include_router(router, prefix=f"/api/plugins/{pid}")
            self.mounted.add(pid)
            state = self._read_state(); state["errors"].pop(pid, None); self._write_state(state)
            entry["error"] = None
        except Exception as exc:
            logging.getLogger("meshforge.plugins").error("Plugin %s backend disabled: %s", pid, exc)
            state = self._read_state()
            state["enabled"][pid] = False
            state["errors"][pid] = f"Backend: {type(exc).__name__}: {exc}"
            self._write_state(state)
            entry.update(enabled=False, error=state["errors"][pid])

    def set_enabled(self, pid, enabled):
        manifests = self.manifests()
        if pid not in manifests:
            raise HTTPException(404, "No such plugin")
        state = self._read_state()
        state["enabled"][pid] = bool(enabled)
        state["errors"].pop(pid, None)
        self._write_state(state)
