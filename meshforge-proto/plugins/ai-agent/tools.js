// Whitelisted agent tools. No eval. Each name maps to one MeshForge action.
// Original MIT code.

const obj = { type: 'object', properties: {}, additionalProperties: false };

export const TOOLS = [
  { name: 'list_objects', description: 'List objects in the open level.', parameters: obj },
  { name: 'select_object', description: 'Select one object by id or name.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'add_primitive', description: 'Add a cube, sphere, plane, sky, or water. One undo step.', parameters: { type: 'object', properties: { kind: { type: 'string' }, name: { type: 'string' } }, required: ['kind'] } },
  { name: 'transform_object', description: 'Move, rotate (degrees) or scale one object. One undo step.', parameters: { type: 'object', properties: { id: { type: 'string' }, position: { type: 'array' }, rotation: { type: 'array' }, scale: { type: 'array' } }, required: ['id'] } },
  { name: 'duplicate_object', description: 'Duplicate an object. One undo step.', parameters: { type: 'object', properties: { id: { type: 'string' } } } },
  { name: 'delete_object', description: 'Delete an object after the user confirms. One undo step.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_material', description: 'Create a material. colour is #rrggbb. Optional Chibili fields: bands, shade, rim.', parameters: { type: 'object', properties: { name: { type: 'string' }, color: { type: 'string' }, bands: { type: 'number' }, shade: { type: 'string' }, rim: { type: 'number' } }, required: ['name'] } },
  { name: 'duplicate_material', description: 'Duplicate a material by id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'assign_material', description: 'Assign a material to an object.', parameters: { type: 'object', properties: { id: { type: 'string' }, material: { type: 'string' } }, required: ['material'] } },
  { name: 'edit_material', description: 'Change a material colour or Chibili fields.', parameters: { type: 'object', properties: { id: { type: 'string' }, color: { type: 'string' }, bands: { type: 'number' }, shade: { type: 'string' }, rim: { type: 'number' } }, required: ['id'] } },
  { name: 'set_mode', description: 'Object, edit, sculpt, or pose. Pose needs a rigged GLB.', parameters: { type: 'object', properties: { mode: { type: 'string' } }, required: ['mode'] } },
  { name: 'set_camera', description: 'Set the camera position, target, and optional fov.', parameters: { type: 'object', properties: { position: { type: 'array' }, target: { type: 'array' }, fov: { type: 'number' } } } },
  { name: 'landscape_generate', description: 'Randomise the landscape. One undo step.', parameters: { type: 'object', properties: { seed: { type: 'number' } } } },
  { name: 'landscape_params', description: 'Change landscape numbers such as water level or tree count.', parameters: { type: 'object', properties: { patch: { type: 'object' } }, required: ['patch'] } },
  { name: 'send_landscape', description: 'Copy the landscape into the level as a group. One undo step.', parameters: obj },
  { name: 'decimate', description: 'Reduce triangles on one mesh. One undo step.', parameters: { type: 'object', properties: { id: { type: 'string' }, target: { type: 'number' } }, required: ['target'] } },
  { name: 'retopo', description: 'Retopologise one mesh. One undo step.', parameters: { type: 'object', properties: { id: { type: 'string' }, target: { type: 'number' } } } },
  { name: 'snap_to_floor', description: 'Drop objects onto a floor height. One undo step.', parameters: { type: 'object', properties: { id: { type: 'string' }, floorY: { type: 'number' } } } },
  { name: 'generate_from_image', description: 'Start a TripoSR job from an image the user dropped in the chat. The finished mesh is one undo step.', parameters: { type: 'object', properties: { index: { type: 'number' } } } },
  { name: 'text_to_image', description: 'PAID. Ask the connected provider for one image. OpenAI, xAI, or a compatible image endpoint. Spends API credit.', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  { name: 'make_views', description: 'OPTIONAL and PAID. Four Gemini image calls (front, back, left, right) using the separate Google key. Spends API credit four times.', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  { name: 'views_to_mesh', description: 'Turn the four views into a mesh with voxel carve, or the front view through TripoSR if carve is not asked.', parameters: { type: 'object', properties: { mode: { type: 'string' } } } },
  { name: 'export_scene', description: 'Download the level as glb or obj.', parameters: { type: 'object', properties: { format: { type: 'string' } } } },
  { name: 'edit_select_all', description: 'In Edit Mode, select all vertices, edges, or faces.', parameters: obj },
];

const NAMES = new Set(TOOLS.map((t) => t.name));
const PAID = new Set(['text_to_image', 'make_views']);

function summary(text) { return 'Agent: ' + text; }

export function isTool(name) { return NAMES.has(name); }

export async function runTool(ctx, name, args = {}) {
  if (!NAMES.has(name)) return { ok: false, summary: summary('refused an unknown action'), text: 'unknown tool' };
  const api = ctx.api;
  const actions = api.actions;
  if (!actions) return { ok: false, summary: summary('the editor actions are not ready'), text: 'no actions' };
  if (ctx.ask && name !== 'delete_object') {
    const allowed = await ctx.confirm(`Run ${name}?`);
    if (!allowed) return { ok: false, summary: summary(`skipped ${name}`), text: 'skipped' };
  }
  try {
    if (name === 'list_objects') {
      const list = api.getObjects();
      return { ok: true, summary: summary(`listed ${list.length} object(s)`), text: JSON.stringify(list) };
    }
    if (name === 'select_object') {
      const ok = await api.selectObject(args.id);
      return { ok: !!ok, summary: summary(`selected ${args.id}`), text: String(!!ok) };
    }
    if (name === 'add_primitive') {
      const r = actions.addPrimitive(args.kind, args.name);
      return { ok: !!r.ok, summary: summary(`added ${r.name || args.kind}`), text: JSON.stringify(r) };
    }
    if (name === 'transform_object') {
      const r = actions.transform(args.id, args);
      return { ok: !!r.ok, summary: summary(`transformed ${r.name || args.id}`), text: JSON.stringify(r) };
    }
    if (name === 'duplicate_object') {
      if (args.id) await api.selectObject(args.id);
      const id = await api.duplicateSelected();
      return { ok: !!id, summary: summary(`duplicated ${args.id || 'the selection'}`), text: String(id) };
    }
    if (name === 'delete_object') {
      const ok = await ctx.confirm(`Delete ${args.id}? You can undo it.`);
      if (!ok) return { ok: false, summary: summary('delete cancelled'), text: 'cancelled' };
      await api.selectObject(args.id);
      const done = await api.deleteSelected();
      return { ok: !!done, summary: summary(`deleted ${args.id}`), text: String(!!done) };
    }
    if (name === 'create_material') {
      const r = actions.createMaterial(args);
      return { ok: !!r.ok, summary: summary(`created material ${r.name}`), text: JSON.stringify(r) };
    }
    if (name === 'duplicate_material') {
      const r = actions.duplicateMaterial(args.id);
      return { ok: !!r.ok, summary: summary(`duplicated material ${r.name || args.id}`), text: JSON.stringify(r) };
    }
    if (name === 'assign_material') {
      const r = actions.assignMaterial(args.id, args.material);
      return { ok: !!r.ok, summary: summary(`assigned ${args.material} to ${r.name || args.id || 'the selection'}`), text: JSON.stringify(r) };
    }
    if (name === 'edit_material') {
      const r = actions.editMaterial(args.id, args);
      return { ok: !!r.ok, summary: summary(`edited material ${args.id}`), text: JSON.stringify(r) };
    }
    if (name === 'set_mode') {
      const mode = await actions.setMode(args.mode);
      return { ok: true, summary: summary(`set mode to ${mode}`), text: String(mode) };
    }
    if (name === 'set_camera') {
      const cam = api.setCamera({ position: args.position, target: args.target, fov: args.fov });
      return { ok: true, summary: summary('moved the camera'), text: JSON.stringify(cam) };
    }
    if (name === 'landscape_generate') {
      const r = actions.generateLandscape(args.seed);
      return { ok: !!r.ok, summary: summary(`generated a landscape (seed ${r.seed})`), text: JSON.stringify(r) };
    }
    if (name === 'landscape_params') {
      const r = actions.setLandscape(args.patch || {});
      return { ok: !!r.ok, summary: summary('updated landscape settings'), text: JSON.stringify(r) };
    }
    if (name === 'send_landscape') {
      const r = await api.sendLandscapeToScene();
      return { ok: !!r, summary: summary('sent the landscape into the level'), text: JSON.stringify(r) };
    }
    if (name === 'decimate') {
      const r = await actions.decimate(args.id, args.target);
      return { ok: !!r.ok, summary: summary(`decimated ${args.id || 'the selection'} to ${args.target} triangles`), text: JSON.stringify(r) };
    }
    if (name === 'retopo') {
      const r = await actions.retopo(args.id, args.target);
      return { ok: !!r.ok, summary: summary(`retopologised ${args.id || 'the selection'}`), text: JSON.stringify(r) };
    }
    if (name === 'snap_to_floor') {
      const r = actions.snapToFloor(args.id, args.floorY);
      return { ok: !!r.ok, summary: summary('snapped to the floor'), text: JSON.stringify(r) };
    }
    if (name === 'generate_from_image') {
      const image = (ctx.images || [])[args.index || 0];
      if (!image) return { ok: false, summary: summary('no image was dropped in the chat'), text: 'no image' };
      const r = await actions.startGenerate(image);
      return { ok: !!r.ok, summary: summary('started an image-to-3D job. The mesh is added as one undo step when it finishes.'), text: JSON.stringify({ ok: r.ok, job: r.job }) };
    }
    if (name === 'text_to_image') {
      const paid = 'This step spends API credit on an image.';
      const res = await ctx.backend('image', { method: 'POST', headers: { ...ctx.secretHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: ctx.provider, base: ctx.base, prompt: args.prompt, imageModel: ctx.imageModel }) });
      const data = await res.json();
      if (data.image) ctx.rememberImage(data.image);
      return { ok: !!data.ok, summary: summary((data.ok ? 'made an image. ' : 'image failed. ') + paid), text: data.ok ? 'image stored in the chat' : (data.message || 'failed') };
    }
    if (name === 'make_views') {
      const paid = 'Optional multi-view: four paid Gemini image calls.';
      const res = await ctx.backend('views', { method: 'POST', headers: { ...ctx.googleHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: args.prompt, base: ctx.googleBase || '' }) });
      const data = await res.json();
      if (data.images) ctx.rememberViews(data.images);
      return { ok: !!data.ok, summary: summary((data.ok ? 'made front, back, left, and right views. ' : 'views failed. ') + paid), text: data.ok ? '4 views stored' : (data.message || 'failed') };
    }
    if (name === 'views_to_mesh') {
      const views = ctx.views || [];
      if (views.length < 4) return { ok: false, summary: summary('needs four views first. Multi-view is optional and paid.'), text: 'no views' };
      if ((args.mode || 'carve') === 'triposr') {
        const r = await actions.startGenerate(views[0].image);
        return { ok: !!r.ok, summary: summary('sent the front view to the single-image generator'), text: JSON.stringify({ ok: r.ok, job: r.job }) };
      }
      const r = await actions.carveFromImages(views.map((v) => v.image));
      return { ok: !!r.ok, summary: summary(r.ok ? 'carved a mesh from the four views' : (r.error || 'carve failed')), text: JSON.stringify(r) };
    }
    if (name === 'export_scene') {
      await actions.exportScene(args.format || 'glb');
      return { ok: true, summary: summary(`exported ${args.format || 'glb'}`), text: 'exported' };
    }
    if (name === 'edit_select_all') {
      const r = await actions.editSelectAll();
      return { ok: !!r.ok, summary: summary(r.ok ? 'selected everything in Edit Mode' : (r.error || 'could not select')), text: JSON.stringify(r) };
    }
  } catch (err) {
    return { ok: false, summary: summary('action failed'), text: String(err.message || err).slice(0, 300) };
  }
  return { ok: false, summary: summary('refused an unknown action'), text: 'unknown tool' };
}

export const paidTools = PAID;
