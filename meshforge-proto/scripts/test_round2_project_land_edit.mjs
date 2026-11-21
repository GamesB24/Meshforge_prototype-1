// Round 2: project round-trip, landscape level, outliner, edit selection, agent level.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

function loadPuppeteer() {
  const pkg = process.env.PUPPETEER_PKG || '/tmp/mf-test/package.json';
  if (!existsSync(pkg)) throw new Error('puppeteer-core missing');
  return createRequire(pkg)('puppeteer-core');
}
const puppeteer = loadPuppeteer();
const base = process.argv[2] || 'http://127.0.0.1:8765/frontend/index.html';
const outDir = process.env.SHOTS || '/opt/cursor/artifacts';
await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.setViewport({ width: 1400, height: 900 });
const report = { ok: true, checks: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (!pass) report.ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}
const url = new URL(base); url.searchParams.set('noautosave', '1');
await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.MeshForge?.project && window.MeshForgeLandscape, { timeout: 30000 });

const outliner = await page.evaluate(() => {
  window.MeshForge.loadSample('kiosk');
  window.MeshForge.loadSample('kiosk');
  const rows = [...document.querySelectorAll('#olist li .lbl')].map((n) => n.textContent);
  const counts = {};
  for (const n of rows) counts[n] = (counts[n] || 0) + 1;
  return { rows, counts, dupes: Object.entries(counts).filter(([, n]) => n > 1).map(([n]) => n) };
});
check('sample load twice does not duplicate outliner names', outliner.dupes.length === 0 && outliner.rows.includes('Player') && outliner.rows.includes('Kiosk sample'), outliner);

const edit = await page.evaluate(async () => {
  window.MeshForge.addPlane(2, 2, 4, 4);
  await window.MeshForge.setMode('edit');
  const E = window.__meshforge.editor.debug.E;
  let edge = -1, best = 0;
  for (let e = 0; e < E.ne; e++) {
    const a = E.edges[e * 2], b = E.edges[e * 2 + 1];
    const dx = Math.abs(E.U[a * 3] - E.U[b * 3]);
    const dy = Math.abs(E.U[a * 3 + 1] - E.U[b * 3 + 1]);
    const dz = Math.abs(E.U[a * 3 + 2] - E.U[b * 3 + 2]);
    if (dx > best && dy < 1e-4 && dz < 1e-4) { best = dx; edge = e; }
  }
  E.selE.fill(0); E.selE[edge] = 1;
  const loop = window.__meshforge.editor.runStoredLoop('loop');
  const one = [];
  for (let t = 0; t < E.nt; t++) if (E.tris[t * 3] === E.edges[edge * 2] || E.tris[t * 3 + 1] === E.edges[edge * 2] || E.tris[t * 3 + 2] === E.edges[edge * 2]) one.push(t);
  window.__meshforge.editor.setSelMode('face');
  E.selF.fill(0); E.selF[0] = 1;
  window.__meshforge.editor.selectLinked();
  let linked = 0; for (let t = 0; t < E.nt; t++) if (E.selF[t]) linked++;
  const setId = window.__meshforge.editor.createFaceSet('All');
  E.selF.fill(0);
  const n = window.__meshforge.editor.selectFaceSet(setId);
  return { edge, loop: loop.length, nt: E.nt, linked, setId, reselected: n };
});
check('edge loop walks more than one edge on a grid', edit.loop > 2, edit);
check('linked select covers the whole grid', edit.linked === edit.nt, edit);
check('face set selects those faces again', edit.reselected === edit.nt && edit.setId > 0, edit);
await page.screenshot({ path: `${outDir}/edit_mode_edge_loop.png` });

const land = await page.evaluate(() => {
  const L = window.MeshForgeLandscape;
  L.state.params.width = 40;
  L.state.params.depth = 12;
  L.rebuild();
  const bb = L.terrain.geometry.boundingBox;
  L.addSpawner({ kind: 'tree', name: 'Trees', count: 6, paints: ['grass', 'sand'], maxSlope: 80, scaleMin: 0.8, scaleMax: 1.2 });
  const sent = window.MeshForge.useAsLevel();
  const names = [];
  window.MeshForge.model.traverse((o) => { if (o.name) names.push(o.name); });
  const rows = [...document.querySelectorAll('#olist li .lbl')].map((n) => n.textContent);
  return {
    width: +(bb.max.x - bb.min.x).toFixed(2),
    depth: +(bb.max.z - bb.min.z).toFixed(2),
    sent: sent?.children?.length,
    hasTerrain: names.includes('Terrain'),
    trees: names.filter((n) => n.startsWith('Tree_')).length,
    rows,
    terrainRows: rows.filter((n) => n === 'Terrain').length,
    landscapeRows: rows.filter((n) => n === 'Landscape').length,
  };
});
check('landscape width and depth are independent', Math.abs(land.width - 40) < 0.2 && Math.abs(land.depth - 12) < 0.2, land);
check('level ground is one Landscape group in the scene', land.hasTerrain && land.trees >= 1 && land.terrainRows === 1 && land.landscapeRows === 1, land);
await page.screenshot({ path: `${outDir}/landscape_in_main_scene.png` });

const roundtrip = await page.evaluate(async () => {
  const ed = window.__meshforge.editor;
  const grid = ed.debug.meshes().find((o) => o.name === 'Grid');
  const x0 = grid.geometry.attributes.position.getX(0);
  grid.geometry.attributes.position.setX(0, x0 + 3);
  grid.userData.behaviours = [{ type: 'spin', enabled: true, params: { axis: 'y', speed: 12 } }];
  window.MeshForge.anim.setFrame(0);
  window.MeshForge.anim.insertKeyframe(grid, 'loc');
  const text = window.MeshForge.project.serializeText();
  await window.MeshForge.project.loadText(text);
  const back = window.__meshforge.editor.debug.meshes().find((o) => o.name === 'Grid');
  const keys = window.MeshForge.anim.exportKeys();
  return {
    x: back?.geometry.attributes.position.getX(0),
    expect: x0 + 3,
    behaviour: back?.userData.behaviours?.[0]?.type,
    keyed: keys.keys.some((k) => k.name === 'Grid'),
    terrain: !!window.__meshforge.editor.debug.meshes().find((o) => o.name === 'Terrain'),
  };
});
check('project file restores geometry, behaviour, keys and terrain', Math.abs(roundtrip.x - roundtrip.expect) < 1e-3 && roundtrip.behaviour === 'spin' && roundtrip.keyed && roundtrip.terrain, roundtrip);

await page.evaluate(() => window.MeshForge.project.writeAutosave());
const page2 = await browser.newPage();
page2.on('pageerror', (e) => errors.push('p2 ' + e));
await page2.goto(base, { waitUntil: 'domcontentloaded' });
await page2.waitForFunction(() => window.__meshforge?.editor?.debug?.meshes?.().some((o) => o.name === 'Grid'), { timeout: 15000 }).catch(() => null);
const restored = await page2.evaluate(() => window.__meshforge?.editor?.debug?.meshes?.().some((o) => o.name === 'Grid') || false);
check('autosave restores on reopen', restored === true, { restored });
await page2.close();

const agent = await page.evaluate(async () => window.MeshForge.agent.executeTool('build_level', { width: 20, depth: 20, trees: 3, seed: 4 }));
check('agent builds a level in the open scene', agent.ok && (agent.children || []).includes('Terrain'), agent);

if (errors.length) { report.ok = false; console.log('page errors', errors); }
console.log(report.ok ? 'ALL PASS' : 'FAILED');
await browser.close();
process.exit(report.ok ? 0 : 1);
