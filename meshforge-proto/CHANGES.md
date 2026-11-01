# What's new in MeshForge v5

**New Sculpt Mode.** Select an object and pick *Sculpt Mode* in the mode menu, or use *Add ▸ Sphere* to start from a ball. A brush palette on the left has ten brushes, on keys 1–0: Standard, Clay, Clay Buildup, Move, Smooth, Chisel, Carve, Pen, Inflate and Pinch.
- Strokes are spaced and interpolated along the mouse path and use an averaged surface normal, so they stay smooth. There's an optional lazy-mouse rope, Soft/Sharp/Constant falloff, and X symmetry (on by default, Y and Z optional).
- Hold Shift to smooth, hold Alt to invert, use S or [ ] for size and U or Shift+[ ] for strength. H shows all the keys.
- Clay adds one even layer per stroke. Clay Buildup keeps stacking up with every pass.
- Ctrl+Z / Ctrl+Shift+Z undo and redo whole strokes, in the same history as Edit Mode and object moves.

**Sculptron 3D** (orange button at the top right): adaptive detail. Under the brush, long triangle edges are split (both neighbouring triangles, so no cracks), so you can keep adding detail. The Detail slider is relative to the brush or a constant size. A live triangle counter, a warning at 500k and a hard cap (1,000,000 by default, editable) stop the browser from running out of memory. Undo works across these topology changes.

Exports (GLB, OBJ, STL, PLY, zip) include sculpting. Edit Mode, Landscape and image-to-3D generation still work, and the TripoSR backend and GPU fix haven't changed.

## Tested (headless Chrome with software rendering on Linux, not on your PC)
- Entered Sculpt Mode from Object Mode through the mode menu, then ran mouse-drag strokes with all ten brushes. Each one visibly changed the sphere (screenshots: docs/img/v5_brush_*.png).
- Over 4 passes Clay rose 0.024 → 0.047 → 0.070 → 0.093 and Clay Buildup rose 0.081 → 0.156 → 0.228 → 0.301 (sphere radius 0.7). Alt inverted the stroke and Shift turned it into Smooth. X symmetry moved 279 vertices on each side.
- Sculptron 3D took the sphere from 20,480 to 38,424 triangles. The mesh stayed closed: every edge has exactly two faces, there are no duplicate or degenerate faces, and Euler = 2. Four undos returned exactly the original 20,480-triangle mesh, and four redos brought back the closed 38,424-triangle mesh.
- After sculpting, OBJ and GLB export and re-parse with matching triangle counts, and STL and PLY encode. Edit Mode opens on the sculpted mesh, and the Landscape round trip works. No script errors.
- Speed (software rendering, so expect better on an RTX 4060): about 1 ms per dab on a 100k-triangle mesh and 2–5 ms on 320k (60 px brush), and surface picking takes about 0.05 ms.

## Known limits (please tell me what feels off)
- I haven't tried it on Windows, your RTX 4060, a pen tablet or a real mouse, so the brush "feel" needs your feedback. There is no pen-pressure support yet.
- Sculptron 3D only splits edges. It doesn't merge or remove triangles (no edge collapse), so repeated passes keep adding triangles. Use the counter and the cap.
- Sculpting welds the mesh, which drops vertex colours and UVs on that object. Entering Sculpt Mode the first time can clear older Edit Mode undo steps.
- Symmetry mirrors across the object's own local axes. If a generated model isn't centred on its own X = 0, the mirror lands off-centre.
- Undo snapshots for Sculptron strokes use memory, so only the last 24 are kept. Masking and alphas aren't included yet.

## Updating without reinstalling
Close MeshForge, then copy these files over your existing `meshforge-proto` folder:
- frontend/index.html, frontend/style.css, frontend/app.js, frontend/editor.js
- frontend/sculpt.js (new)
- README.md, WINDOWS.md, CHANGES.md, docs/img/v5_*.png (docs only)

Then start it again and press Ctrl+F5 in the browser.

# What's new in MeshForge v4

**New Landscape workspace.** Click *Landscape* at the top. Paint a small map with four colours (sand, grass, water, mountain), or drop in a painted image or a black-and-white height map, and it becomes a 3D landscape (20 × 20 m by default) with a flat see-through water plane and simple grey houses and towers placed only on flat, dry ground.
- Draw cliffs, hills and plateaus with Lasso, Rect or Circle, each with its own height and blend, and stack them for terraces.
- Sliders for heights, noise, edge blend, grid size (up to 256 × 256), water level and building rules.
- *Randomize map* builds a new map from a seed. The same seed always gives the same map, which is what the Play button will use later.
- Export the landscape as GLB, OBJ, STL or PLY, the height map and painted map as PNG, or save and reopen it as a .json project.
- Plain grey look: no grass, particles or water simulation. *Debug colour view* shows the paint colours on the terrain if you want them.

Nothing changed in image-to-3D generation, and the GPU fix is still in.

## Updating without reinstalling
Close MeshForge, then copy these files over your existing `meshforge-proto` folder:
- frontend/index.html, frontend/style.css, frontend/app.js
- frontend/landscape.js and frontend/landui.js (new)
- README.md, WINDOWS.md, CHANGES.md, docs/img/v4_*.png (docs only)

Then start it again and press Ctrl+F5 in the browser.

# What's new in MeshForge v3

**Move, rotate and scale now work.** Click the model to select it (it gets an orange outline). Then either:
- pick Move, Rotate or Scale on the left shelf and drag the coloured gizmo, or
- press G (move), R (rotate) or S (scale) and move the mouse. Press X, Y or Z to lock to an axis, hold Ctrl to snap, click or press Enter to confirm, and press Esc or right-click to cancel.

Middle-mouse orbit, Shift+middle-mouse pan, wheel zoom and the numpad views all work as before.

**New Edit Mode.** Choose *Edit Mode* in the mode dropdown, or press Tab. You'll see the mesh's points (vertices), edges and faces. Press 1, 2 or 3, or use the Vert / Edge / Face buttons, to choose what you select. Click to select (Shift adds), or drag a box. Then G, R or S moves, rotates or scales just those parts, and the model updates as you go. With the *Quads* remesh option, you see the real quad edges.

**Undo and redo.** Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes, for both object moves and Edit Mode changes.

**Better export.** Export GLB, OBJ, STL or PLY from the Export panel or the File menu. These save the mesh as it looks now, including your edits and moves. *Download model (.zip)* gives you the mesh plus a preview picture. You can also download the original files from the server: the cleaned GLB, the quad OBJ, and the **raw TripoSR mesh** before any clean-up, so you can compare. The raw mesh is only kept for models you generate with v3.

**History.** Click any finished item to reload it, then export it.

**Help ▸ Keyboard shortcuts** lists every key.

Everything still runs offline. The GPU fix from last time ("expected scalar type Half but found Float") is included.

## Updating without reinstalling
Close MeshForge, then copy these files over your existing `meshforge-proto` folder:
- frontend/index.html, frontend/style.css, frontend/app.js, frontend/editor.js (new)
- frontend/vendor/TransformControls.js, GLTFExporter.js, OBJExporter.js, STLExporter.js, PLYExporter.js (all new)
- meshforge/jobs.py, meshforge/server.py, meshforge/engines/triposr.py (GPU fix)
- README.md, WINDOWS.md, CHANGES.md, docs/licensing.md, docs/img/v3_*.png (docs only)

Then start it again and press Ctrl+F5 in the browser so it loads the new files.
