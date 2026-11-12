// Headless check for round-one Play and Object Mode tools.
// Usage: node scripts/test_round1_play_xform.mjs http://127.0.0.1:8765/frontend/index.html
// Requires puppeteer-core (npm install puppeteer-core) and system Chrome.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

function loadPuppeteer() {
  const candidates = [process.env.PUPPETEER_PKG, '/tmp/mf-test/package.json', new URL('../package.json', import.meta.url).pathname].filter(Boolean);
  for (const pkg of candidates) {
    if (existsSync(pkg)) return createRequire(pkg)('puppeteer-core');
  }
  throw new Error('Install puppeteer-core next to this repo, or set PUPPETEER_PKG to its package.json');
}
const puppeteer = loadPuppeteer();

const url = (() => { const u = new URL(process.argv[2]); if (!u.searchParams.has('noautosave')) u.searchParams.set('noautosave', '1'); return u.href; })();
const chrome = process.env.CHROME || '/usr/bin/google-chrome';
const outDir = process.env.SHOTS || '/opt/cursor/artifacts';
if (!url) { console.error('missing url'); process.exit(2); }
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
const pageErrors = [];
const resourceErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') resourceErrors.push(msg.text()); });
await page.setViewport({ width: 1400, height: 900 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.MeshForge?.agent && window.__meshforge?.editor, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 400));

const report = { ok: true, checks: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (!pass) report.ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}

async function evalPage(fn, arg) {
  return page.evaluate(fn, arg);
}

const startup = await evalPage(() => {
  const names = [];
  window.__meshforge.editor.debug || null;
  const scene = window.__meshforge.editor.debug.meshes();
  // Walk the whole three scene via the canvas renderer is not exposed; use model children plus any known canned names.
  const rootNames = [];
  const model = window.MeshForge.model;
  model?.traverse((o) => rootNames.push(o.name));
  return {
    modelNames: rootNames,
    meshCount: scene.length,
    play: window.MeshForge.game.getState(),
  };
});
check('no canned actors at startup', !startup.modelNames.some((n) => /Player_Rig|Metaverse_Kiosk|Companion_Echo|Companion_Drone/.test(n)), startup);
check('play starts in edit', startup.play === 'edit', startup.play);

async function spawn(name, position) {
  return evalPage(async ({ name, position }) => {
    const res = await window.MeshForge.agent.executeTool('spawn_primitive', { type: 'cube', name, position, scale: [0.6, 0.6, 0.6], color: '#4f7fd6' });
    return res;
  }, { name, position });
}
await spawn('Cube_A', [0, 0.3, 0]);
await spawn('Cube_B', [1.4, 0.3, 0]);
await spawn('Cube_C', [-1.4, 0.3, 0]);

const moved = await evalPage(() => {
  const ed = window.__meshforge.editor;
  const all = ed.debug.meshes();
  const A = all.find((o) => o.name === 'Cube_A');
  const B = all.find((o) => o.name === 'Cube_B');
  const C = all.find((o) => o.name === 'Cube_C');
  ed.select(A);
  ed.select(B, { extend: true, toggle: false });
  const before = { A: A.position.x, B: B.position.x, C: C.position.x };
  window.MeshForge.applyNumeric('position', 0, before.B + 1);
  const after = { A: A.position.x, B: B.position.x, C: C.position.x, n: ed.selection().length };
  ed.undo();
  const undone = { A: A.position.x, B: B.position.x, C: C.position.x };
  ed.redo();
  const redone = { A: A.position.x, B: B.position.x };
  ed.setSpace('local');
  const local = ed.debug.tc.space;
  ed.setSpace('world');
  const world = ed.debug.tc.space;
  window.__meshforge.setTool('move');
  const tc = ed.debug.tc;
  return {
    before, after, undone, redone, local, world, n: after.n,
    gizmoMode: tc.mode, gizmoAttached: !!tc.object, helperVisible: tc.getHelper().visible,
  };
});
check('multi-select numeric moves only the selection', moved.after.A === moved.before.A + 1 && moved.after.B === moved.before.B + 1 && moved.after.C === moved.before.C && moved.n === 2, moved);
check('undo restores both', moved.undone.A === moved.before.A && moved.undone.B === moved.before.B && moved.undone.C === moved.before.C, moved.undone);
check('redo reapplies both', Math.abs(moved.redone.A - (moved.before.A + 1)) < 1e-6 && Math.abs(moved.redone.B - (moved.before.B + 1)) < 1e-6, moved.redone);
check('local and global gizmo space', moved.local === 'local' && moved.world === 'world', { local: moved.local, world: moved.world });
check('move gizmo attached', moved.gizmoAttached && moved.gizmoMode === 'translate' && moved.helperVisible, moved);

await evalPage(() => {
  const ed = window.__meshforge.editor;
  const A = ed.debug.meshes().find((o) => o.name === 'Cube_A');
  ed.select(A);
  window.__meshforge.setTool('move');
});
await page.screenshot({ path: `${outDir}/object_mode_gizmo_axes.png` });

const dup = await evalPage(() => {
  const ed = window.__meshforge.editor;
  const A = ed.debug.meshes().find((o) => o.name === 'Cube_A');
  const B = ed.debug.meshes().find((o) => o.name === 'Cube_B');
  ed.select(A);
  ed.select(B, { extend: true });
  const before = ed.debug.meshes().length;
  return before;
});
await page.evaluate(() => window.__meshforge && document.querySelector('[data-act="dup"]') === null);
const dupResult = await evalPage(async () => {
  const before = window.__meshforge.editor.debug.meshes().length;
  await window.MeshForge.duplicateSelected();
  const afterDup = window.__meshforge.editor.selection().map((o) => o.name);
  const count = window.__meshforge.editor.debug.meshes().length;
  await window.MeshForge.deleteSelected();
  const afterDel = window.__meshforge.editor.debug.meshes().length;
  window.__meshforge.editor.select(null);
  const outlines = [];
  window.MeshForge.model.traverse((o) => { if (o.userData.isSelection) outlines.push(o.name); });
  return { before, count, afterDup, afterDel, outlines };
});
check('duplicate and delete affect the selection', dupResult.count === dupResult.before + 2 && dupResult.afterDel === dupResult.before, dupResult);
check('clear selection removes highlights', dupResult.outlines.length === 0 && dup === dup, { outlines: dupResult.outlines });

const aligned = await evalPage(() => {
  const ed = window.__meshforge.editor;
  const all = ed.debug.meshes();
  const A = all.find((o) => o.name === 'Cube_A');
  const B = all.find((o) => o.name === 'Cube_B');
  const C = all.find((o) => o.name === 'Cube_C');
  ed.select(A);
  ed.select(B, { extend: true });
  const before = B.position.x;
  ed.align('x');
  const same = B.position.x === A.position.x && C.position.x === -1.4;
  ed.undo();
  return { same, restored: B.position.x === before, ax: A.position.x, bx: B.position.x };
});
check('align moves only the other selected object and undoes', aligned.same && aligned.restored, aligned);

const play = await evalPage(async () => {
  const ed = window.__meshforge.editor;
  const A = ed.debug.meshes().find((o) => o.name === 'Cube_A');
  const C = ed.debug.meshes().find((o) => o.name === 'Cube_C');
  ed.select(A);
  window.MeshForge.setBehaviours(A.uuid, [{ type: 'spin', enabled: true, params: { axis: 'y', speed: 180 } }]);
  const pose = { y: A.rotation.y, x: A.position.x, cx: C.position.x, cy: C.rotation.y };
  window.MeshForge.game.startPlay();
  await new Promise((r) => setTimeout(r, 450));
  const spinning = { y: A.rotation.y, state: window.MeshForge.game.getState() };
  window.MeshForge.game.pausePlay();
  const pausedAt = A.rotation.y;
  await new Promise((r) => setTimeout(r, 250));
  const paused = { y: A.rotation.y, state: window.MeshForge.game.getState() };
  window.MeshForge.game.stopPlay();
  const stopped = { y: A.rotation.y, x: A.position.x, cx: C.position.x, cy: C.rotation.y, state: window.MeshForge.game.getState() };
  return { pose, spinning, pausedAt, paused, stopped };
});
check('play runs the spin behaviour', play.spinning.state === 'play' && Math.abs(play.spinning.y - play.pose.y) > 0.2, play.spinning);
check('pause freezes the scene', play.paused.state === 'pause' && Math.abs(play.paused.y - play.pausedAt) < 1e-4, play.paused);
check('stop restores transforms', Math.abs(play.stopped.y - play.pose.y) < 1e-4 && Math.abs(play.stopped.x - play.pose.x) < 1e-4 && Math.abs(play.stopped.cx - play.pose.cx) < 1e-4 && play.stopped.state === 'edit', play.stopped);
check('unselected object was not spun', Math.abs(play.stopped.cy - play.pose.cy) < 1e-4, play);

await evalPage(() => window.MeshForge.game.startPlay());
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({ path: `${outDir}/play_scene_running.png` });
await evalPage(() => window.MeshForge.game.stopPlay());
await page.screenshot({ path: `${outDir}/play_scene_stopped.png` });

const keys = await evalPage(async () => {
  const ed = window.__meshforge.editor;
  const B = ed.debug.meshes().find((o) => o.name === 'Cube_B');
  ed.select(B);
  B.position.set(0, 0.3, 0);
  window.MeshForge.anim.setFrame(0);
  window.MeshForge.anim.insertKeyframe(B, 'loc');
  window.MeshForge.anim.setFrame(30, { apply: false });
  B.position.x = 2;
  window.MeshForge.anim.insertKeyframe(B, 'loc');
  window.MeshForge.anim.setFrame(0);
  const start = B.position.x;
  window.MeshForge.game.startPlay();
  await new Promise((r) => setTimeout(r, 500));
  const mid = B.position.x;
  window.MeshForge.game.stopPlay();
  const end = B.position.x;
  return { start, mid, end, state: window.MeshForge.game.getState() };
});
check('timeline keys advance during play and stop restores', keys.mid > keys.start + 0.15 && Math.abs(keys.end - keys.start) < 1e-3, keys);

const sample = await evalPage(() => {
  const before = window.__meshforge.editor.debug.meshes().map((o) => o.name);
  const loaded = window.MeshForge.loadSample('kiosk');
  const after = window.__meshforge.editor.debug.meshes().map((o) => o.name);
  return { beforeHasPlayer: before.includes('Player'), after, loaded };
});
check('sample is opt-in', sample.beforeHasPlayer === false && sample.after.includes('Player') && sample.after.includes('Companion_Drone'), { loaded: sample.loaded });

const scripted = await evalPage(async () => {
  const ed = window.__meshforge.editor;
  const C = ed.debug.meshes().find((o) => o.name === 'Cube_C');
  const x0 = C.position.x;
  window.MeshForge.setBehaviours(C.name, [{ type: 'script', enabled: true, params: { source: 'api.position.x += api.dt;' } }]);
  window.MeshForge.game.startPlay();
  await new Promise((r) => setTimeout(r, 300));
  const mid = C.position.x;
  window.MeshForge.game.stopPlay();
  return { x0, mid, end: C.position.x };
});
check('script behaviour runs and stop restores', scripted.mid > scripted.x0 + 0.05 && Math.abs(scripted.end - scripted.x0) < 1e-3, scripted);

const walked = await evalPage(async () => {
  const player = window.__meshforge.editor.debug.meshes().find((o) => o.name === 'Player');
  const z0 = player.position.z;
  const x0 = player.position.x;
  window.MeshForge.game.startPlay();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
  for (let i = 0; i < 20; i++) window.MeshForge.game.tick(1 / 30);
  const z = player.position.z;
  const x = player.position.x;
  const dist = Math.hypot(x - x0, z - z0);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
  window.MeshForge.game.stopPlay();
  return { z0, z, x0, x, dist, restoredZ: player.position.z, restoredX: player.position.x, state: window.MeshForge.game.getState() };
});
check('sample character moves while playing and stop puts it back', walked.dist > 0.4 && Math.abs(walked.restoredZ - walked.z0) < 1e-3 && Math.abs(walked.restoredX - walked.x0) < 1e-3 && walked.state === 'edit', walked);

report.pageErrors = pageErrors;
report.resourceErrors = resourceErrors;
if (pageErrors.length) report.ok = false;
await writeFile(`${outDir}/round1_test_report.json`, JSON.stringify(report, null, 2));
console.log(report.ok ? 'ALL PASS' : 'FAILED');
console.log('page errors:', pageErrors);
console.log('resource errors:', resourceErrors);
await browser.close();
process.exit(report.ok ? 0 : 1);
