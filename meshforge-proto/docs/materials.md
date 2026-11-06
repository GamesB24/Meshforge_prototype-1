# Materials, library, paint and textures

## The library
The strip along the bottom of the **Shader** and **UV** tabs shows every material as a small Chibili preview. MeshForge starts with 12: Cherry Red, Tangerine, Sunflower, Leaf Green, Aqua Cyan, Cobalt Blue, Grape Purple, Bubblegum Pink, Chalk White, Ink Black, Toon Sky and Toon Water.

- **Assign**: drag a swatch onto an object in the 3D view. In Edit Mode, select faces first and drop the swatch on them, or use *Assign* in *Material Slots*. Only those faces change.
- **New / Duplicate / Rename / Delete**: use the *Material* panel or right-click a swatch. Each material has a main colour and a shadow colour. Sky materials also have top and horizon colours. Water materials have foam colour, foam scale and waves.
- Each object keeps a list of **slots**. The faces of each slot are saved as GLB primitives, or as OBJ `usemtl` groups with an MTL file.

## Paint brush (P)
*Face material* paints the active material onto faces under the brush. *Vertex colour* paints colour. The settings are size in pixels, opacity, falloff (smooth, linear, sharp or constant) and pen pressure. The colour wheel sets the active material's colour.

## Textures
*Texture ▸ Create texture* makes a named canvas texture at 512, 1024 or 2048 px. It can start from the material colours or from blank white. If the mesh has no UVs, MeshForge runs Smart UV Project first. Paint the texture in 3D with the brush, or click *Paint in 2D view…* to open the split view (docs/uv.md). Undo works for every stroke. Export embeds the texture in the GLB, or saves it as `<name>.png` with the OBJ+MTL.

## API
`MeshForge.materials.list / get / create / duplicate / rename / remove / update / setActive / assign / slots`.
