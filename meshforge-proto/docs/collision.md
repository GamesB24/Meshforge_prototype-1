# Collision

Each mesh in the viewport is an actor. Its collision lives on `userData.collision` and is saved in the `.meshforge` project.

- **Enabled** turns the component on or off.
- **Type** is `none`, `box`, `sphere`, `capsule`, `convex` or `complex`. Convex and complex block against the mesh surface. Simple types use shapes you can resize.
- **Preset** is `BlockAll` (solid), `OverlapAll` (trigger), `NoCollision`, `Pawn` (the character) or `Water` (overlap that slows the character).
- Landscape terrain defaults to complex `BlockAll`. The water plane defaults to `Water`.
- **Apply to selection** writes the panel values onto every selected actor.
- The viewport Collision checkbox draws the shapes.

The content browser lists imported and generated meshes. Drag an asset into the view to place a new instance where the cursor hits the scene or the ground. Double-click an asset, or an actor in the outliner, to open the collision editor. Shapes saved there are the default for the next instance. An actor with **override** keeps its own settings.

The agent can call `get_collision` and `set_collision`.
