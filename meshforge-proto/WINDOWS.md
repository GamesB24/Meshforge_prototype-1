# MeshForge on Windows (no Ubuntu / WSL needed)

Works on Windows 10 or 11 (64-bit). Made for an NVIDIA RTX card such as the RTX 4060 Laptop (8 GB).
**These Windows scripts have not yet been run on a real Windows PC.** If anything fails, run
`diagnose_windows.bat` and send the `diagnose.txt` file it creates.

**You need:** internet, about **8 GB free disk** (PyTorch ~4.5 GB, AI models ~2 GB, the rest ~1 GB),
and **15-40 minutes** for the first setup (mostly downloading). After that it starts in about 20 seconds.

## Steps

1. **Unzip properly.** Right-click `meshforge-proto-windows.zip` > **Properties** > tick **Unblock** (if shown) > OK.
   Then right-click > **Extract All...** and pick a simple place, e.g. `C:\MeshForge`.
   Don't run the files from inside the zip window.
2. **Check your NVIDIA driver.** Press **Start**, type `cmd`, open **Command Prompt**, type `nvidia-smi` and press Enter.
   - You should see a table with **NVIDIA GeForce RTX 4060 Laptop GPU** and a **Driver Version**.
   - If the driver version is **below 531**, or you get *"'nvidia-smi' is not recognized"*, update the driver:
     open the **NVIDIA App** (or GeForce Experience) > Drivers > download, or get it from
     https://www.nvidia.com/Download/index.aspx (choose GeForce > RTX 40 Series (Notebooks) > RTX 4060). Restart the PC afterwards.
   - You do **not** need to install CUDA or Visual Studio.
3. **Run setup once.** Open the extracted folder and double-click **`setup_windows.bat`**.
   - If Windows shows *"Windows protected your PC"*, click **More info > Run anyway** (see Troubleshooting).
   - It installs Python 3.11 if needed (via winget; accept any prompts), gets the TripoSR code,
     and installs everything into a private `.venv` folder. It never changes your system Python.
   - Wait until you see **"Setup finished. Now double-click run_windows.bat"**. Press a key to close.
4. **Start MeshForge.** Double-click **`run_windows.bat`**. Your browser opens **http://127.0.0.1:8000** after a few seconds.
   Keep the black window open while using the app.
5. **Make a model.** Drag an image into the app, leave Engine on **TripoSR** and Run on **Local GPU**, press Generate.
   The **first** generation downloads the TripoSR model (~1.7 GB) once, so it takes a few minutes. After that, a few seconds each.
6. **Stop it.** Close the black window (or press Ctrl+C in it).
7. **Uninstall.** Just delete the whole folder. Everything (Python packages, AI models, your generated meshes in `data`)
   lives inside it. If setup installed Python 3.11 or Git for you, you can remove them in Settings > Apps if you want.

**Tell me:** how long a generation takes, and the contents of `diagnose.txt` (double-click `diagnose_windows.bat`).

## Editing and exporting (new in v3)

**Tools (left shelf):** Select, Move, Rotate, Scale, then Orbit / Pan / Zoom. Click the model to select it (orange outline). With Move, Rotate or Scale active, a gizmo appears on the selection. Drag an arrow, ring or handle to transform; orbiting is paused while you drag.

**Edit Mode:** pick it in the mode dropdown (or press Tab). The mesh shows its vertices, edges and faces. If you generated with *Quads (Instant Meshes)*, the quad edges are shown; otherwise the triangle edges are. Use the Vert / Edge / Face buttons (or 1 / 2 / 3), click to select (Shift adds or toggles), and drag with the Select tool to box-select the visible elements. G / R / S then move, rotate or scale the selection. The surface updates live and its normals are recalculated. Edit Mode is designed for meshes up to about 10k faces and is capped at 200k triangles.

| Key | What it does |
|---|---|
| Left click | Select object / vertex / edge / face (Shift = add or toggle) |
| Left drag (Select tool, Edit Mode) | Box select (visible elements only) |
| G / R / S | Move / Rotate / Scale with the mouse; click or Enter to confirm |
| X / Y / Z while moving | Lock to that world axis (press again to unlock) |
| Hold Ctrl while moving | Snap (0.1 units, 15°, 0.1× scale) |
| Esc or right click | Cancel the current move |
| Tab | Object Mode ⇄ Edit Mode |
| 1 / 2 / 3 (Edit Mode) | Vertex / Edge / Face select |
| A / Alt+A | Select all (toggle) / deselect all |
| Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) | Undo / Redo (moves and vertex edits) |
| MMB drag / Shift+MMB / wheel | Orbit / Pan / Zoom |
| Numpad 1 / 3 / 7 (Ctrl = opposite), 5, `.` | Front / Right / Top, Persp/Ortho, Frame |
| Z | Toggle wireframe shading |

Help ▸ Keyboard shortcuts shows the same table inside the app.

**Export (Export panel or File menu).** GLB, OBJ, STL and PLY are written in the browser from the *current* mesh, so they include your Edit Mode changes and the object's move, rotate and scale. **Download model (.zip)** bundles `mesh.glb`, `mesh.obj` and a `preview.png` of the viewport. The server copies are also there: the **Processed GLB**, the **OBJ (quads)** (real quads, no edits), and the **Raw TripoSR** mesh before clean-up, so you can compare. The raw mesh is kept for jobs generated with v3 or later. Click any finished item in **History** to reload it, then export it the same way.


## Landscape mode (new in v4)
Click the **Landscape** tab at the top (or View ▸ Landscape workspace). Everything runs in the browser, no GPU job and no new installs.
1. **Paint** on the map with the Brush: yellow = sand (low), green = grass, blue = water (below the water plane), black = mountain (high). Erase paints back to grass. The 3D view updates a moment after each stroke.
2. **Or load an image**: drop a painted picture (colours snap to the nearest of the four) or a black-and-white height map (white = high) onto the map, or use *Load painted…* / *Load height map…*.
3. **Cliffs and hills**: pick Lasso, Rect or Circle and draw on the map. Set *Height* (metres above the ground around it) and *Blend* (0 = sharp cliff, bigger = gentle hill), and tick *Plateau* for a flat top. Regions apply top to bottom, so stack them for terraces; ▲/▼ reorders, the tick box turns one off.
4. **Tune** base heights, noise, edge blend, grid size (64–256) and world size under Terrain; the water level under Water; density, spacing, max slope, cliff clearance and tall-building share under Buildings. *Load house module (.glb)* swaps the default house for your own model.
5. **Randomize map** makes a new map from the seed (same seed = same map). **Export** saves GLB/OBJ/STL/PLY (terrain, plus buildings and water if ticked), the height map PNG, the painted map PNG, or the whole landscape as a .json project you can reopen.

For the future Play button: `MeshForgeLandscape.generate({ seed: 123 })` returns `{ group, terrain, sampleHeight(x, z), buildings, field }`.

## Sculpt mode (new in v5)
Pick **Sculpt Mode** in the mode menu (top left of the viewport) with an object selected, or choose **Add ▸ Sphere** to start from a ball (20k, 80k or 320k triangles). Drag on the model to sculpt. Drag off the model, or use the middle mouse button, to orbit. Tab takes you back to Object Mode.

**The ten brushes** (left-hand palette, keys 1–0):
1 Standard (raise along the surface) · 2 Clay (fills dips, one even layer per stroke) · 3 Clay Buildup (square-edged, keeps building up with every pass) · 4 Move (grab and drag) · 5 Smooth · 6 Chisel (cuts high points flat with a hard edge) · 7 Carve (crease / V-groove) · 8 Pen (fine detail line at a third of the brush size) · 9 Inflate · 0 Pinch

**Keys:** Shift held = smooth · Alt held = invert (dig instead of raise) · S + move mouse, or [ ] = brush size · U + move mouse, or Shift+[ ] = strength · X = X symmetry (on by default) · L = lazy mouse · F = cycle falloff (brush default / soft / sharp / constant) · D = Sculptron 3D · H = shortcut panel · Ctrl+Z / Ctrl+Shift+Z = undo / redo a stroke.

Strokes are spaced and interpolated along the mouse path (Spacing slider), use a stable averaged surface normal, and have an optional lazy-mouse rope for clean lines. Symmetry mirrors across the object's own X (and optionally Y/Z) axis.

**Sculptron 3D** (orange button at the top right of the window): turns on adaptive detail. While it is on, triangle edges under the brush that are longer than the detail size are split, so you can keep adding local detail without stretching. *Detail by brush size* keeps detail relative to the brush; *Constant* uses a fixed size. A triangle counter appears next to the button; you get a warning at 500k triangles and detail stops at the hard cap (1,000,000 by default, editable in the panel). It only adds triangles: it doesn't reduce them again (no edge collapse yet).

Sculpting welds the mesh's shared vertices first so seams don't tear (vertex colours and UVs are not kept on a sculpted mesh). Exports (GLB/OBJ/STL/PLY/zip) include your sculpting, also with Sculptron 3D, and Edit Mode works on the sculpted mesh afterwards.

## Toon look, materials, UVs and rigs (new in v7)
- **Chibili toon look**: click ✦ in the shading switcher, or open the **Shader** tab. It draws flat colour bands with black outlines. There are 12 starter materials (10 colours, Sky and Water) in the library strip at the bottom. Drag a material onto an object, or onto selected faces in Edit Mode. **P** turns on the paint brush, which has size, opacity and a colour wheel. You can also create named textures and paint them. See docs/chibili.md and docs/materials.md.
- **UV tab**: seams, unwrap, Smart UV Project, projections, pack, stretch view, the **U** menu, and a split 2D view for editing UVs and painting the texture. You can import and export UVs. See docs/uv.md (workflow-compatible, not code-identical) and docs/ai-hooks.md.
- **Rigs**: *File ▸ Import rigged character (GLB / glTF)…* lets you play, scrub and pose animations, and view bones and weights. Export keeps the skeleton and clips. FBX isn't supported. See docs/rigging.md.
- **Landscape** export from the File menu now includes the terrain, water and buildings with their materials.
- Details, what was tested and the known limits are in CHANGES.md.

## Troubleshooting

| Problem | What to do |
|---|---|
| **"Windows protected your PC"** / antivirus warns about a `.bat` | Normal for scripts downloaded from the internet. Click **More info > Run anyway**. Unblocking the zip (step 1) before extracting prevents it. If your antivirus quarantines a file, restore it and allow the folder. The scripts only install into this folder (plus Python/Git via winget if missing). |
| **"Python not found"** / setup stops at step 1 | Install Python **3.11** from https://www.python.org/downloads/release/python-3119/ ("Windows installer (64-bit)"), tick **Add python.exe to PATH**, finish, then run `setup_windows.bat` again. Python 3.13 is skipped on purpose (some 3D packages don't support it yet). |
| **winget not recognized** | Older Windows 10. Install "App Installer" from the Microsoft Store, or just install Python manually (row above). Git is optional; setup downloads TripoSR as a ZIP without it. |
| **pip error, "Failed building wheel", "Microsoft Visual C++ 14.0 is required"** | You're probably on an unsupported Python. Run `diagnose_windows.bat`; if Python isn't 3.10-3.12, delete the `.venv` folder, install 3.11 (above), and run setup again. Otherwise send me `diagnose.txt` and the first red error line. |
| **Setup failed halfway / downloads timed out** | Just run `setup_windows.bat` again; it continues where it stopped. To start completely fresh, delete the `.venv` folder first. |
| **App says CPU instead of the RTX 4060** (diagnose shows `torch.cuda.is_available(): False`) | Update the NVIDIA driver (step 2) and restart. On laptops, plug in the charger and in **NVIDIA Control Panel > Manage 3D settings** pick "High-performance NVIDIA processor". If it was set up before the driver worked, delete `.venv` and run setup again so it installs the GPU version. |
| **"CUDA out of memory"** | 8 GB is just enough. Close games, browsers with many tabs, and other GPU apps, then lower **Resolution** in the right panel from 256 to **192** (or 160). Restart MeshForge if it keeps failing. |
| **"Port 8000 is already in use"** | MeshForge is probably already open in another black window; use that or close it. If another program uses port 8000, open Command Prompt in the folder and run `set MESHFORGE_PORT=8001` then `run_windows.bat`, and open http://127.0.0.1:8001 . |
| **Browser doesn't open** | Open http://127.0.0.1:8000 yourself while the black window is running. |
| **"MeshForge is not set up yet"** | `setup_windows.bat` didn't reach "Setup finished". Run it again and check the first red error. |
| **Background removal is slow or warns about CUDA** | Harmless: it falls back to the CPU for that step. |

## What's in the folder
`setup_windows.bat` (once) · `run_windows.bat` (every time) · `diagnose_windows.bat` (writes `diagnose.txt`) ·
`scripts\` (the PowerShell scripts those call) · `meshforge\` (server) · `frontend\` (app UI) ·
created by setup: `.venv\`, `third_party\TripoSR\`, `models\`, `data\` (your generated meshes).

Technical notes: PyTorch 2.5.1 + CUDA 12.1 wheels (bundled CUDA, no toolkit needed). `torchmcubes` is replaced by
`torchmcubes_shim.py` (scikit-image) because the real package must be compiled with Visual Studio + CUDA toolkit;
results are the same and it costs about a second per model. Pins are in `windows-constraints.txt`.
