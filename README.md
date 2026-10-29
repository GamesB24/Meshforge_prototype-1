<img width="1500" height="860" alt="Meshforge v1 test images (3)" src="https://github.com/user-attachments/assets/04ee8a67-db0a-4a10-8952-36c2f2cc120e" />
I found the bug and fixed it. The GPU part of the model ran in half precision and the next step expected full precision, hence "expected scalar type Half but found Float". I reproduced the same mismatch on my side, and the fix gets past it, but I can't test on a real GPU, so you're the real test.


triposr
.py

2.2kB


The quickest way to apply the fix is to replace one file. No reinstall is needed.

Close the MeshForge black window.
Copy the triposr.py file above into meshforge-proto\meshforge\engines\ and overwrite the old one.
Start MeshForge again, using run_windows.bat or the port 8001 command, and generate the robot again.
If you'd rather get the full updated package, that's below, but it isn't needed. Tell me whether it works. If it fails again, send me the message in the bottom bar.

meshforge-proto-windows-v2
.zip

1.3MB


can you give me an instruction manual on how to run this to make a read me file for github

Writing a GitHub-ready README now, with install steps for Windows and Linux or WSL, usage, troubleshooting and licences. I'll send it as a file shortly.

I'm still writing the README and will send it when it's done. Let me know if the generation fix worked on your machine.

The README for the MeshForge GitHub repo is done. It has the Windows and Linux setup steps, how to use the UI, a troubleshooting table, the roadmap and the licences.


MeshForge-GitHub-README
.md

11kB



LICENSE-MIT
.txt

1kB


To use these files:

Rename the README to README.md in the repo root.
Rename the licence file to LICENSE. It's the standard MIT licence, with your name and 2026.
Fill in the TODOs in the README: your repo URL (it appears in the clone commands), the Issues and Discussions links, and contact details.
Two caveats before you publish:

The Windows steps still haven't been confirmed by a successful generation on your laptop. Please generate the robot once after the fix and tell me how it goes. If it fails, send me the message in the bottom bar.
The README suggests port 8001 when 8000 is busy, but WINDOWS.md in the package says 8010. Both work, and I can make them match.
When you're ready to publish, I can prepare the full repo folder, without the model files, for you to upload to GitHub.

I met with a friend of mine who's name is Shrinit Patil he studied in surrey University Masters in Ai Engineering he worked on improving 3D modeling Algorithm for Ai and has written a amazing paper on it he says. Can you check if you can find his paper he also said to checkout Nuke PS/ PS-Nuke related to this project can you help me with getting started or researching on this topic as well

Looking for Shrinit Patil's paper now, and researching what "Nuke PS" or "PS-Nuke" could be. I'll come back with what I find.

The search is running in the background and I'll send you what I find. If you can ask Shrinit for the paper's title or a link, that would make the match certain.

I couldn't find Shrinit Patil's paper. Searches of Google Scholar, arXiv and the Surrey research archive show nothing under his name. That isn't unusual, because MSc dissertations are often never published, so the simplest route is to ask him for the PDF or a title.

A public 
LinkedIn profile for a Shrinit Patil lists an MSc at Surrey (Computer Vision, Robotics and ML, 2023–24) and a company in Guildford. That fits what he told you except the course name, but a matching name isn't proof it's the same person, so check with him.

"Nuke PS": no paper or project uses that exact name. My best guess, with medium-to-high confidence, is PS-NeuS, a method that rebuilds detailed 3D surfaces from photos. NeuS sounds a lot like "news" when spoken. Other possibilities are photometric stereo combined with neural surfaces, or The Foundry's Nuke VFX software, which is unlikely. Ask Shrinit which he meant.

Does it help MeshForge? These methods rebuild one object from many photos, so they can't replace TripoSR. The useful idea is to use surface normals, the direction each bit of surface faces, to sharpen detail. That could go into your decoder training or into the clean-up step after generation.

The file has a reading list with licences and whether each fits your 8 GB RTX 4060, and a start-this-week list. The first steps are to ask Shrinit for the PDF, read the NeuS paper, and compare Stable Fast 3D against TripoSR.



No file chosen

Grok Bot
Details
Library
Computer
Today

research-shrinit-and-psnuke.md

LICENSE-MIT.txt

MeshForge-GitHub-README.md
This week

meshforge-proto-windows-v2.zip

triposr.py

triposr-code-map.pdf

meshforge-proto-windows.zip

meshforge-proto.tar.gz


compare_robot.png


ui_viewport.png

mesh.glb


robot_sheet.png

startup-viability-report.pdf
Older

podcast-market-research.pdf
MeshForge
Turn a single image into a clean, game-ready 3D mesh, on your own GPU, in a Blender-style viewport.

Status: v0.1 early preview. Built on TripoSR. Expect rough edges, and please tell us what breaks.

What it does
Image → 3D mesh with TripoSR (MIT), running locally.
Background removal with rembg, which you can switch off.
Post-processing of the raw mesh:
decimation to a target face count (fast-simplification)
quad remeshing (Instant Meshes, via pynanoinstantmeshes)
sharp-edge angle and smoothing controls
an option to split loose pieces into separate objects
A familiar 3D viewport: MMB orbit, Shift+MMB pan, numpad views, and wireframe, solid, matcap and vertex-colour shading. The UI is original code (see Licence).
Export as GLB or OBJ (quads).
Run on local GPU or cloud GPU. Local is the tested path. The cloud adapters (Modal, or your own GPU box over SSH) are experimental and untested.
Before/after post-processing comparison:

The raw shape comes straight from TripoSR. What MeshForge adds is the clean-up, the UI and the local/cloud switch.

Requirements
OS	Windows 10/11 64-bit (primary), Linux, or WSL2
GPU	NVIDIA GPU with 6–8 GB VRAM recommended (developed for an RTX 4060 Laptop, 8 GB). NVIDIA driver 531 or newer. You don't need the CUDA toolkit or Visual Studio.
No GPU?	It falls back to CPU. That's slower: about 25–45 s and about 3 GB RAM per generation
Disk	About 8 GB free: PyTorch about 4.5 GB, AI models about 2 GB, the rest about 1 GB
Python	3.11. The Windows setup installs it for you via winget if it's missing (3.10–3.12 work, but 3.13 doesn't yet)
Internet	Needed for setup and for the first generation, which downloads the TripoSR model (about 1.7 GB) once
First-time setup takes about 15–40 minutes, mostly downloading. After that, MeshForge starts in about 20 seconds.

Quick start: Windows
Get the code.
Zip: right-click the zip, then Properties, tick Unblock if it's shown, and click OK. Then right-click it, choose Extract All…, and pick a simple path such as C:\MeshForge. Don't run the files from inside the zip window.
Or git: git clone <TODO: repo URL> MeshForge
Check your driver. Open Command Prompt and run nvidia-smi. You should see your GPU and a driver version of 531 or newer. If you don't, update the driver from the NVIDIA App or nvidia.com and restart.
Run setup once. Double-click setup_windows.bat. It installs Python 3.11 if needed, fetches the TripoSR code, and installs everything into a private .venv folder. Your system Python isn't touched. Wait for "Setup finished. Now double-click run_windows.bat".
Start it. Double-click run_windows.bat. Your browser opens http://127.0.0.1:8000. Keep the black window open while you use the app.
Generate. Drag in an image, leave Engine on TripoSR and Run on on Local GPU, then click Generate 3D. The first run downloads the model, so it takes a few minutes. After that, each generation takes a few seconds.
Stop by closing the black window or pressing Ctrl+C in it.
To uninstall, delete the folder. Everything is inside it: packages, models, and your meshes in data\.

More detail: WINDOWS.md.

Quick start: Linux / WSL2

sudo apt update && sudo apt install -y python3.11 python3.11-venv git build-essential
git clone <TODO: repo URL> meshforge && cd meshforge
PYTHON=python3.11 ./run.sh --setup   # first time: venv, torch (CUDA or CPU), TripoSR, deps
./run.sh                             # every other time
Open http://127.0.0.1:8000 and stop it with Ctrl+C.

run.sh installs CUDA wheels if nvidia-smi is found, and CPU wheels if it isn't.
On WSL2: install it with wsl --install -d Ubuntu-22.04 in an admin PowerShell. Keep the normal Windows NVIDIA driver, and don't install a Linux driver inside WSL. nvidia-smi in Ubuntu should show your GPU. Open the URL in your Windows browser.
To use a different port: MESHFORGE_PORT=8001 ./run.sh
Using the app
Input. Drop an image anywhere in the viewport, or click to browse. Keep Remove background ticked unless your image already has a clean or transparent background.
Generator.
Engine: TripoSR. Parts, Retopo and Script are shown as Planned.
Run on: Local GPU or Cloud GPU (experimental).
Resolution: the marching-cubes grid size, 128–384 (default 256). Higher values need more VRAM.
Topology.
Remesh: Triangles (decimate), Quads (Instant Meshes), or Keep raw
Target faces: default 8k
Sharp angle: default 40°
Smoothing: 0–1, default 0.30
Split loose pieces into objects
Click Generate 3D and watch the status bar at the bottom.
Export as GLB or OBJ (quads). Earlier results are under History.
Viewport controls:

MMB drag to orbit, Shift+MMB to pan, and the wheel to zoom.
Numpad 1/3/7 for front, right and top views. Hold Ctrl for the opposite view. The 1/3/7 keys on the top row also work.
5 switches between perspective and ortho.
. or Home frames the object.
Z toggles wireframe.
Click the gizmo axes to snap the view.
Tips for good input images
Use a single object on a plain background. The app's own hint says this works best.
Show the object whole and centred, without cropping, at a slight three-quarter angle.
Use even lighting and avoid hard shadows or reflections.
The back of the object is guessed, so expect less detail there.
Detail is limited by TripoSR itself, so raising the face count won't add detail that isn't in the model's output.
Troubleshooting
Problem	Fix
"Windows protected your PC" or an antivirus warning on a .bat	This is normal for downloaded scripts. Click More info → Run anyway. Unblocking the zip before extracting avoids it.
Port 8000 is already in use	MeshForge may already be running in another window, so try http://127.0.0.1:8000 first. If another program owns the port, open Command Prompt and run:<br>cd /d "C:\path\to\meshforge-proto" && set MESHFORGE_PORT=8001 && run_windows.bat<br>Then open http://127.0.0.1:8001.
"CUDA out of memory" (8 GB cards)	Close games, GPU apps and heavy browser tabs. Lower Resolution to 192 or 160. Restart MeshForge if it keeps failing.
"Failed: expected scalar type Half but found Float"	This was a precision mismatch on GPU, fixed in this version (meshforge/engines/triposr.py). If you still see it, update to the latest code.
App runs on CPU instead of the GPU	Update the NVIDIA driver and restart. On laptops, plug in the charger and pick the high-performance NVIDIA GPU. If setup ran before the driver worked, delete .venv and run setup again.
"Python not found" or a pip build error ("Microsoft Visual C++ 14.0 is required")	Install Python 3.11 (64-bit, tick Add to PATH), delete .venv, and run setup again.
Setup failed halfway or a download timed out	Run setup_windows.bat again, and it continues where it stopped.
Browser doesn't open	Open http://127.0.0.1:8000 yourself while the black window is running.
Anything else	Double-click diagnose_windows.bat. It writes diagnose.txt (OS, Python, torch/CUDA, GPU and VRAM, package versions, nvidia-smi). Attach it to a GitHub issue.
Cloud GPU (experimental, untested)
MESHFORGE_CLOUD=mock (default): a free demo adapter that returns a sample mesh.
Modal: pip install modal && modal token new && modal deploy cloud/modal_app.py, then MESHFORGE_CLOUD=modal ./run.sh. This costs money on Modal. Credentials come only from Modal's own login or the MODAL_TOKEN_ID/MODAL_TOKEN_SECRET variables, and MeshForge doesn't store them.
Your own GPU box: run MeshForge there, then run ssh -L 9000:127.0.0.1:8000 user@gpu-host and MESHFORGE_CLOUD=remote MESHFORGE_REMOTE_URL=http://127.0.0.1:9000 ./run.sh. Never expose the port publicly.
Project structure
meshforge/          FastAPI server, job queue, preprocess/postprocess
  engines/          base.py, triposr.py (+ registry)
  runners/          local.py, cloud.py (mock / modal / remote)
frontend/           index.html, style.css, app.js, vendor/ (three.js 0.170)
cloud/modal_app.py  Modal deployment (untested)
scripts/            PowerShell scripts behind the .bat files, diagnose.py
docs/               architecture, post-processing benchmark, licensing, TripoSR code map
tools_compare.py    before/after post-processing benchmark
run.sh              Linux/WSL setup + launch
setup_windows.bat / run_windows.bat / diagnose_windows.bat

Created by setup: .venv/, third_party/TripoSR/, models/, data/ (your generated meshes).

On Windows, torchmcubes is replaced by torchmcubes_shim.py (scikit-image), so nothing needs compiling.

API:

POST /api/jobs
GET /api/jobs[/{id}]
GET /api/jobs/{id}/mesh.glb|mesh.obj
DELETE /api/jobs/{id}
GET /api/config
See docs/architecture.md.

Roadmap (planned, not built yet)
 Part-based generation (e.g. PartCrafter, OmniPart)
 A better topology / retopology engine
 Landscape mode: greyscale heightmap → terrain mesh
 Clean export into Unreal Engine
 A tested cloud GPU path
Contributing and feedback
This is an early preview, and feedback is the point of releasing it.

Bugs: open an issue (TODO: link to the Issues page) and attach diagnose.txt plus the error from the bottom status bar or the black window.
Feedback: tell us which results look unusable and what you'd want exported to Blender, Unreal or other tools. (TODO: link to Discussions, a form or Discord)
Pull requests are welcome. Please open an issue first for anything large.
Contact: TODO
Licence
MeshForge's own code: MIT (proposed). TODO: add a LICENSE file to the repo root before publishing.

MeshForge bundles or installs third-party components under their own licences:

Component	Licence
TripoSR code + weights (Stability AI & VAST)	MIT
rembg	MIT (default u2net model: Apache-2.0)
three.js 0.170 (vendored)	MIT
trimesh	MIT
fast-simplification	MIT
pynanoinstantmeshes (Instant Meshes)	BSD-3-Clause
scikit-image	BSD-3-Clause
PyTorch	BSD-style
onnxruntime	MIT
FastAPI / python-multipart	MIT / Apache-2.0
Uvicorn	BSD-3-Clause
NumPy / Pillow	BSD-3 / MIT-CMU
requests	Apache-2.0
Modal SDK (optional)	Apache-2.0
See docs/licensing.md for details.

Not affiliated with Blender. MeshForge isn't affiliated with or endorsed by the Blender Foundation, and it contains no Blender code, shaders, icons, themes or fonts. The UI is original. It follows common 3D-tool layout and navigation conventions only. "Blender" is a trademark of the Blender Foundation.

Credits: TripoSR is by Stability AI and VAST.
