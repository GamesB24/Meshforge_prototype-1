# Rigged characters

MeshForge can open a character that was rigged and animated in another program, so you can preview it and its clips with Chibili and export it again for a game.

## Exporting from Blender
In Blender, use *File ▸ Export ▸ glTF 2.0* with:
- Format **glTF Binary (.glb)**
- Include: *Selected Objects* (the armature and the mesh), or the whole scene
- Mesh: *Apply Modifiers* on. Don't apply the Armature modifier: keep it live.
- Animation: *Animation* on, *Skinning* on, and NLA strips or Actions to export the clips
- Data ▸ Armature: *Export Deformation Bones Only* is fine. Keep at most 4 weights per vertex (glTF's limit).

FBX is **not supported**. Convert it to GLB first, for example by importing it into Blender and exporting as above.

## In MeshForge
Use *File ▸ Import rigged character (GLB / glTF)…*, or drop the .glb on the viewport. MeshForge opens files with a skin through the rig loader automatically. The **Rig & animation** panel appears and has:
- Clip picker, Play/Pause, Stop, Loop, a time slider and a speed control
- *Show bones* (teal bones with coral joints, drawn on top of the mesh)
- *Weights*: a heat map of how strongly the chosen bone moves each vertex, from indigo (none) to coral (full)
- Bone picker with X/Y/Z rotation sliders, *Reset bone* and *Rest pose*. Every pose change can be undone.

Export (GLB) writes the skeleton, the skin weights, your current materials and the animation clips.

## Limits
- Edit Mode and Sculpt Mode are blocked on skinned meshes, because moving vertices would break the skin.
- There are no tools to create rigs or paint weights. MeshForge only previews, poses and passes rigs through.
- Tested only with a small 3-bone test rig, in headless Chrome on Linux. Try it on your own Blender characters first.

## API
`MeshForge.loadRig(urlOrFile)` and `MeshForge.rig.info / play / pause / stop / scrub / setClip / selectBone / poseBone(name, [x, y, z] in degrees) / restPose / weightView / showBones`.
