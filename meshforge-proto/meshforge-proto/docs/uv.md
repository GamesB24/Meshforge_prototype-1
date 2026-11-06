# UV tools

The UV workflow is **workflow-compatible, not code-identical** with Blender. The steps and shortcuts will feel familiar: mark seams, unwrap, pack, and Smart UV Project. All the algorithms are MeshForge's own MIT code in `frontend/uv.js` and `frontend/uvedit.js`, so the results will differ in the details.

## The UV tab
Opening the **UV** tab splits the viewport: the 3D view is on the left and the 2D UV and texture view is on the right.

| Panel | What it does |
|---|---|
| Seams | In Edit Mode, select edges and choose *Mark* or *Clear*. *Seams from Islands* turns the current island borders into seams. *Clear all* removes every seam. Seams show in coral. |
| Unwrap | *Unwrap* cuts along the seams and flattens each island, using *angle* (less distortion, slower) or *conformal* (faster). Also *Smart UV Project* (angle limit and area weight), *Cube* (with a size), *Cylinder*, *Sphere*, *From View* and *Reset*. *Margin* sets the gap between islands. |
| Islands | *Pack* (with an optional rotate), *Average Island Scale* and *Minimize Stretch* work on the selected islands, or on all islands if none are selected. *Stretch* shows a heat map from blue (good) to pink (stretched). |
| Texture | Create a texture or delete it, and set the paint colour, size and opacity. |
| Import / export | UV layout PNG (512 to 4096 px), UV JSON, and *Import UVs* from .obj, .glb, .gltf or .json. Imported UVs are matched to the current mesh by vertex position. |
| AI tools | Placeholders, plus any tools added through `MeshForge.registerUVTool` (docs/ai-hooks.md). |

The **U** key opens the unwrap menu in the 3D view (in Edit Mode, or in the UV tab).

## The 2D view
- Wheel: zoom. Middle or right drag: pan. **Home**: fit.
- Click an island to select it. Shift+click adds to the selection. Drag to box-select. **A** selects all and **Alt+A** deselects.
- **G / R / S** move, rotate or scale the selection. Press **X** or **Y** to lock an axis. Click to confirm, and Esc or right-click to cancel.
- Toolbar: select, brush (**B**), eraser (goes back to the original texture), fill, soften, sync selection with 3D, and fit.
- Every operation and every paint stroke can be undone with Ctrl+Z.

## Limits
- Unwrap works on the whole mesh, not only the selected faces.
- Re-unwrapping a painted mesh garbles the painting.
- On big meshes, angle-based unwrap is slow (about 8 s on 82k triangles in software rendering). Use Smart UV Project, or reduce the mesh first.

## API
`MeshForge.uv.unwrap({method}) / smartProject / cubeProject / cylinderProject / sphereProject / projectFromView / reset / pack / averageScale / minimizeStretch / markSeam / clearSeam / seamsFromIslands / clearAllSeams / exportLayout / exportJSON / importText / importFile / selectAll / selectIslandAt / transform / runTool / tools / stats / setTool / options`.
