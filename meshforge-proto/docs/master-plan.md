# MeshForge master plan

Audit of `meshforge-ai-game` (commit `337cc4d`, 9 Nov) and the phased work that follows it. This document is the round-one audit. Round one also changes Play and Object Mode; those changes are marked below so later rounds do not rebuild them.

## How the prototype is put together

The app is a static three.js page (`frontend/`, no bundler) talking to a FastAPI job server (`meshforge/server.py`).

| Area | Where it lives | What it does today |
|---|---|---|
| Viewport, cameras, shading, menus | `frontend/app.js`, `frontend/index.html`, `frontend/style.css` | Perspective/ortho cameras, orbit controls, grid, matcap/solid/wire/vertex-colour/Chibili shading, File/Edit/Add menus |
| Object / Edit tools | `frontend/editor.js`, `frontend/vendor/TransformControls.js` | Selection outline, translate/rotate/scale gizmo, G/R/S modal transforms, undo stack, GLB/OBJ/STL/PLY export |
| Sculpt | `frontend/sculpt.js` | Ten brushes, symmetry, Sculptron edge split/collapse, masks, shared undo stack |
| Landscape | `frontend/landscape.js`, `frontend/landui.js` | A separate workspace: painted terrain (sand/grass/water/mountain), water plane, instanced buildings |
| Scene files | `frontend/scene.js`, `meshforge/scene.py` | `scene.json` + GLB nodes. One mesh per object, direct child of a scene root |
| Materials, UV, rigs | `frontend/materials.js`, `uv.js`, `uvedit.js`, `rig.js`, `chibili.js` | Material library, texture paint, unwrap, glTF skin playback |
| Image to 3D | `meshforge/jobs.py`, `engines/triposr.py`, `preprocess.py`, `postprocess.py`, `runners/` | One GPU job at a time. Local TripoSR or a cloud runner (mock by default). Results under `data/jobs/` |
| AI agent | `frontend/agent_bridge.js`, `meshforge/agent_bridge.py` | WebSocket bridge plus an offline phrase parser. Tools spawn primitives, delete, transform, shade, build a layout, speak |
| Auth | `frontend/auth.js`, `meshforge/auth.py` | Google and OpenAI sign-in, API keys, a local credit wallet |
| Timeline | `frontend/animation_timeline.js` | Location/rotation/scale keys, dopesheet, transport |
| Play (before round one) | `frontend/game_mode.js`, `frontend/companion.js` | Pressing Play built a fixed player, a kiosk and a drone and flew a third-person shooter. The user's scene was not the game |

Generation output is a GLB (and OBJ) on the job. The viewer fits it in frame and keeps the fit matrix on `model.userData.norm` so export can undo that fit. Scene objects keep their own transforms.

## What already works and must stay

- Image-to-3D queue, TripoSR engine, local/cloud runners, post-process (clean, smooth, decimate, quad remesh, hard edges). Not re-run on a GPU in this audit; the pipeline modules are intact.
- Sculpt mode, including Sculptron, symmetry and stroke undo.
- Landscape painting and its own export. It is still a separate workspace (see phase 4).
- Edit mode vertex/edge/face picking, box select, and G/R/S on the picked elements. Extrude, merge, loop select and the rest of section 5 are not implemented.
- Material library, Chibili, UV tools, rig import and clip playback.
- Scene import/export, outliner (eye, duplicate, delete), explode slider.
- Timeline key insert (I), dopesheet, auto-key hook on gizmo release.
- Agent console, Google/OpenAI key UI, wallet calls, primitive spawning.
- Undo/redo stack shared by object transforms, edit-mode vertex moves and sculpt strokes.

## What was broken or missing

### Play launched a canned game

`createGameMode` ignored the open scene. Play built `Player_Rig`, `Metaverse_Kiosk` and woke `Companion_Echo`, requested pointer lock, and replaced the editor camera with a shooter (WASD, jump, click-to-shoot, an E prompt that spent wallet credits). Stop only hid those objects. The drone mesh was parented to the scene at startup, invisible until Play. None of that is the user's level.

The agent tool `generate_level` is different: it drops cubes into the open scene when the user asks. That stays. Play must not invent a level by itself.

### Object Mode transforms were single-object and easy to miss

- `pickObject` took a Shift argument and did not use it. One object could be selected.
- The gizmo attached only while the Move, Rotate or Scale tool was active. Translate and rotate were forced to world space; scale was forced to local space. There was no Global/Local switch.
- Snap existed only while a G/R/S modal was active and Ctrl was held, at hard-coded 0.1 / 15° / 0.1 steps. The gizmo itself did not snap.
- There were no numeric location/rotation/scale fields.
- Duplicate and delete affected `editor.sel` only.
- The outliner listed objects only after a `scene.json` load (`userData.isScene`) and could not multi-select.
- A click that started on the gizmo could be treated as an empty pick if `TransformControls` had not yet set `axis`.
- Undo stored one matrix. A second selected object could not move with the first, so a transform could not be limited to "the selection" once more than one object existed.

### Timeline playback only moved the active object

`setFrame` wrote keys onto `editor.sel` and then advanced a mixer that held only that object's last baked clip. Other keyed objects stayed put. Play could not "run the timeline" until that was fixed. Round one evaluates every keyed object. The mixer is no longer stepped twice per frame.

### Other gaps against the spec (not in round one)

- No origin/pivot editing (section 3). Transforms use the object's origin. Multi-object gizmos use the selection bounds centre, which is not an editable pivot.
- No mesh statistics panel (section 4). The viewport subtitle shows a triangle total only.
- Edit mode has no extrude, dissolve, merge, weld, inset, bevel, bridge, fill, separate, normal tools, loop/ring select, linked select (L), or circularise (section 5).
- Landscape tools are the v4 painter. No custom brushes beyond the current set, and buildings are the built-in instances (sections 6–7).
- Importers cover images, GLB/glTF scenes and rigs. No FBX. No collision authoring. No spawn-density asset records.
- The main viewport and Landscape do not share one world. `setWorkspace('land')` hides `model` and shows the landscape group. Sending the landscape back copies a baked mesh (`sendLandscapeToScene`). Switching modes does not destroy the hidden scene, but it is not one hierarchy (section 8).
- The outliner is a flat list: no rename, lock, collections, parenting UI, or search (section 9). Round one does show every mesh and can multi-select.
- No animation library, retargeting, or per-character clip assignment (section 10). glTF clips on the loaded root play during Play if those nodes are not also keyed on the timeline.
- The agent can spawn, delete, transform by name, and build a block layout. It does not read statistics, collections, or the timeline, and a failed tool is a chat line rather than a structured scene diff (section 11).
- `spawn_primitive` used to parent meshes to the raw scene when no model was loaded, so the editor (which only walks `model`) could not pick them. Round one routes spawns through the scene root.

## Round one (this branch)

In scope:

1. This plan.
2. Play / Pause / Stop / Restart run the open scene. Stop puts transforms, visibility, material colour and the timeline frame back, and deletes objects that appeared during Play. Behaviours on `userData.behaviours` (`spin`, `oscillate`, `character`, `follow`, `script`) tick only while simulating. Timeline keys and non-keyed glTF clips play. The shooter, kiosk and drone are not created at startup. File → Load sample scene (kiosk) inserts them as normal meshes with behaviours, and only then does Play run that content.
3. Object Mode: Shift-click and box select, outlines on every selected object (brighter on the active one), Escape clears them, Move/Rotate/Scale gizmos with axis handles (the Select tool shows the move gizmo), Global/Local, snap steps, numeric fields, align and ground, duplicate/delete of the whole selection, undo/redo. A transform writes only the selected objects.

Left for later rounds: origin editing, statistics, the rest of Edit Mode, landscape/asset spawning, a shared world, a full outliner, an animation library, and a scene-aware agent.

## Later phases

Each phase should extend the modules above. Do not replace the viewport, the job queue, or the undo stack.

### Phase 2 — finish editor reliability (spec phase 1 remainder)

- Pivot display and "set origin" operations in `editor.js`, stored separately from geometry so moving the origin does not slide the mesh. Numeric fields already edit local channels; pivot work should respect them.
- A statistics readout fed by the same mesh walk as `editor.meshes()`: verts, edges, faces, triangles, bounds, and a scene total. Update it from `updateInfo` so sculpt and edit invalidate it.
- Keep Play's snapshot in `game_mode.js`. New per-object data (pivot, stats) must be restored on Stop if Play can change it.

### Phase 3 — Edit Mode (spec phase 2)

Build on `buildEdit` (welded vertices, edges, faces). Add real topology edits: extrude, delete/dissolve, merge/weld, inset, bevel, fill, normals, separate. Selection: linked (L), grow/shrink, loops and rings. Circularise is a transform of the current selection, written back through `syncGeometry`, with undo via the existing position snapshot. Do not fake this with a shader.

### Phase 4 — Landscape tools and spawnable assets (spec phase 3)

Keep the colour map and the current brushes. Add falloff, smooth/flatten, and replace the hard-coded building instances with a user asset list (GLB already loads). Collision can be a triangle mesh or a box the user picks, stored on `userData`, drawn as an overlay. Density, scale range and spacing belong on the asset record, not in `landui.js` constants.

### Phase 5 — one world (spec phase 4)

`model` and the landscape group need one root that Object Mode and Landscape both edit. Landscape keeps its map UI but writes the terrain mesh into that root instead of a private scene. Mode switches hide tools, not objects. `sendLandscapeToScene` becomes unnecessary once this exists. This is the riskiest structural change; do it after Play's snapshot and the outliner read the same root.

### Phase 6 — animation library and the agent (spec phase 5)

- A clip browser over glTF animations and timeline actions, assigned per object (`userData.clips`), previewed in the existing timeline.
- Agent tools should call `editor`, `sceneIO` and the behaviour list, then return `{ ok, error }` after reading the scene back. Destructive tools ask for an explicit confirm flag. Do not add a second scene graph for the agent.

### Phase 7 — integration pass (spec phase 6)

Same objects through generate → sculpt → edit → landscape → timeline → Play → Stop → undo, plus a GLB round trip. Auth and the agent socket tested with the backend up. No paid APIs.

## Constraints

- Extend these files. Do not rewrite the app or swap three.js out.
- New code stays original and MIT-compatible. No Blender (or other GPL) code, names, logos, or assets.
- No new paid services and no deploy step.
- API keys stay in the existing auth module, not in the page source.

## Round two recommendation

Finish phase 2 (origin/pivot and live statistics) and start phase 3 with linked select, extrude, and delete, on the welded mesh `editor.js` already builds. Leave the unified world and the asset spawner until those edits undo cleanly and Play still restores the scene. The agent should grow only after the outliner can rename objects, or it will keep addressing meshes by fragile display names.

## Round 2 (this branch, after the Play / Object Mode work)

Shipped here:

- `.meshforge` project JSON (objects, edited geometry, transforms, materials, hierarchy, behaviours, face sets, timeline keys, landscape paint/settings, camera), File → New / Open / Save / Save As, Ctrl+S, IndexedDB autosave and restore unless `?noautosave=1`.
- Landscape width and depth in metres. Extra spawn rules (trees, or the selected mesh) with count and scale. **Use as level ground** copies terrain, water and spawned meshes into a `Landscape` group in the main scene so they select, edit and play with everything else.
- Outliner lists groups and skips helper meshes parented under a mesh (wire and selection shells). Loading the kiosk sample replaces the previous sample group instead of appending another copy.
- Edit Mode: Alt+click edge loop, Alt+Shift+click edge ring, face loop, L / Ctrl+L linked, face sets.
- Right-hand icon strip switches Object, Edit, Sculpt and Landscape property panels.
- Agent tools `build_level`, `set_behaviour` and `list_objects` act on the open scene. “Make a game” builds a landscape level in the scene rather than the old shooter.

### Pose Mode, rigging and weight paint (not this round)

`frontend/rig.js` already plays a glTF skin, scrubs clips and poses bones that came in with a file. A real Pose / Weight Paint workflow is a separate system and is not half-built here. Next round should add:

- An armature object: a list of bones (head, tail, parent, roll) stored on `userData.armature`, drawn as lines in the viewport.
- Armature edit: add bone, extrude (new bone parented to the active one), and reparent, with undo.
- Parent mesh to armature: automatic weights by closest-bone distance, written to `geometry.attributes.skinIndex` / `skinWeight` and a `SkinnedMesh`. That is enough for the existing rig player to deform it.
- Weight Paint mode: one brush (add / subtract / smooth) on the active bone’s weights, heatmap colours, undo per stroke.
- Pose Mode: select a bone, rotate it, insert the pose as timeline keys (the timeline already stores Euler rotation per object; bone poses need a parallel track map). Play evaluates those tracks. Save/load writes the armature and the weight attributes next to the mesh geometry in the `.meshforge` file.

Do that as one slice. A bone list without weights, or weights without pose playback, is not worth merging.
