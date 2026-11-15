// Round 4: Shift+A primitives, humanoid rig, character motion, content browser, Google diagnostics.
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
await page.waitForFunction(() => window.MeshForge?.addItem && window.MeshForge?.armature && window.MeshForge?.content, { timeout: 30000 });
const report = { ok: true, checks: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (!pass) report.ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}

const added = await page.evaluate(async () => {
  window.MeshForge.addItem('cube');
  const keep = window.MeshForge.getObjects().map((o) => o.label);
  window.MeshForge.openAddMenu(420, 180);
  const open = !document.getElementById('addMenu').classList.contains('hidden');
  const search = document.getElementById('addSearch');
  search.value = 'ico';
  search.dispatchEvent(new Event('input'));
  const labels = [...document.querySelectorAll('#addList button')].map((b) => b.textContent);
  window.MeshForge.addItem('icosphere');
  window.MeshForge.addItem('mannequin');
  window.MeshForge.addItem('point');
  window.MeshForge.addItem('camera');
  const names = window.__meshforge.editor.debug.meshes().map((o) => o.name);
  const ico = window.__meshforge.editor.debug.meshes().find((o) => o.name === 'Icosphere');
  const tris = ico ? (ico.geometry.index ? ico.geometry.index.count : ico.geometry.attributes.position.count) / 3 : 0;
  return { open, labels, keep, names, tris };
});
check('Shift+A menu opens and filters', added.open && added.labels.some((t) => /Icosphere/.test(t)) && !added.labels.some((t) => /Stairs/.test(t)), added.labels);
check('new primitives keep earlier objects', ['Cube', 'Icosphere', 'Mannequin', 'Point light', 'Camera'].every((n) => added.names.includes(n)) && added.keep.includes('Cube'), added);
check('icosphere is a moderate resolution', added.tris > 0 && added.tris < 2000, added.tris);
await page.evaluate(() => window.MeshForge.openAddMenu(480, 220));
await page.screenshot({ path: `${outDir}/add_menu_open.png` });
await page.evaluate(() => window.MeshForge.addItem('plane'));
await page.screenshot({ path: `${outDir}/add_menu_primitives.png` });

const rig = await page.evaluate(() => {
  const meshes = window.__meshforge.editor.debug.meshes();
  const man = meshes.find((o) => o.name === 'Mannequin');
  window.__meshforge.editor.select(man);
  const built = window.MeshForge.armature.humanoid(man);
  window.MeshForge.armature.enter('weight');
  const w = window.MeshForge.armature.setWeight('chest', 0, 1);
  const read = window.MeshForge.armature.weightOf('chest', 0);
  window.MeshForge.armature.enter('pose');
  const posed = window.MeshForge.armature.poseBone('upper_arm.L', [35, 0, 0]);
  const keyed = window.MeshForge.armature.keyPose();
  const names = window.MeshForge.armature.boneNames();
  const text = window.MeshForge.project.serializeText();
  return { bones: built?.bones?.length || 0, names, w, read, posed, keyed, hasSkin: text.includes('"skin"'), hasBone: text.includes('upper_arm.L') };
});
check('humanoid rig fits and binds weights', rig.bones >= 16 && rig.hasSkin && rig.hasBone, rig);
check('weight paint writes a normalised weight', rig.read > 0.9 && rig.read <= 1, rig);
check('pose rotation can be keyed', rig.posed && rig.keyed, rig);
await page.screenshot({ path: `${outDir}/humanoid_pose.png` });

const loaded = await page.evaluate(async () => {
  const text = window.MeshForge.project.serializeText();
  await window.MeshForge.project.loadText(text);
  const names = [];
  window.__meshforge.model.traverse((o) => { if (o.isBone) names.push(o.name); });
  const skinned = [];
  window.__meshforge.model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o.name); });
  return { names: names.length, skinned, hasArm: names.includes('upper_arm.L') };
});
check('project reload restores the rig', loaded.hasArm && loaded.skinned.includes('Mannequin'), loaded);

const play = await page.evaluate(async () => {
  let mesh = null;
  window.__meshforge.model.traverse((o) => { if (!mesh && o.isSkinnedMesh && o.name === 'Mannequin') mesh = o; });
  const start = mesh.position.clone();
  let bone = null;
  mesh.traverse((o) => { if (!bone && o.isBone && o.name === 'upper_arm.L') bone = o; });
  const ang = (q, rest) => {
    const d = Math.abs(q.x * rest[0] + q.y * rest[1] + q.z * rest[2] + q.w * rest[3]);
    return 2 * Math.acos(Math.min(1, d));
  };
  const before = bone ? [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w] : [0, 0, 0, 1];
  const rest = bone?.userData?.restQuaternion || before;
  window.MeshForge.setBehaviours(mesh.userData.sceneId || mesh.name, [{ type: 'character', enabled: true, params: { speed: 4.5, jump: 6, camera: 'follow' } }]);
  window.MeshForge.armature.enter('object');
  window.__meshforge.editor.setMode('object');
  const started = window.MeshForge.game.startPlay();
  window.MeshForge.game.setMoveInput({ x: 0, z: 1 });
  await new Promise((r) => setTimeout(r, 450));
  const moved = mesh.position.distanceTo(start);
  const angle = bone ? ang(bone.quaternion, rest) : 0;
  const pad = getComputedStyle(document.getElementById('movePad')).display;
  window.MeshForge.game.stopPlay();
  const back = mesh.position.distanceTo(start);
  const restored = bone ? ang(bone.quaternion, before) : 0;
  return { started, moved, angle, pad, back, restored };
});
check('character moves while Play is running and Stop restores it', play.started && play.moved > 0.2 && play.back < 0.05, play);
check('humanoid bones swing while moving', play.angle > 0.05 && play.restored < 0.05, play);
check('on-screen move control is visible during Play', play.pad !== 'none', play);
await page.evaluate(() => window.MeshForge.game.startPlay());
await page.screenshot({ path: `${outDir}/character_move_pad.png` });
await page.evaluate(() => window.MeshForge.game.stopPlay());

const content = await page.evaluate(async () => {
  window.MeshForge.content.setTab('content');
  const made = window.MeshForge.content.createFolder('Props');
  let mesh = null;
  window.__meshforge.model.traverse((o) => { if (!mesh && o.isMesh && o.name === 'Cube') mesh = o; });
  window.__meshforge.editor.select(mesh);
  const prefab = window.MeshForge.content.saveSelection('BoxPrefab', 'Props');
  const before = window.MeshForge.getObjects().length;
  await window.MeshForge.content.place(prefab.id);
  const after = window.MeshForge.getObjects().length;
  const level = window.MeshForge.content.saveLevel('Yard');
  window.MeshForge.addItem('torus');
  const withTorus = window.__meshforge.editor.debug.meshes().some((o) => o.name === 'Torus');
  await window.MeshForge.content.place(level.id);
  const torusGone = !window.__meshforge.editor.debug.meshes().some((o) => o.name === 'Torus');
  const text = window.MeshForge.project.serializeText();
  window.MeshForge.content.minimise(true);
  const collapsed = window.MeshForge.content.isCollapsed() && localStorage.getItem('mf_dock_collapsed') === '1';
  window.MeshForge.content.minimise(false);
  return { made, folders: window.MeshForge.content.folders(), before, after, withTorus, torusGone, inProject: text.includes('Props'), collapsed, tab: localStorage.getItem('mf_dock_tab') };
});
check('content browser stores a folder, a prefab and a level', content.made && content.after > content.before && content.withTorus && content.torusGone && content.inProject && content.collapsed && content.tab === 'content', content);
await page.evaluate(() => window.MeshForge.content.setTab('content'));
await page.screenshot({ path: `${outDir}/content_browser.png` });

const google = await page.evaluate(async () => {
  const origin = await window.MeshForge.auth.describeGoogleFailure('unregistered_origin');
  const missing = await window.MeshForge.auth.describeGoogleFailure('no_client_id');
  document.getElementById('btnOpenAIConsole')?.click();
  document.getElementById('aiSettingsBtn')?.click();
  document.getElementById('btnGoogleCheck')?.click();
  await new Promise((r) => setTimeout(r, 200));
  const diag = document.getElementById('googleDiag').textContent;
  let threw = '';
  try { await window.MeshForge.auth.loginGoogle(); } catch (err) { threw = err.message; }
  return { origin, missing, diag, threw, stillGuest: window.MeshForge.auth.getUser().name };
});
check('Google diagnostics name the failed step and the exact origin', /Authorised JavaScript origins/.test(google.origin) && /Web application/.test(google.origin) && locationInfo(google), google);
check('missing client ID does not invent a user', /client ID/i.test(google.threw) && google.stillGuest === 'Guest Creator', google.stillGuest);
check('in-app check reports the backend', /server/i.test(google.diag), google.diag.slice(0, 180));
await page.screenshot({ path: `${outDir}/google_diagnostics.png` });

function locationInfo(g) { return g.origin.includes('127.0.0.1') || g.origin.includes('localhost'); }

if (pageErrors.length) { report.ok = false; console.log('page errors', pageErrors.slice(0, 8)); }
console.log(report.ok ? 'ALL PASS' : 'FAILED');
await browser.close();
process.exit(report.ok ? 0 : 1);
