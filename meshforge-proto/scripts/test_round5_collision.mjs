// Round 5: collision, content-browser import, asset editor, agent get/set.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const puppeteer = createRequire(process.env.PUPPETEER_PKG || '/tmp/mf-test/package.json')('puppeteer-core');
const base = process.argv[2] || 'http://127.0.0.1:8765/frontend/index.html';
const outDir = process.env.SHOTS || '/opt/cursor/artifacts';
await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.setViewport({ width: 1400, height: 900 });
const url = new URL(base);
url.searchParams.set('noautosave', '1');
await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.MeshForge?.collision && window.MeshForge?.content, { timeout: 30000 });
const report = { ok: true };
function check(name, pass, detail) {
  if (!pass) report.ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}

const setup = await page.evaluate(() => {
  window.MeshForge.addItem('cube');
  window.MeshForge.addItem('cube');
  const cubes = window.__meshforge.editor.debug.meshes().filter((o) => o.name === 'Cube');
  cubes[0].position.set(0, 0, 0);
  cubes[1].position.set(3, 0, 0);
  const cols = cubes.map((o) => window.MeshForge.collision.get(o.userData.sceneId || o.name));
  window.__meshforge.editor.select(cubes[0]);
  window.__meshforge.editor.select(cubes[1], { extend: true });
  const applied = window.MeshForge.collision.set('selection', { preset: 'NoCollision', enabled: false });
  const after = cubes.map((o) => o.userData.collision.preset);
  window.MeshForge.collision.set(cubes[0].userData.sceneId, { preset: 'BlockAll', type: 'box', enabled: true });
  window.MeshForge.addItem('mannequin');
  const man = window.__meshforge.editor.debug.meshes().find((o) => o.name === 'Mannequin');
  man.position.set(0, 0, 1.8);
  window.MeshForge.collision.show(true);
  const debug = window.__meshforge.model.parent.children.some((o) => o.userData?.isCollisionDebug && o.visible && o.children.length > 0);
  return { presets: cols.map((c) => c.preset), applied: applied.length, after, debug, man: man.userData.collision.preset };
});
check('primitives get collision and a multi-select apply', setup.presets.every((p) => p === 'BlockAll') && setup.applied >= 2 && setup.after.every((p) => p === 'NoCollision'), setup);
check('collision debug draws when the viewport toggle is on', setup.debug === true, setup);

const blocked = await page.evaluate(async () => {
  const man = window.__meshforge.editor.debug.meshes().find((o) => o.name === 'Mannequin');
  man.position.set(0, 0, 1.8);
  const cam = window.__meshforge.camera;
  cam.position.set(0, 1.6, 4);
  window.__meshforge.controls.target.set(0, 0.6, 0);
  window.__meshforge.controls.update();
  window.MeshForge.setBehaviours(man.userData.sceneId || man.name, [{ type: 'character', enabled: true, params: { speed: 4.5, jump: 6, camera: 'none' } }]);
  window.__meshforge.editor.setMode('object');
  const started = window.MeshForge.game.startPlay();
  window.MeshForge.game.setMoveInput({ x: 0, z: 1 });
  await new Promise((r) => setTimeout(r, 700));
  const z = man.position.z;
  window.MeshForge.game.stopPlay();
  return { started, z, restored: Math.abs(man.position.z - 1.8) < 0.05 };
});
check('character is stopped by a solid mesh', blocked.started && blocked.z > 0.45 && blocked.z < 1.7, blocked);
await page.screenshot({ path: `${outDir}/collision_blocked.png` });

const water = await page.evaluate(async () => {
  window.MeshForge.addItem('water');
  const waterMesh = window.__meshforge.editor.debug.meshes().find((o) => o.name === 'Water');
  const man = window.__meshforge.editor.debug.meshes().find((o) => o.name === 'Mannequin');
  man.position.set(0, 0, 0);
  const preset = waterMesh.userData.collision.preset;
  window.MeshForge.setBehaviours(man.userData.sceneId || man.name, [{ type: 'character', enabled: true, params: { speed: 4.5, jump: 0, camera: 'none' } }]);
  window.__meshforge.editor.setMode('object');
  window.MeshForge.game.startPlay();
  window.MeshForge.game.setMoveInput({ x: 1, z: 0 });
  await new Promise((r) => setTimeout(r, 500));
  const moved = man.position.length();
  const inWater = man.userData.behaviours?.find((b) => b.type === 'character')?._inWater === true;
  window.MeshForge.game.stopPlay();
  return { preset, moved, inWater };
});
check('water is an overlap that slows the character instead of blocking it', water.preset === 'Water' && water.inWater && water.moved > 0.15 && water.moved < 2.05, water);

const land = await page.evaluate(async () => {
  const level = window.MeshForge.buildLevel({ seed: 3, width: 16, depth: 16, trees: 0 });
  const names = [];
  window.__meshforge.model.traverse((o) => { if (o.isMesh) names.push(o.name + ':' + (o.userData.collision?.preset || '') + ':' + (o.userData.collision?.type || '')); });
  const terrain = names.find((n) => n.startsWith('Terrain:'));
  const waterMesh = names.find((n) => n.startsWith('Water:'));
  return { level: level?.children || [], terrain, waterMesh };
});
check('landscape terrain blocks and its water stays a trigger', /Terrain:BlockAll:complex/.test(land.terrain || '') && /Water:Water/.test(land.waterMesh || ''), land);
await page.screenshot({ path: `${outDir}/collision_landscape.png` });

const browserAssets = await page.evaluate(async () => {
  const file = new File(['o Cube\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\nf 1 3 4\n'], 'crate.obj', { type: 'text/plain' });
  const asset = await window.MeshForge.content.importFile(file);
  window.MeshForge.content.setTab('content');
  const listed = window.MeshForge.content.assets().some((a) => a.name === 'crate' && a.folder === 'Imported');
  const placed = await window.MeshForge.content.place(asset.id, { x: 2, y: 0, z: 1 });
  const obj = window.__meshforge.editor.debug.meshes().find((o) => o.name === 'crate');
  const opened = window.MeshForge.content.assetById(asset.id);
  window.MeshForge.openAssetEditor(asset.id);
  const editorOpen = !document.getElementById('assetEditor').hidden;
  document.getElementById('aeAddBox').click();
  document.getElementById('aeSave').click();
  const saved = window.MeshForge.content.assetById(asset.id).payload.collision;
  const agentGet = await window.MeshForge.agent.executeTool('get_collision', { target: 'crate' });
  const agentSet = await window.MeshForge.agent.executeTool('set_collision', { target: 'crate', preset: 'OverlapAll', type: 'sphere', enabled: true });
  return { listed, pos: obj && [obj.position.x, obj.position.y, obj.position.z], editorOpen, shapes: saved.shapes?.length || 0, agentGet: agentGet.collision?.preset, agentSet: agentSet.ok && obj.userData.collision.preset, placed: !!placed, opened: opened?.name };
});
check('an imported mesh appears in the content browser and places at a point', browserAssets.listed && browserAssets.pos && Math.abs(browserAssets.pos[0] - 2) < 0.01 && Math.abs(browserAssets.pos[2] - 1) < 0.01, browserAssets);
check('double-click path opens the asset editor and saves a shape default', browserAssets.editorOpen && browserAssets.shapes >= 1, browserAssets);
check('the agent can read and write collision', browserAssets.agentGet === 'BlockAll' && browserAssets.agentSet === 'OverlapAll', browserAssets);
await page.screenshot({ path: `${outDir}/asset_editor_collision.png` });
await page.evaluate(() => window.MeshForge.content.setTab('content'));
await page.screenshot({ path: `${outDir}/content_import.png` });

if (pageErrors.length) { report.ok = false; console.log('page errors', pageErrors.slice(0, 6)); }
console.log(report.ok ? 'ALL PASS' : 'FAILED');
await browser.close();
process.exit(report.ok ? 0 : 1);
