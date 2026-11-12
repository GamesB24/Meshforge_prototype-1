# MeshForge agent API

The page exposes `MeshForge.agent` after it loads. An external agent (Antigravity or any other tool that can run JavaScript in the page, or call `executeTool`) drives the **open scene**. Play then runs that scene. There is no separate built-in game.

## Discover tools

```js
await MeshForge.agent.executeTool('list_tools')
MeshForge.agent.listTools()
```

Each entry has `name`, `description` and `params`.

## Read the scene

```js
await MeshForge.agent.executeTool('get_scene_summary')
```

Returns `{ ok, mode, workspace, count, objects }`. Each object includes `id`, `label`, `position`, `rotation`, `scale` and `behaviours`.

`MeshForge.getObjects()`, `getSelection()`, `getBehaviours(id)` are the same data without going through a tool.

## Do something

Every mutating tool returns `{ ok: true, ... }` or `{ ok: false, error }`. Spawn, delete, transform, behaviour changes and scripts push an undo step (`editor.undo()` / Ctrl+Z).

| Tool | What it does |
|---|---|
| `spawn_primitive` | Adds a cube, sphere, cylinder, plane, torus or ramp. Existing objects stay. |
| `delete_object` | Removes one object by name or the selection. |
| `transform_object` | Sets position, rotation in degrees, or scale. |
| `set_behaviour` | Replaces behaviours. Types: `spin`, `oscillate`, `character`, `follow`, `script`. |
| `attach_script` | Appends a script. During Play the function runs as `new Function('api', source)` with `api.dt`, `api.time`, `api.position`, `api.rotation`, `api.scale`, `api.get(name)`, `api.key(code)`. |
| `build_level` | Builds a landscape and inserts it into the scene as a `Landscape` group. |
| `generate_level` | Adds a block arena to the scene. It does not press Play and it does not load the old shooter. |
| `set_material` | Colour, roughness, metalness. |
| `set_shading` | `solid`, `wire`, `matcap`, `color`, `chibili`. |
| `set_environment` | Adds a sky dome and, when asked, water. Existing objects stay. |
| `list_objects` | Id, label, source, visibility and selection. |
| `companion_speak` | Shows a companion line. Does not change the scene. |
| `transfer_credits` | Moves wallet credits through the MeshForge server. |

`POST /api/agent/command` only relays `{ action, params }` to the open page. The page runs the tool. `GET /api/agent/status` lists the same tool names.

Example that builds a new moving object rather than a fixed game:

```js
await MeshForge.agent.executeTool('spawn_primitive', { type: 'sphere', name: 'Orb', position: [0, 1, 0], scale: [1, 1, 1] });
await MeshForge.agent.executeTool('attach_script', { target: 'Orb', source: 'api.position.y = 1 + Math.sin(api.time * 2) * 0.4;' });
```

Press Play. Stop restores the pose from before Play.

## Keys

Provider keys are checked by the local server at `POST /api/auth/keys/test` and stored in `localStorage` (`mf_provider_keys`). They are not written into `.meshforge` files or the git repo. Google sign-in is a separate identity login and does not create a Gemini key.
