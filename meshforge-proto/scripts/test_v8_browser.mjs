// Headless check for the v8 data-loss fix, hide, pose message and secret status.
// node scripts/test_v8_browser.mjs http://127.0.0.1:8765/?noautosave=1
import { createRequire } from 'node:module';
const puppeteer = createRequire('/tmp/mf-test/package.json')('puppeteer-core');
const url = process.argv[2];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
await page.setViewport({ width: 1400, height: 900 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.MeshForge && window.MeshForge.version === '8.0' && window.MeshForge.addWater, { timeout: 30000 });
let failed = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : ''));
  if (!cond) failed++;
}
const ids = async () => page.evaluate(() => window.MeshForge.getObjects().map((o) => o.label));
await page.evaluate(() => { window.MeshForge.addWater(); window.MeshForge.addSky(); });
const base = await ids();
check('primitives stay', base.includes('Water') && base.includes('Sky dome'), base);
await page.evaluate(() => window.MeshForge.loadGLB('/scenes/demo/meshes/chair.glb'));
const withChair = await ids();
const added = withChair.filter((n) => !base.includes(n));
check('import adds the chair and keeps the level', withChair.includes('Water') && withChair.includes('Sky dome') && added.length === 1, withChair);
await page.evaluate(() => window.MeshForge.undo());
const afterUndo = await ids();
check('undo removes only the imported mesh', afterUndo.includes('Water') && afterUndo.includes('Sky dome') && !afterUndo.includes(added[0]), afterUndo);
await page.evaluate(() => window.MeshForge.redo());
const afterRedo = await ids();
check('redo restores the imported mesh', afterRedo.includes(added[0]) && afterRedo.includes('Water') && afterRedo.includes('Sky dome'), afterRedo);
const land = await page.evaluate(() => {
  const g = window.MeshForgeLandscape.generate({ seed: 3, randomize: true, regions: false });
  return { buildings: g.buildings.length, trees: window.MeshForgeLandscape.result.trees.length };
});
check('several buildings and some trees', land.buildings > 1 && land.trees > 0, land);
const sent = await page.evaluate(async () => {
  const before = window.MeshForge.getObjects().map((o) => o.id);
  await window.MeshForge.sendLandscapeToScene();
  const objs = window.MeshForge.getObjects();
  const land = objs.find((o) => o.label === 'Landscape');
  const names = [];
  const model = window.MeshForge.model;
  model.traverse((o) => { if (o.name && o.parent && o.parent.name === 'Landscape') names.push(o.name); });
  return { before: before.length, after: objs.length, names, kept: before.every((id) => objs.some((o) => o.id === id)) };
});
check('landscape arrives as a hierarchy and does not remove the level', sent.kept && sent.names.includes('Terrain') && sent.names.includes('Water') && sent.names.includes('Buildings') && sent.names.includes('Trees'), sent);
await page.evaluate(() => window.MeshForge.undo());
const afterLandUndo = await ids();
check('undo of landscape leaves the earlier objects', afterLandUndo.includes('Water') && afterLandUndo.includes('Sky dome') && !afterLandUndo.includes('Landscape'), afterLandUndo);
const pose = await page.evaluate(async () => {
  await window.MeshForge.setMode('pose');
  return { mode: window.MeshForge.mode, msg: document.getElementById('progMsg').textContent };
});
check('pose mode explains the missing rig', pose.mode !== 'pose' && /rigged GLB|glTF|skeleton/i.test(pose.msg), pose);
const hidden = await page.evaluate(() => {
  window.MeshForge.selectObject('Water');
  window.MeshForge.hideSelection();
  const water = window.MeshForge.getObjects().find((o) => o.label === 'Water');
  window.MeshForge.unhideAll();
  const shown = window.MeshForge.getObjects().find((o) => o.label === 'Water');
  return { was: water.visible, now: shown.visible };
});
check('H hides and Shift+H shows', hidden.was === false && hidden.now === true, hidden);
const secret = await page.evaluate(() => {
  const tab = document.getElementById('pluginTab-_example');
  tab?.click();
  const input = document.querySelector('#exSecret');
  const btn = document.querySelector('#exSecretSet');
  if (!input || !btn) return { missing: true };
  input.value = 'not-a-real-key';
  btn.click();
  return { text: document.querySelector('.mf-secret-status')?.textContent || document.querySelector('#exSecretStatus')?.textContent || '' };
});
check('session key status is visible and unverified', !secret.missing && /not verified/i.test(secret.text) && /not used|has not used/i.test(secret.text), secret);
check('no page errors', errors.length === 0, errors.slice(0, 4));
await browser.close();
if (failed) process.exit(1);
console.log('browser tests ok');
