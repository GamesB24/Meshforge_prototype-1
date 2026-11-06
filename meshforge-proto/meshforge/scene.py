"""MeshForge v6 scene manifests (scene.json): write and validate. Pure standard library.

    from meshforge.scene import write_manifest, validate_manifest
    write_manifest([{"id": "obj_00", "label": "chair", "glb": "meshes/chair.glb", "position": [0, 0, 0]}], "out/scene.json")
    report = validate_manifest("out/scene.json")   # {"ok": bool, "errors": [...], "warnings": [...], "objects": n}

CLI:  python -m meshforge.scene validate path/to/scene.json
Schema: docs/scene-import.md. Rotation is Euler XYZ in radians ("rotationDeg" for degrees, "quaternion" [x,y,z,w]).
"""
from __future__ import annotations
import json, math, struct, sys
from pathlib import Path

MESH_KEYS = ("glb", "mesh", "url", "file")


def _num_list(v, n):
    return isinstance(v, (list, tuple)) and len(v) == n and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)


def write_manifest(objects, out_path, *, photo=None, room=None, extra=None, check_files=True):
    """Write scene.json. `objects`: list of dicts with at least a mesh path ("glb" or "mesh").
    Fills defaults (id, label, position [0,0,0], rotation [0,0,0] radians, scale [1,1,1], visible True).
    Mesh paths are written as given; relative paths are resolved against the folder of scene.json.
    Returns the validation report of the written file."""
    out = Path(out_path); out.parent.mkdir(parents=True, exist_ok=True)
    objs = []
    for i, o in enumerate(objects):
        o = dict(o)
        if "glb" not in o:
            for k in MESH_KEYS[1:]:
                if k in o:
                    o["glb"] = o.pop(k); break
        if isinstance(o.get("glb"), Path):
            p = o["glb"]
            try: o["glb"] = p.resolve().relative_to(out.parent.resolve()).as_posix()
            except ValueError: o["glb"] = p.resolve().as_posix()
        o.setdefault("id", f"obj_{i:02d}"); o.setdefault("label", str(o["id"]))
        o.setdefault("position", [0.0, 0.0, 0.0])
        if "rotation" not in o and "rotationDeg" not in o and "quaternion" not in o: o["rotation"] = [0.0, 0.0, 0.0]
        s = o.get("scale", 1.0); o["scale"] = [float(s)] * 3 if isinstance(s, (int, float)) else s
        o.setdefault("visible", True)
        objs.append(o)
    m = {"version": 1, "units": "m", "up": "Y", "objects": objs}
    if photo is not None: m["photo"] = photo
    if room is not None: m["room"] = room
    if extra: m.update(extra)
    out.write_text(json.dumps(m, indent=2))
    return validate_manifest(out, check_files=check_files)


def _glb_ok(p: Path):
    try:
        with open(p, "rb") as f: head = f.read(20)
        if p.suffix.lower() == ".gltf": json.loads(p.read_text()); return None
        if head[:4] != b"glTF": return "not a GLB file (bad magic)"
        if struct.unpack("<I", head[4:8])[0] != 2: return "GLB is not glTF 2.0"
        return None
    except Exception as e:  # noqa: BLE001
        return str(e)


def validate_manifest(path_or_dict, *, check_files=True):
    """Never raises. Returns {"ok", "errors", "warnings", "objects"}."""
    errors, warnings = [], []
    base = None
    try:
        if isinstance(path_or_dict, dict): m = path_or_dict
        else:
            base = Path(path_or_dict).resolve().parent
            m = json.loads(Path(path_or_dict).read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "errors": [f"cannot read manifest: {e}"], "warnings": [], "objects": 0}
    if not isinstance(m, dict): return {"ok": False, "errors": ["manifest must be a JSON object"], "warnings": [], "objects": 0}
    if m.get("version", 1) != 1: warnings.append(f"version {m.get('version')!r}: MeshForge 6.0 reads version 1")
    objs = m.get("objects")
    if not isinstance(objs, list) or not objs:
        errors.append("'objects' must be a non-empty list"); objs = []
    ids = set()
    for i, o in enumerate(objs):
        tag = f"objects[{i}]"
        if not isinstance(o, dict): errors.append(f"{tag}: must be an object"); continue
        tag += f" ({o.get('id', o.get('label', '?'))})"
        if "id" in o:
            if str(o["id"]) in ids: warnings.append(f"{tag}: duplicate id (MeshForge renames it)")
            ids.add(str(o["id"]))
        else: warnings.append(f"{tag}: no 'id' (one is generated)")
        ref = next((o[k] for k in MESH_KEYS if k in o), None)
        if not ref or not isinstance(ref, str): errors.append(f"{tag}: needs a mesh path in 'glb' (or 'mesh')"); continue
        low = ref.lower().split("?")[0]
        if low.endswith(".obj"): errors.append(f"{tag}: OBJ meshes are not supported in scenes yet, use GLB")
        elif not (low.endswith((".glb", ".gltf")) or ref.startswith("data:")): warnings.append(f"{tag}: '{ref}' does not end in .glb")
        if check_files and base is not None and not ref.startswith(("data:", "http://", "https://", "/")):
            p = (base / ref)
            if not p.is_file(): errors.append(f"{tag}: mesh file not found: {p}")
            else:
                bad = _glb_ok(p)
                if bad: errors.append(f"{tag}: {bad}")
        if "position" in o and not _num_list(o["position"], 3): errors.append(f"{tag}: position must be [x, y, z] numbers")
        if "quaternion" in o and not _num_list(o["quaternion"], 4): errors.append(f"{tag}: quaternion must be [x, y, z, w]")
        if "rotationDeg" in o and not _num_list(o["rotationDeg"], 3): errors.append(f"{tag}: rotationDeg must be [x, y, z] degrees")
        if "rotation" in o:
            r = o["rotation"]
            if not (_num_list(r, 3) or _num_list(r, 4)): errors.append(f"{tag}: rotation must be [x, y, z] radians (or a quaternion [x, y, z, w])")
            elif _num_list(r, 3) and max(abs(x) for x in r) > 2 * math.pi + 1e-6 and o.get("rotationUnits") not in ("deg", "degrees"):
                warnings.append(f"{tag}: rotation {r} looks like degrees; 'rotation' is radians (use 'rotationDeg' for degrees)")
        if "scale" in o:
            s = o["scale"]
            if isinstance(s, (int, float)) and not isinstance(s, bool):
                if s == 0: warnings.append(f"{tag}: scale is 0")
            elif not _num_list(s, 3): errors.append(f"{tag}: scale must be a number or [sx, sy, sz]")
    return {"ok": not errors, "errors": errors, "warnings": warnings, "objects": len(objs)}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) < 2 or argv[0] != "validate":
        print("usage: python -m meshforge.scene validate scene.json [more.json ...]"); return 2
    rc = 0
    for p in argv[1:]:
        r = validate_manifest(p)
        print(f"{p}: {'OK' if r['ok'] else 'INVALID'} ({r['objects']} objects)")
        for e in r["errors"]: print("  error:", e)
        for w in r["warnings"]: print("  warning:", w)
        rc |= 0 if r["ok"] else 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
