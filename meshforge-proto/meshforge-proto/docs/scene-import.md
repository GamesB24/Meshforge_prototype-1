# Scene import / export (MeshForge 6.0)

MeshForge 6.0 can load a whole scene: many separate objects in one viewport. Each object is listed in the **Scene** panel (top right of the viewport). You can click it there or in 3D to select it. Edit Mode (Tab), Sculpt Mode, Move/Rotate/Scale (G/R/S or the gizmo), Delete and Shift+D (duplicate) all act on the selected object only.

## 1. scene.json (version 1)

```json
{
  "version": 1,
  "units": "m",
  "up": "Y",
  "photo": "photo.jpg",
  "room": { "width": 4.0, "height": 2.6 },
  "objects": [
    { "id": "obj_00", "label": "bedside table", "source": "library",
      "glb": "meshes/table.glb",
      "position": [-1.2, 0, -0.4], "rotation": [0, 0.3, 0], "scale": [1, 1, 1],
      "note": "anything; unknown keys are kept on export" },
    { "id": "obj_03", "label": "plant", "source": "generated", "glb": "meshes/plant.glb",
      "position": [1.5, 0, -0.8], "scale": 1.5 }
  ]
}
```

Axes: x right, y up, z toward the camera. Units are whatever you use (the default grid is 10 × 10 units, and a ~4-unit room fits well).

| key | required | meaning |
|---|---|---|
| `objects[].glb` | yes | Path or URL to a .glb (or .gltf). Relative paths are resolved against the URL of scene.json. `data:model/gltf-binary;base64,...` URLs work. Aliases: `mesh`, `url`, `file`. |
| `objects[].id` | no | Stable id (generated if missing; duplicates get `_2`, `_3`). |
| `objects[].label` | no | Name shown in the list and used as the node name in the exported GLB. Defaults to the id. |
| `objects[].source` | no | Free text shown as a badge (`generated`, `library`, `relief`, ...). |
| `position` | no | `[x, y, z]`, default `[0,0,0]`. |
| `rotation` | no | Euler XYZ in **radians**. A 4-number array is read as a quaternion. |
| `rotationDeg` | no | Euler XYZ in degrees (used instead of `rotation`). |
| `quaternion` | no | `[x, y, z, w]` (takes precedence over the other two). |
| `scale` | no | A number or `[sx, sy, sz]`. Default 1. |
| `color` | no | `"#rrggbb"`. Tints the object. |
| `visible` | no | `false` loads it hidden (eye icon in the list). |
| `photo` | no | The original photo, relative to scene.json. The 📷 button in the Scene panel shows it as an overlay. |
| anything else | no | Kept as-is in `exportScene()` output (e.g. `rel_depth`, `bbox_px`, `room`). |

Each object's GLB is loaded as **one** object. If the GLB has several parts, they are merged, and each part's material colour is baked into vertex colours. A GLB with a single mesh keeps its own material, UVs and texture. Objects whose mesh fails to load are skipped and reported in `errors`. The rest of the scene still loads.

**A single scene GLB also works:** every top-level node becomes its own object, keeping its name and transform. If there is a single wrapper node, its children are used. GLBs exported by MeshForge keep `id`, `label` and `source` in node extras, so they round-trip.

Not supported yet: OBJ meshes inside a scene (use GLB), textures on multi-part objects (merged into colours), and `"landscape"` refs inside the manifest.

## 2. Loading

* URL: `http://127.0.0.1:8000/?scene=/scenes/demo/scene.json` loads the scene automatically at startup (any same-origin or CORS-enabled URL works).
* Put scenes in `data/scenes/<name>/scene.json` (+ `meshes/`). The server serves them at `/scenes/<name>/...`, and `GET /api/scenes` lists them. Set the `MESHFORGE_SCENES_DIR` environment variable to serve another folder instead.
* UI: **File ▸ Import scene (GLB / manifest)…** You can pick one .glb, or scene.json **together with** its mesh files (multi-select). Meshes are matched by file name.
* A demo scene ships in `data/scenes/demo/` (four library objects + photo).

## 3. JavaScript API (in the page: `window.MeshForge`, version `"6.0"`)

```js
const r = await MeshForge.loadScene(src, { append: false, baseURL });
// src: URL string (scene.json or .glb), File, Blob, ArrayBuffer, FileList/array of Files, or a manifest object
// baseURL: for manifest objects/Blobs, resolve relative mesh paths against this URL
// r = { ok, objects: [{ id, label }], errors: [ "..." ] }   (never throws)
MeshForge.getObjects();          // [{ id, label, source, visible, selected, position, rotation(rad), scale }]
await MeshForge.selectObject(id);  // also accepts a label
MeshForge.getSelected();         // id or null
await MeshForge.setMode('object' | 'edit' | 'sculpt');  // acts on the selected object
MeshForge.setVisible(id, bool); await MeshForge.duplicateSelected(); await MeshForge.deleteSelected();
MeshForge.exportScene();         // updated scene.json object: current transforms (radians), original extra keys kept
await MeshForge.exportSceneBundle(); // { manifest, glb: Blob }, the GLB has one named node per object with its transform
await MeshForge.exportGLB();     // whole scene as one GLB (one named node per object, edits included)
await MeshForge.exportSelectedGLB(); // only the selected object
MeshForge.setExplode(0..2);      // spread objects along z (view only; exportScene reports the un-exploded positions)
await MeshForge.sendLandscapeToScene(); // copy the current Landscape terrain into the scene as an object "Landscape"
```

Note: `exportScene()` keeps each object's original `glb` path, which does **not** include Edit/Sculpt changes. The edited geometry is in the GLB from `exportGLB()` / `exportSceneBundle()` (node name = label, node extras = `{id,label,source}`). Hidden objects are left out of the GLB.

## 4. Python (Scene From Photo side)

```python
from meshforge.scene import write_manifest, validate_manifest
report = write_manifest([
    {"id": "obj_00", "label": "chair", "source": "library", "glb": "meshes/chair.glb",
     "position": [0.6, 0, 0.2], "rotation": [0, -0.6, 0], "scale": 1.0},
], "out/scene.json", photo="photo.jpg", room={"width": 4, "height": 2.6})
print(report)        # {"ok": True, "errors": [], "warnings": [], "objects": 1}
```

`python -m meshforge.scene validate out/scene.json` prints OK/INVALID with reasons (missing files, bad GLB header, wrong array sizes). It also warns when `rotation` looks like degrees. The exit code is 0 when valid. Standard library only.
