import { isTool, runTool, TOOLS } from '../plugins/ai-agent/tools.js';

let failed = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : ''));
  if (!cond) failed++;
}

const calls = [];
const api = {
  getObjects: () => [{ id: 'boat', label: 'Boat' }],
  selectObject: async (id) => { calls.push(['select', id]); return true; },
  duplicateSelected: async () => { calls.push(['dup']); return 'boat_2'; },
  deleteSelected: async () => { calls.push(['del']); return true; },
  setCamera: (c) => c,
  sendLandscapeToScene: async () => ({ id: 'landscape' }),
  actions: {
    addPrimitive: (kind, name) => { calls.push(['add', kind, name]); return { ok: true, name: name || kind, id: kind }; },
    transform: (id) => { calls.push(['xf', id]); return { ok: true, name: id }; },
    createMaterial: (def) => { calls.push(['mat', def.name]); return { ok: true, id: 'mat_red', name: def.name }; },
    duplicateMaterial: () => ({ ok: true, name: 'Red Toon.001' }),
    assignMaterial: (id, mat) => { calls.push(['assign', id, mat]); return { ok: true, name: 'Boat' }; },
    editMaterial: () => ({ ok: true }),
    setMode: async (m) => m,
    generateLandscape: () => ({ ok: true, seed: 1 }),
    setLandscape: () => ({ ok: true }),
    decimate: async () => ({ ok: true }),
    retopo: async () => ({ ok: true }),
    snapToFloor: () => ({ ok: true, count: 1 }),
    startGenerate: async () => ({ ok: true, job: 'job1' }),
    carveFromImages: async (images) => ({ ok: images.length === 4, name: 'Carved' }),
    exportScene: async () => ({ ok: true }),
    editSelectAll: async () => ({ ok: true }),
  },
};

check('unknown tool is refused', !(await runTool({ api, confirm: async () => true }, 'eval', { code: 'alert(1)' })).ok);
check('eval is not a tool', !isTool('eval') && !TOOLS.some((t) => t.name === 'eval'));

const created = await runTool({ api, confirm: async () => true }, 'create_material', { name: 'Red Toon', color: '#cc3344' });
check('create material is one named action', created.summary.includes('Red Toon') && calls.some((c) => c[0] === 'mat'));

const assigned = await runTool({ api, confirm: async () => true }, 'assign_material', { id: 'boat', material: 'mat_red' });
check('assign names the object', assigned.summary.includes('Boat') && assigned.summary.startsWith('Agent:'));

const blocked = await runTool({ api, confirm: async () => false }, 'delete_object', { id: 'boat' });
check('delete asks and can be cancelled', blocked.text === 'cancelled' && !calls.some((c) => c[0] === 'del'));
const removed = await runTool({ api, confirm: async () => true }, 'delete_object', { id: 'boat' });
check('confirmed delete runs once', removed.ok && calls.filter((c) => c[0] === 'del').length === 1);

let posts = 0;
const paid = await runTool({
  api,
  confirm: async () => true,
  provider: 'openai',
  secretHeaders: () => ({ 'X-Plugin-Secret-Provider': 'should-not-appear' }),
  googleHeaders: () => ({}),
  backend: async (path) => { posts++; return { json: async () => (path === 'image' ? { ok: true, image: 'data:image/png;base64,aaaa' } : { ok: false, message: 'no' }) }; },
  rememberImage() {},
  rememberViews() {},
}, 'text_to_image', { prompt: 'a red boat' });
check('image step is labelled as paid and does not echo the key', paid.summary.includes('spends API credit') && !paid.summary.includes('should-not-appear') && posts === 1);

if (failed) process.exit(1);
console.log('agent tool tests ok');
