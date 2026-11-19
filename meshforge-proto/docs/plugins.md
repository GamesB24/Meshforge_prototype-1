# MeshForge local plugins (v7.2)

**Plugins are trusted local code. There is no sandbox.** A plugin's JavaScript runs in the MeshForge page and its Python runs in the server process, with the same access as MeshForge itself. Only install code you trust.

## Install and enable

Copy `plugins/<id>/` into the MeshForge project, or put a single-plugin `.zip` in `plugins/` and restart MeshForge. Zip extraction rejects absolute paths, `..` traversal, symbolic links, oversized expansion and duplicate installs. Invalid archives are renamed `.zip.error`. If installing over an existing plugin, close MeshForge, remove or back up its old folder first, then install the new zip.

`plugins/plugins-state.json` records enabled state and backend/install errors. Use **File ▸ Plugins…** to enable or disable a plugin and show errors, then reload/restart. Backend routes are mounted at server startup; after enabling a backend plugin, restart rather than only refreshing. The job route is registered before routes such as `/work`, and job keys preserve exact manifest IDs, including hyphens and underscores. Lowest-level `jobs.submit(id, fn, *args)` remains available when a synthetic ID is needed.

The bundled `_example` plugin is enabled on first launch. Disable it in File ▸ Plugins… if it is not needed.

## Manifest

```json
{
  "id": "scene-from-photo",
  "name": "Scene From Photo",
  "version": "1.0",
  "licence": "MIT",
  "entry": "entry.js",
  "backend": "backend.py",
  "minMeshForge": "7.2"
}
```

`backend` is optional. `id`, `name`, `version`, `licence`, and `entry` are required. IDs use letters, digits, `_` and `-` and must match the folder. `minMeshForge` supports minimal ascending `7.x` numeric-string comparison. The entry is an ES module served from `/plugins/<id>/`.

## Frontend

Export `activate(mf)`, and optionally `deactivate()`:

```js
export async function activate(mf) {
  const {panel} = mf.registerTab({id:'photo', label:'Scene Photo', order:50,
    onEnter() {}, onLeave() {}});
  const {el} = mf.registerPanel({id:'status', title:'Photo status', location:'right'});
  const objects = mf.api.getObjects();
  const result = await mf.backend('prepare', {method:'POST'});
  const url = mf.assetURL('icon.svg');
}
export function deactivate() {}
```

- `registerTab` returns `{panel}`, fills the left sidebar, and adds a tab next to Generate and Landscape.
- `registerPanel({id,title,location})` accepts `right` or `bottom`, and returns `{el}`.
- `api` is the existing `window.MeshForge` integration API (`loadScene`, `getObjects`, `selectObject`, `setCamera`, `exportGLB`, and the rest).
- `backend(path, opts)` fetches `/api/plugins/<id>/<path>`. Pass normal Fetch options.
- `jobs.poll(jobId, onProgress)` polls until done/error, calls `onProgress(job)` each time, and resolves to the final job.
- `assetURL(rel)` makes an absolute URL to a plugin file.

One plugin's import/activation error is caught and does not stop the app or other plugins. In offline mode, the viewer starts without importing plugins; their backends and tabs need the server.

### Session-only secrets

```js
mf.secrets.set('Gemini', valueFromAnInMemoryScript); // no host UI samples/logging
mf.secrets.has('Gemini');
mf.secrets.get('Gemini');
const headers = {...mf.secrets.header('Gemini'), 'Content-Type':'application/json'};
// sends X-Plugin-Secret-Gemini
mf.secrets.clear();
```

Names may contain letters, digits, `_` and `-`. Secrets live in a per-plugin JavaScript closure, not localStorage/sessionStorage, host-created DOM, host logs, or disk. The example uses a transient password input and clears it immediately. `pagehide`, `unload` and `deactivate` clear the closure. The host never automatically sends a secret; the plugin must deliberately attach `secrets.header()` to its own requests.

MeshForge configures uvicorn access-log filters to redact `X-Plugin-Secret-*` values if headers are included in a custom format; its default request-line-only format never contains them. Plugin Python code receives normal request headers and can forward the key to its provider, but must not log or persist it. Only install trusted plugins: there is no sandbox around what an installed plugin does.

## Python backend

```py
from fastapi import APIRouter
from meshforge.plugins import jobs
router = APIRouter()

@router.post('/work')
def work():
    return {'job_id': jobs.start(long_work)}

def long_work(progress):
    progress(20, 'Reading scene')
    # both 0..1 and 0..100 percentages are accepted
    return {'ok': True}
```

The module must export a FastAPI `APIRouter` as `router`; it mounts at `/api/plugins/<id>/`. Import failure disables that plugin, saves the error, and leaves MeshForge running.

`GET /api/plugins/<id>/jobs/<job_id>` returns:

```json
{"status":"queued|running|done|error", "progress":0.5,
 "message":"Working", "result":null, "error":null}
```

Other host endpoints: `GET /api/plugins` (enabled plugins only), `GET /api/plugins/all` (manager), and `POST /api/plugins/<id>/enabled` with `{"enabled":true}`. Static files are served from `/plugins/<id>/` while enabled.

## Mesh operations

Backends can `from meshforge import meshops`; browser plugins use their existing `mf.api` (the `window.MeshForge` object). v7.2 adds visual-hull carving, approximate Boolean voxel operations, decimate/retopo, floor and metric scene placement, and watertightness reports. Signatures, camera calibration and topology limitations are in **docs/meshops.md**. No new dependencies are needed; CPU only. Python uses the existing Instant Meshes adapter for quad retopo when available; browser retopo falls back to decimation.
