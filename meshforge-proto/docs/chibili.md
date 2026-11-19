# Chibili toon render engine

Chibili is MeshForge's own toon shader. It is original MIT code, written as a three.js ShaderMaterial in `frontend/chibili.js`.

## Turning it on
Click ✦ in the shading switcher at the top of the viewport, or open the **Shader** tab. In code: `MeshForge.setShading('chibili')`.

## How it looks
- **Bands**: half-lambert light split into 1 to 5 flat steps. *Softness* blurs the step edges.
- **Shadow tint**: the dark band moves towards the material's *shade* colour instead of black, which keeps colours bright.
- **Rim light** and **highlight**: small extra bright accents.
- **Outlines**: an inverted hull with a width in screen pixels, so lines stay the same thickness when you zoom. Normals are smoothed first so hard edges don't break the outline. Skinned meshes get a skinned outline that follows the animation.
- **Sky** material: a vertical gradient with no outline. **Water** material: foam that moves, small waves and 2 bands.

Global settings live under *Shader ▸ Chibili render settings* (or `MeshForge.chibili`). A material can override bands, softness, rim and outline for itself.

## Limits
- Instanced meshes (the landscape buildings) keep their normal material.
- The shader uses vertex colours, material slots and a painted texture. It doesn't use normal maps or PBR maps.
- Outlines are drawn as a second pass, so very dense scenes cost twice the vertex work.
