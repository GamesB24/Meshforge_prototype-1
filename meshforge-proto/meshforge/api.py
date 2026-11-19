"""Stable, browser-free entry point: one cut-out image in, one mesh out.  (MeshForge v5.1, MIT)

    from meshforge.api import generate_mesh
    r = generate_mesh("chair.png", "out/chair")
    if r["ok"]: print(r["glb"], r["stats"])
    else: print(r["error"])

CLI:  python -m meshforge.api --image chair.png --out out/chair [--quads --simplify-faces 8000 ...]

Uses meshforge.jobs.run_pipeline, the same code path as the server's /api/jobs worker, so results match
the UI for the same parameters. The engine model is lazy-loaded on the first call and stays cached for the
life of the process. generate_mesh never raises: failures come back as {"ok": False, "error": "..."}.
"""
from __future__ import annotations
import argparse, json, os, sys, threading, time, traceback
from pathlib import Path

__all__ = ["generate_mesh", "generate_many", "API_VERSION"]
API_VERSION = "1"
_lock = threading.Lock()  # one generation at a time per process (one GPU; the engine is not re-entrant)
_FORMATS = {"glb", "obj"}


def _result(ok=False, error="", out_dir=None, stats=None):
    return {"ok": ok, "glb": None, "obj": None, "raw_glb": None, "processed_png": None, "out_dir": out_dir,
            "stats": stats or {"vertices": 0, "triangles": 0, "seconds": 0.0, "device": None}, "error": error,
            "api_version": API_VERSION}


def _seed(seed):
    import random
    random.seed(seed)
    try:
        import numpy as np; np.random.seed(seed % (2 ** 32))
    except Exception:
        pass
    try:
        import torch; torch.manual_seed(seed)
    except Exception:
        pass


def generate_mesh(image_path, out_dir, *, engine="triposr", device="auto", remove_bg=False, mc_resolution=256,
                  simplify_faces=None, quads=False, formats=("glb", "obj"), foreground_ratio=0.85, seed=None,
                  runner="local", smooth_strength=0.3, sharp_angle=40.0, progress=None) -> dict:
    """Generate ONE mesh from ONE image (RGBA cut-out with transparent background, or RGB).

    engine          "triposr" (only local engine today)
    device          "auto" | "cuda" | "cuda:0" | "cpu" (applies on the first load in a process)
    remove_bg       run rembg; skipped automatically if the image already has a real alpha channel
    mc_resolution   marching-cubes grid (TripoSR); 128-320 sensible, 256 = UI default
    simplify_faces  target triangle budget (None = keep engine output after cleanup/smoothing)
    quads           quad-remesh to ~simplify_faces faces (OBJ gets real quads; GLB is always triangles)
    formats         subset of ("glb","obj"); both are always written, unrequested ones are just not reported
    foreground_ratio  object size within the frame after recentring (0.5-1.0)
    seed            int or None; TripoSR is deterministic in practice, seed only fixes RNGs
    runner          "local" (in-process) or "cloud" (MESHFORGE_CLOUD adapter; default "mock" = demo mesh, free)
    progress        optional callback(fraction 0..1, message)
    Returns {ok, glb, obj, raw_glb, processed_png, out_dir, stats:{vertices,triangles,seconds,device,...}, error}.
    """
    t0 = time.time()
    try:
        out = Path(out_dir).expanduser().resolve() if out_dir else None
    except Exception as e:
        return _result(error=f"Bad out_dir: {e}")
    od = str(out) if out else None
    # ---- validate input (never raise) ----
    if out is None:
        return _result(error="out_dir is required")
    if isinstance(formats, str):
        formats = (formats,)
    bad = [f for f in (formats or ()) if str(f).lower() not in _FORMATS]
    if bad or not formats:
        return _result(error=f"formats must be a non-empty subset of {sorted(_FORMATS)}, got {formats!r}", out_dir=od)
    try:
        mc_resolution = int(mc_resolution); foreground_ratio = float(foreground_ratio)
        simplify_faces = None if simplify_faces in (None, 0, "") else int(simplify_faces)
    except (TypeError, ValueError) as e:
        return _result(error=f"Bad numeric parameter: {e}", out_dir=od)
    if not 32 <= mc_resolution <= 512:
        return _result(error=f"mc_resolution must be 32..512, got {mc_resolution}", out_dir=od)
    if not 0.3 <= foreground_ratio <= 1.0:
        return _result(error=f"foreground_ratio must be 0.3..1.0, got {foreground_ratio}", out_dir=od)
    if simplify_faces is not None and simplify_faces < 50:
        return _result(error=f"simplify_faces must be >= 50 or None, got {simplify_faces}", out_dir=od)
    if quads and not simplify_faces:
        return _result(error="quads=True needs simplify_faces (the quad face budget)", out_dir=od)
    if device not in ("auto", "cpu", "cuda") and not str(device).startswith("cuda:"):
        return _result(error=f"device must be auto/cpu/cuda/cuda:N, got {device!r}", out_dir=od)
    p = Path(str(image_path)).expanduser()
    if not p.is_file():
        return _result(error=f"Image not found: {p}", out_dir=od)
    try:
        from PIL import Image
        with Image.open(p) as im:
            im.load(); img = im.copy()
    except Exception as e:
        return _result(error=f"Cannot read image {p}: {e}", out_dir=od)
    if min(img.size) < 16:
        return _result(error=f"Image too small: {img.size}", out_dir=od)

    try:
        from . import engines  # noqa: F401  puts TripoSR on sys.path
        from .jobs import run_pipeline
        from .preprocess import has_alpha
        from .runners import RUNNERS
        if runner not in RUNNERS:
            return _result(error=f"Unknown runner {runner!r}; use one of {sorted(RUNNERS)}", out_dir=od)
        if runner == "local":
            if engine not in engines.ENGINES:
                return _result(error=f"Engine {engine!r} is not available locally; available: {sorted(engines.ENGINES)}", out_dir=od)
            try:
                import torch
            except ImportError:
                return _result(error="PyTorch is not installed in this Python (run setup_windows.bat / run.sh first, "
                                     "or use runner='cloud')", out_dir=od)
            lr = RUNNERS["local"]
            if device == "cuda":
                device = "cuda:0"
            if device.startswith("cuda") and not torch.cuda.is_available():
                return _result(error="device='cuda' requested but CUDA is not available in this PyTorch", out_dir=od)
            if device != "auto" and engines.ENGINES[engine].model is None:
                lr.device = device  # honoured on first load; a cached model keeps its device
        alpha = has_alpha(img)
        params = {"resolution": mc_resolution, "fg_ratio": foreground_ratio, "smooth_strength": float(smooth_strength),
                  "sharp_angle": float(sharp_angle), "target_faces": simplify_faces or 0,
                  "remesh": "quad" if quads else ("decimate" if simplify_faces else "none")}
        prog = progress or (lambda f, m: None)
        with _lock:
            if seed is not None:
                _seed(int(seed))
            stats = run_pipeline(img, out, engine, runner, bool(remove_bg) and not alpha, params, prog, recenter_alpha=True)
        fmts = {str(f).lower() for f in formats}
        r = _result(ok=True, out_dir=od)
        r["glb"] = str(out / "mesh.glb") if "glb" in fmts else None
        r["obj"] = str(out / "mesh.obj") if "obj" in fmts else None
        r["raw_glb"] = str(out / "raw.glb") if stats.get("raw") and (out / "raw.glb").is_file() else None
        r["processed_png"] = str(out / "processed.png")
        dev = RUNNERS["local"].device if runner == "local" else f"cloud:{RUNNERS['cloud'].adapter.name}"
        r["stats"] = {"vertices": stats.get("vertices", 0), "triangles": _triangles(out / "mesh.glb", stats),
                      "quads": stats.get("quads"), "parts": stats.get("parts"), "seconds": round(time.time() - t0, 2),
                      "device": dev, "engine": engine, "runner": runner, "had_alpha": alpha,
                      "remove_bg_ran": bool(remove_bg) and not alpha, "params": params}
        (out / "result.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
        return r
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        r = _result(error=f"{type(e).__name__}: {e}", out_dir=od)
        r["stats"]["seconds"] = round(time.time() - t0, 2)
        return r


def _triangles(glb, stats):
    try:
        import trimesh
        s = trimesh.load(str(glb), force="scene")
        return int(sum(len(g.faces) for g in s.geometry.values()))
    except Exception:
        return int(stats.get("faces", 0))


def generate_many(jobs, *, stop_on_error=False, **defaults) -> list:
    """Run several generate_mesh calls in sequence, reusing the cached engine.
    jobs: list of dicts with generate_mesh kwargs (must include image_path and out_dir). Returns a list of results
    in the same order; each result also has "index" and the "id" key from the job dict if one was given."""
    results = []
    for i, job in enumerate(jobs or []):
        if not isinstance(job, dict):
            r = _result(error=f"job {i} is not a dict")
        else:
            kw = {**defaults, **{k: v for k, v in job.items() if k != "id"}}
            try:
                r = generate_mesh(kw.pop("image_path", None) or "", kw.pop("out_dir", None), **kw)
            except TypeError as e:  # unknown keyword
                r = _result(error=f"Bad arguments: {e}")
        r["index"] = i
        if isinstance(job, dict) and "id" in job:
            r["id"] = job["id"]
        results.append(r)
        if stop_on_error and not r["ok"]:
            break
    return results


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m meshforge.api", description="Generate one mesh from one cut-out image; prints result JSON.")
    ap.add_argument("--image", help="input PNG/JPG (RGBA cut-out or RGB)")
    ap.add_argument("--out", help="output directory (mesh.glb, mesh.obj, raw.glb, processed.png, result.json)")
    ap.add_argument("--batch", help="JSON file: list of {image_path, out_dir, ...} dicts (instead of --image/--out)")
    ap.add_argument("--engine", default="triposr")
    ap.add_argument("--runner", default="local", choices=["local", "cloud"])
    ap.add_argument("--device", default="auto")
    ap.add_argument("--remove-bg", action="store_true", help="run rembg (skipped if the image has alpha)")
    ap.add_argument("--mc-resolution", type=int, default=256)
    ap.add_argument("--simplify-faces", type=int, default=None)
    ap.add_argument("--quads", action="store_true")
    ap.add_argument("--formats", default="glb,obj")
    ap.add_argument("--foreground-ratio", type=float, default=0.85)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--quiet", action="store_true", help="no progress lines on stderr")
    a = ap.parse_args(argv)
    prog = None if a.quiet else (lambda f, m: print(f"[{f:4.0%}] {m}", file=sys.stderr, flush=True))
    kw = dict(engine=a.engine, runner=a.runner, device=a.device, remove_bg=a.remove_bg, mc_resolution=a.mc_resolution,
              simplify_faces=a.simplify_faces, quads=a.quads, formats=tuple(f for f in a.formats.split(",") if f),
              foreground_ratio=a.foreground_ratio, seed=a.seed, progress=prog)
    # Native helpers (Instant Meshes) print to fd 1; keep stdout clean JSON by pointing fd 1 at stderr meanwhile.
    sys.stdout.flush(); saved = os.dup(1); os.dup2(2, 1)
    try:
        code, payload = _run_cli(a, ap, kw)
    finally:
        sys.stdout.flush(); os.dup2(saved, 1); os.close(saved)
    print(json.dumps(payload, indent=2))
    return code


def _run_cli(a, ap, kw):
    if a.batch:
        try:
            jobs = json.loads(Path(a.batch).read_text(encoding="utf-8"))
        except Exception as e:
            return 2, [_result(error=f"Cannot read batch file: {e}")]
        res = generate_many(jobs, **kw)
        return (0 if all(r["ok"] for r in res) else 1), res
    if not a.image or not a.out:
        return 2, _result(error="--image and --out are required (or use --batch)")
    r = generate_mesh(a.image, a.out, **kw)
    return (0 if r["ok"] else 1), r


if __name__ == "__main__":
    sys.exit(main())
