# Licensing

## The UI is original, not Blender code
The interface borrows only *layout and interaction conventions* common to 3D tools (tool shelf, properties panel with collapsible sections, header with shading buttons, view gizmo, MMB orbit / Shift+MMB pan, numpad views, status bar). Conventions and ideas are not copyrightable; code and artwork are.
- No Blender source code, shaders, icons, matcap images, themes or fonts are used. The matcap is generated procedurally in `frontend/app.js`; icons are Unicode glyphs; CSS is written from scratch.
- The Blender name and logo are not used in the app (the Blender name/logo are trademarks of the Blender Foundation).
- Why it matters: Blender is **GPL-3.0-or-later**. Copying its code into MeshForge and distributing it would require releasing all of MeshForge under GPL. Keeping it original keeps your licensing options open (proprietary, MIT, etc.).

## Dependencies
| Component | Licence | Notes |
|---|---|---|
| three.js 0.170 (vendored in `frontend/vendor`) | MIT | keep the licence header |
| FastAPI / python-multipart | MIT / Apache-2.0 | |
| Uvicorn | BSD-3-Clause | |
| trimesh | MIT | |
| fast-simplification | MIT | quadric decimation |
| pynanoinstantmeshes (Instant Meshes) | BSD-3-Clause | quad remeshing |
| scikit-image (torchmcubes shim) | BSD-3-Clause | |
| NumPy / Pillow | BSD-3 (+ others) / MIT-CMU | |
| PyTorch | BSD-style (multiple permissive) | |
| rembg | MIT | default model u2net: Apache-2.0 (U-2-Net) |
| onnxruntime | MIT | |
| requests | Apache-2.0 | |
| TripoSR code + weights | MIT | include licence notice |
| PartCrafter / OmniPart (planned) | MIT | verify weight licences on their HF pages before shipping (not checked this run) |
| TRELLIS.2 (planned) | MIT, **but** nvdiffrast / nvdiffrec are under the NVIDIA Source Code License: research/evaluation (non-commercial) use only | needs replacement or a licence from NVIDIA for a commercial product |
| Modal SDK (optional) | Apache-2.0 | |
| **Avoided:** pymeshlab / MeshLab (GPL-3.0), Hunyuan3D (licence excludes UK/EU), Blender code (GPL-3.0) | | |

## Alternative: ship as a Blender add-on
An add-on runs inside Blender and imports `bpy`; the Blender Foundation treats add-ons as GPL-covered, so the **add-on's Python code must be GPL-compatible (in practice GPL-3.0-or-later)** when distributed. A clean way to do both:
- Keep the MeshForge server (engines, runners, post-processing) as a separate program under your own licence.
- Ship a thin GPL add-on that only talks to that server over HTTP (upload image, poll job, import the GLB). Communicating over a network/API with a separate program generally does not make that program GPL - get legal advice before relying on this for a commercial product.
