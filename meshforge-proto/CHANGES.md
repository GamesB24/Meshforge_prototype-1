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
