# AI hooks in the UV panel

The *AI tools* section of the UV panel has empty slots for future helpers, for example AI seam suggestions or AI texture fills. Any script can add a working button:

```js
MeshForge.registerUVTool({
  id: 'my.flipU', label: 'Flip U',
  async run(ctx) {
    const uv = ctx.uv;                       // Float32Array copy of the UVs (2 per vertex)
    for (let i = 0; i < uv.length; i += 2) uv[i] = 1 - uv[i];
    ctx.apply(uv, 'Flip U');                 // writes the UVs, refreshes the views, and adds an undo step
  },
});
MeshForge.uv.runTool('my.flipU');
```

`ctx` contains:
- `mesh` and `THREE`
- `topology`: `{positions, triangles, faceCount}`
- `uv`: a copy of the UVs
- `selectedFaces`: the selected faces
- `texture`: the texture canvas, which you can draw on and then call `ctx.textureChanged()`
- `status(msg)`
- `apply(uv, label)`
- `algorithms`: the built-in UV functions, such as unwrap, smart, pack and stretch

Tools run locally in the page. A tool that calls a model server must use a local URL to keep MeshForge offline. Nothing in MeshForge sends data anywhere.
