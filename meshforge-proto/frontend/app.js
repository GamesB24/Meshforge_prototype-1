// MeshForge front-end: original three.js (MIT) implementation. DCC-style layout and navigation conventions only.
import { createUVEditor } from './uvedit.js';
import { createRig, glbHasSkins } from './rig.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { createEditor, makeZip, readStoredZip } from './editor.js';
import { initLandscape } from './landui.js';
import { createSculpt } from './sculpt.js';
import { createSceneIO, bakeObject } from './scene.js';
import { createMaterials } from './materials.js';
import { CHIBILI } from './chibili.js';
import { copyData } from './mfdata.js';
import { undoAdded, redoAdded } from './historyguard.js';
import { groupNodes, ungroupNode, joinMeshes, similarMeshes } from './sceneactions.js';
import { createRecover } from './recover.js';
import { readDropId, assetById, objectFromAsset, importFile, mountBrowser } from './content.js';
import { initPlugins } from './plugins.js';

const $ = (id) => document.getElementById(id);
const state = { file: null, runner: 'local', shading: 'solid', wireOverlay: false, current: null, config: null };

// ---------- scene / cameras ----------
const canvas = $('c'), vp = canvas.parentElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio); renderer.setClearColor(0x3a3a3a);
const scene = new THREE.Scene();
const persp = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
let camera = persp; persp.position.set(2.2, 1.4, 2.6);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
// MMB orbit, Shift+MMB pan (OrbitControls switches rotate->pan while Shift is held), wheel zoom.
// Select/Move/Rotate/Scale tools keep LMB for picking and the gizmo; the navigation tools put orbit/pan/zoom on LMB.
const setLeft = (t) => controls.mouseButtons = { LEFT: { orbit: THREE.MOUSE.ROTATE, pan: THREE.MOUSE.PAN, zoom: THREE.MOUSE.DOLLY }[t] ?? null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
setLeft('select');

scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 4); scene.add(key);
const fill = new THREE.DirectionalLight(0xbfd0ff, 0.7); fill.position.set(-4, 2, -3); scene.add(fill);
const grid = new THREE.GridHelper(10, 50, 0x555555, 0x474747); scene.add(grid);
const axX = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-5, 0.001, 0), new THREE.Vector3(5, 0.001, 0)]), new THREE.LineBasicMaterial({ color: 0xc04848 }));
const axZ = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.001, -5), new THREE.Vector3(0, 0.001, 5)]), new THREE.LineBasicMaterial({ color: 0x6a9c3a }));
scene.add(axX, axZ);
let model = null;
let recover = null;
let editor = null;
let sculpt = null; // Sculpt mode (v5)
let curTool = 'select';
let land = null;   // Landscape workspace (v4) // created below, once the scene exists

// Procedural matcap (original, generated at runtime - no third-party matcap images).
function makeMatcap() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const grd = g.createRadialGradient(90, 80, 10, 128, 128, 140);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, '#d8d2c8'); grd.addColorStop(0.7, '#7d776f'); grd.addColorStop(1, '#2a2826');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const MAT = {
  solid: new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }),
  matcap: new THREE.MeshMatcapMaterial({ matcap: makeMatcap(), side: THREE.DoubleSide }),
  wire: new THREE.MeshBasicMaterial({ color: 0x111111, wireframe: true }),
  overlay: new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true, transparent: true, opacity: 0.25, depthTest: true, polygonOffset: true }),
};
// push shaded surfaces back slightly so Edit Mode edges/points draw cleanly on top
let mats = null; // v7 material system
const offsetMat = (m) => { if (m && !m.wireframe) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; } };
[MAT.solid, MAT.matcap].forEach(offsetMat);

function resize() {
  const w = canvas.clientWidth || vp.clientWidth, h = canvas.clientHeight || vp.clientHeight;
  renderer.setSize(w, h, false); persp.aspect = w / h; persp.updateProjectionMatrix();
  const s = camera === ortho ? ortho.top : 1.2; setOrthoSize(s);
}
function setOrthoSize(s) { const a = (canvas.clientWidth || vp.clientWidth) / (canvas.clientHeight || vp.clientHeight); ortho.top = s; ortho.bottom = -s; ortho.left = -s * a; ortho.right = s * a; ortho.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------- view gizmo ----------
const gz = $('gizmo'), gctx = gz.getContext('2d');
const AXES = [['X', new THREE.Vector3(1, 0, 0), '#e05050'], ['Y', new THREE.Vector3(0, 1, 0), '#7ec34a'], ['Z', new THREE.Vector3(0, 0, 1), '#4f86e0']];
let gizmoHits = [];
function drawGizmo() {
  gctx.clearRect(0, 0, 96, 96); gctx.fillStyle = '#ffffff10'; gctx.beginPath(); gctx.arc(48, 48, 46, 0, 7); gctx.fill();
  const q = camera.quaternion.clone().invert(); gizmoHits = [];
  const pts = [];
  for (const [n, v, col] of AXES) for (const sgn of [1, -1]) {
    const p = v.clone().multiplyScalar(sgn).applyQuaternion(q);
    pts.push({ n: sgn > 0 ? n : '-' + n, x: 48 + p.x * 34, y: 48 - p.y * 34, z: p.z, col, pos: sgn > 0, dir: v.clone().multiplyScalar(sgn) });
  }
  pts.sort((a, b) => a.z - b.z);
  for (const p of pts) {
    if (p.pos) { gctx.strokeStyle = p.col; gctx.lineWidth = 2; gctx.beginPath(); gctx.moveTo(48, 48); gctx.lineTo(p.x, p.y); gctx.stroke(); }
    gctx.fillStyle = p.pos ? p.col : p.col + '88'; gctx.beginPath(); gctx.arc(p.x, p.y, p.pos ? 9 : 7, 0, 7); gctx.fill();
    if (p.pos) { gctx.fillStyle = '#111'; gctx.font = 'bold 10px sans-serif'; gctx.textAlign = 'center'; gctx.fillText(p.n, p.x, p.y + 3.5); }
    gizmoHits.push(p);
  }
}
gz.onclick = (e) => {
  const r = gz.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const hit = gizmoHits.slice().reverse().find((p) => Math.hypot(p.x - x, p.y - y) < 10);
  if (hit) snapView(hit.dir, hit.n);
};

// ---------- view helpers ----------
const VIEW_NAMES = { 'Z': 'Front', '-Z': 'Back', 'X': 'Right', '-X': 'Left', 'Y': 'Top', '-Y': 'Bottom' };
function snapView(dir, name) {
  const d = camera.position.distanceTo(controls.target);
  camera.position.copy(controls.target).addScaledVector(dir, d);
  camera.up.set(0, 1, 0); if (Math.abs(dir.y) > 0.99) camera.up.set(0, 0, -dir.y);
  camera.lookAt(controls.target); controls.update(); camera.up.set(0, 1, 0);
  viewLabel = `${VIEW_NAMES[name] || 'User'} ${camera === ortho ? 'Orthographic' : 'Perspective'}`; updateInfo();
}
function toggleOrtho() {
  const pos = camera.position.clone(), tgt = controls.target.clone();
  camera = camera === persp ? ortho : persp; camera.position.copy(pos); camera.lookAt(tgt);
  if (camera === ortho) setOrthoSize(pos.distanceTo(tgt) * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)));
  controls.object = camera; controls.update();
  $('perspBtn').textContent = camera === ortho ? 'Ortho' : 'Persp';
  viewLabel = viewLabel.replace(/Perspective|Orthographic/, camera === ortho ? 'Orthographic' : 'Perspective'); updateInfo();
}
function frameModel() {
  if (land?.active) return land.frame();
  if (!model) return;
  const s = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(s.center); camera.position.copy(s.center).addScaledVector(dir, s.radius * 3.6);
  if (camera === ortho) setOrthoSize(s.radius * 1.3); controls.update();
}
let viewLabel = 'User Perspective';
function updateInfo() {
  refreshOutliner?.();
  if (land?.active) return;
  let tris = 0; model?.traverse((o) => { if (o.isMesh && !o.userData.isOverlay) tris += Math.min(o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count, o.geometry.drawRange.count) / 3; });
  const objs = model ? model.children.filter((o) => o.isMesh || o.children.length).length || 1 : 0;
  if (model?.userData.isScene) model.children.forEach((o) => { // Sculpt drops vertex colours: fall back to the object's average colour
    const m = o.userData.orig || o.material; if (!o.isMesh || !m || o.geometry.attributes.color || !m.vertexColors) return;
    m.vertexColors = false; if (o.userData.avgColor != null && m.color) m.color.setHex(o.userData.avgColor); m.needsUpdate = true; });
  const extra = editor?.infoLine(); $('vinfo').innerHTML = `${viewLabel}<br><small>${model ? `(${objs}) object${objs > 1 ? 's' : ''} · ${Math.round(tris).toLocaleString()} tris` : 'No object'}</small>${extra ? `<br><small class="sel">${extra}</small>` : ''}`;
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (sculpt?.active && sculpt.handleKey(e)) return;
  if (!land?.active && editor.mode === 'object' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); e.shiftKey ? unhideAll() : hideSelected(); return; }
    if (e.key === 'Delete') { if (editor.sel) { e.preventDefault(); deleteObject(); return; } }
    if (e.shiftKey && (e.key === 'D' || e.key === 'd')) { if (editor.sel) { e.preventDefault(); duplicateObject(); return; } }
  }
  if (editor.handleKey(e)) return;
  if (e.ctrlKey || e.metaKey) return;
  const opp = e.ctrlKey ? -1 : 1;
  const map = { Numpad1: ['Z', 0, 0, 1], Numpad3: ['X', 1, 0, 0], Numpad7: ['Y', 0, 1, 0] };
  const k = map[e.code] || map[{ Digit1: 'Numpad1', Digit3: 'Numpad3', Digit7: 'Numpad7' }[e.code]];
  if (k) { e.preventDefault(); snapView(new THREE.Vector3(k[1], k[2], k[3]).multiplyScalar(opp), (opp < 0 ? '-' : '') + k[0]); }
  else if (e.code === 'Numpad5' || e.code === 'Digit5') toggleOrtho();
  else if (e.code === 'NumpadDecimal' || e.key === '.' || e.key === 'Home') frameModel();
  else if (e.key === 'z' || e.key === 'Z') setShading(state.shading === 'wire' ? 'solid' : 'wire');
});

// ---------- shading ----------
function applyShading() {
  if (!model) return;
  model.traverse((o) => {
    if (!o.isMesh || o.userData.isOverlay) return;
    o.userData.orig ??= o.material;
    if (state.shading === 'chibili' && mats) mats.apply(o, true);
    else { mats?.apply(o, false); o.material = state.shading === 'color' ? o.userData.orig : MAT[state.shading]; }
    let ov = o.children.find((c) => c.userData.isWireOverlay);
    if (!ov) { ov = new THREE.Mesh(o.geometry, MAT.overlay); ov.userData.isOverlay = ov.userData.isWireOverlay = true; ov.raycast = () => {}; o.add(ov); }
    ov.visible = state.wireOverlay && state.shading !== 'wire';
  });
}
function applyLandShading() { // v7: Chibili look in the Landscape workspace (terrain keeps its painted colours)
  const g = land?.group || land?.result?.group; if (!g) return;
  g.traverse((o) => { if (!o.isMesh || o.userData.isOverlay) return; o.userData.landOrig ??= o.material;
    if (state.shading !== 'chibili') { o.material = o.userData.landOrig; mats?.apply(o, false); return; }
    if (!o.userData.mf) o.userData.mf = { slots: [o.name === 'Water' ? 'water' : (o.isInstancedMesh ? 'tangerine' : '__auto')], active: 0, albedo: 'material', vcol: false };
    if (o.isInstancedMesh) { o.material = o.userData.landOrig; return; } mats.apply(o, true); });
}
function setShading(v) { state.shading = v; document.body.classList.toggle('chibili', v === 'chibili'); renderer.setClearColor(v === 'chibili' ? 0x8fb8d8 : 0x3a3a3a); applyLandShading(); document.querySelectorAll('#shading button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); applyShading(); }
document.querySelectorAll('#shading button').forEach((b) => b.onclick = () => setShading(b.dataset.v));
$('ovWire').onchange = (e) => { state.wireOverlay = e.target.checked; applyShading(); };
$('ovGrid').onchange = (e) => { grid.visible = axX.visible = axZ.visible = e.target.checked; };
$('perspBtn').onclick = toggleOrtho; $('frame').onclick = frameModel;
function setTool(t) { curTool = t; document.querySelectorAll('.tool[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === t)); setLeft(t); editor.setTool(t); }
document.querySelectorAll('.tool[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));

editor = createEditor({
  scene, controls, canvas, renderer, camera: () => camera, getModel: () => (land?.active ? null : model), jobId: () => state.current, updateInfo: () => updateInfo(),
  status: (m) => { $('progMsg').textContent = m; },
  setModeUI: (m) => { $('mode').value = m; $('selModes').hidden = m !== 'edit'; },
  sculptEnter: (m) => sculpt.enter(m), sculptExit: () => sculpt.exit(), sculptGeometry: (m) => sculpt?.geometryFor(m), sculptInfo: () => sculpt?.info(),
  setSelModeUI: (m) => document.querySelectorAll('#selModes button').forEach((b) => b.classList.toggle('on', b.dataset.v === m)),
  blockPointer: (e) => (mats?.blockPointer(e) || window.__mfBlockPointer?.(e)), exportMaterial: (m, g) => mats?.exportMaterial(m, g),
  blockMode: (m, mode) => window.__mfBlockMode?.(m, mode), extendExport: (g, o) => window.__mfExtendExport?.(g, o), skipExport: (m) => window.__mfSkipExport?.(m),
  hasRig: () => !!window.__meshforge?.rig?.info?.().skinned,
  onContextMenu: (e, list) => openObjectMenu(e, list),
});
sculpt = createSculpt({
  scene, controls, canvas, renderer, camera: () => camera, status: (m) => { $('progMsg').textContent = m; }, updateInfo: () => updateInfo(),
  pushHistory: (e) => editor.pushHistory(e), undoStack: () => editor.undoStack(), clearHistory: (m) => editor.clearHistory(m),
  restoreControls: () => setLeft(curTool), newSphere: (l) => newSphere(l),
  onDyn: (on) => $('sculptron').classList.toggle('on', on),
  onTris: (n, warn, act) => { const el = $('triCount'); el.hidden = !act; el.textContent = `${n.toLocaleString()} tris`; el.classList.toggle('warn', warn); updateInfo(); },
});
// v5: built-in sculpt base. Icosphere (non-indexed in three.js) - Sculpt mode welds it.
const SPHERE_DETAIL = { 2: 31, 3: 63, 4: 126 };
function newSphere(level = 2, detail) {
  if (land?.active) setWorkspace('gen');
  editor.leaveModes();
  const geo = new THREE.IcosahedronGeometry(0.7, detail ?? SPHERE_DETAIL[level] ?? 31); geo.translate(0, 0.7, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.6, side: THREE.DoubleSide }); offsetMat(mat);
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'Sphere';
  const root = ensureScene(true);
  addUndoable(root, mesh, { id: 'sphere', label: 'Sphere', source: 'primitive' }, 'Add sphere');
  applyShading(); frameModel(); updateInfo(); $('drop').classList.add('hidden');
  document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
  editor.select(mesh); return editor.setMode('sculpt');
}
$('sculptron').onclick = async () => {
  if (!sculpt.active) { if (!model || land?.active) await newSphere(2); else await editor.setMode('sculpt'); if (!sculpt.active) return; sculpt.setDyn(true); return; }
  sculpt.setDyn(!sculpt.opt.dyn);
};
land = initLandscape({ scene, controls, renderer, camera: () => camera, setOrthoSize,
  decorateExport: (g) => g.traverse((o) => { if (!o.isMesh) return; const id = o.name === 'Water' ? 'water' : o.name === 'Buildings' ? 'tangerine' : null; const d = id && mats?.byId(id);
    if (d) { o.material.name = d.name; o.material.color.set(d.kind === 'water' ? d.color : d.color); o.material.userData = { chibili: { ...d } }; } else if (o.name === 'Terrain') o.material.name = 'Terrain (vertex colours)'; }),
  objBundle: async (g, base) => { const { writeOBJBundle } = await import('./objmtl.js'); const { makeZip } = await import('./editor.js'); const b = await writeOBJBundle(g, base);
    return makeZip([{ name: base + '.obj', data: new TextEncoder().encode(b.obj) }, { name: base + '.mtl', data: new TextEncoder().encode(b.mtl) }, ...b.images]); }, status: (m) => { $('progMsg').textContent = m; }, setInfo: (h) => { $('vinfo').innerHTML = h; } });
let curWS = 'gen';
function setWorkspace(w) {
  const prev = curWS; if (w === prev) return; curWS = w; dispatchEvent(new CustomEvent('meshforge-workspace-change', {detail:w}));
  ['gen', 'land', 'shader', 'uv'].forEach((k) => { $({ gen: 'tabGen', land: 'tabLand', shader: 'tabShader', uv: 'tabUV' }[k])?.classList.toggle('on', k === w); document.body.classList.toggle('ws-' + k, k === w); });
  const on = w === 'land';
  if (on !== land.active) {
    if (on) { editor.leaveModes(); setTool('select'); land.enter(); } else land.exit();
    if (model) model.visible = !on; grid.visible = axX.visible = axZ.visible = !on && $('ovGrid').checked;
    $('drop').classList.toggle('hidden', on || !!model);
  }
  if (prev === 'uv' && w !== 'uv') window.__mfUV?.show(false);
  mats?.show(w === 'shader' || w === 'uv'); if (w === 'uv') mats?.showLibrary(false);
  if (w === 'shader' || w === 'uv') { if (state.shading !== 'chibili') { state.prevShading = state.shading; setShading('chibili'); } }
  else if (prev === 'shader' || prev === 'uv') { if (state.prevShading) setShading(state.prevShading); state.prevShading = null; }
  if (w === 'uv') window.__mfUV?.show(true);
  if (on && state.shading === 'chibili') applyLandShading();
  if (!on) updateInfo(); requestAnimationFrame(resize);
}
$('tabLand').onclick = () => setWorkspace('land'); $('tabGen').onclick = () => setWorkspace('gen');
$('tabShader').onclick = () => setWorkspace('shader'); $('tabUV').onclick = () => setWorkspace('uv');
window.MeshForgeLandscape = Object.assign(land, { setWorkspace });
renderer.setAnimationLoop(() => { editor.tick(); sculpt.tick(); if (land?.active && state.shading === 'chibili') applyLandShading(); mats?.tick(); window.__mfTick?.(); controls.update(); renderer.render(scene, camera); drawGizmo(); });

function loadGLB(url, onDone, onError, opts = {}) {
  new GLTFLoader().load(url, (g) => {
    try {
      editor.leaveModes();
      let rigged = false; g.scene.traverse((o) => { if (o.isSkinnedMesh) rigged = true; });
      const node = rigged ? g.scene : bakeObject(g.scene, opts.name || g.scene.name || 'Generated');
      if (!node) throw new Error('File has no mesh');
      if (rigged && opts.name) node.name = opts.name;
      node.animations = g.animations || [];
      node.traverse((o) => { if (o.isMesh && o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => { offsetMat(m); m.side = THREE.DoubleSide; if (m.map) m.vertexColors = false; else m.vertexColors = !!o.geometry.attributes.color; }); if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); } });
      const root = ensureScene(true);
      fitNewcomer(node, root);
      addUndoable(root, node, { id: opts.id || 'generated', label: node.name || 'Generated', source: opts.source || 'generated' }, opts.label || 'Add generated mesh');
      node.visible = !land?.active;
      applyShading(); if (!opts.quietFrame) frameModel(); updateInfo();
      $('drop').classList.add('hidden'); window.__mfAfterGLB?.(node);
      document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
      onDone?.(node);
    } catch (err) { console.error('GLB load failed', err); onError?.(err); }
  }, undefined, (e) => { console.error('GLB load failed', e); onError?.(e instanceof Error ? e : new Error(String(e?.message || e))); });
}

// ---------- config ----------
async function loadConfig() {
  let cfg;
  try { const r = await fetch('/api/config'); if (!r.ok) throw new Error('HTTP ' + r.status); cfg = await r.json(); }
  catch (e) { state.offline = true; $('device').textContent = 'Offline: no backend'; $('engine').innerHTML = '<option disabled>Backend not running</option>'; $('go').disabled = true; $('go').title = 'Generation needs the MeshForge server (run_windows.bat)';
    $('runnerHint').textContent = 'No backend found: image-to-3D generation is off. Viewer, sculpt, materials and UV tools still work.'; $('runnerHint').className = 'hint warn';
    $('progMsg').textContent = 'Offline mode: no backend at /api/config, so generation is disabled. Everything else works.'; return; }
  state.config = cfg;
  $('engine').innerHTML = cfg.engines.map((e) => `<option value="${e.id}" ${e.available ? '' : 'disabled'}>${e.name}${e.available ? '' : ' (soon)'}</option>`).join('');
  $('device').textContent = `Local: ${cfg.runners.find((r) => r.id === 'local').device}`;
  updateRunnerHint();
}
function updateRunnerHint() {
  const r = state.config?.runners.find((x) => x.id === state.runner); if (!r) return;
  const h = $('runnerHint'); h.className = 'hint';
  if (r.id === 'local') h.textContent = r.device;
  else { h.textContent = `Adapter: ${r.adapter}${r.adapter === 'mock' ? ' (demo mesh, no GPU)' : ''}${r.untested ? ' · untested' : ''}${r.ready ? '' : ' · ' + r.hint}`; h.className = 'hint warn'; }
}

// ---------- inputs ----------
function setFile(f) {
  if (!f || !f.type.startsWith('image/')) return;
  state.file = f; $('preview').src = URL.createObjectURL(f); $('preview').hidden = false; $('fname').textContent = f.name; $('go').disabled = !!state.offline;
}
$('file').onchange = (e) => setFile(e.target.files[0]);
$('upload2').onclick = () => $('file').click();
['dragenter', 'dragover'].forEach((ev) => vp.addEventListener(ev, (e) => { e.preventDefault(); vp.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => vp.addEventListener(ev, (e) => { e.preventDefault(); vp.classList.remove('over'); }));
vp.addEventListener('drop', async (e) => {
  const droppedId = readDropId(e.dataTransfer);
  if (droppedId && assetById(droppedId)) { await placeAsset(assetById(droppedId)); return; }
  const f = e.dataTransfer.files?.[0];
  if (f && /\.(glb|gltf|obj)$/i.test(f.name)) {
    try { await recover?.write('before-import'); } catch { /* continue */ }
    if (/\.gl(b|tf)$/i.test(f.name) && glbHasSkins(await f.arrayBuffer())) { await window.MeshForge.loadRig(f); return; }
    const asset = await importFile(f);
    await placeAsset(asset);
    return;
  }
  setFile(f);
});
$('runner').querySelectorAll('button').forEach((b) => b.onclick = () => {
  $('runner').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); state.runner = b.dataset.v; updateRunnerHint();
});
const fmtK = (n) => n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
const bind = (id, f) => { const el = $(id); el.oninput = () => $(id + 'V').textContent = f(+el.value); };
bind('res', (v) => v); if ($('inres')) bind('inres', (v) => v); bind('tf', fmtK); bind('sa', (v) => v + '°'); bind('sm', (v) => v.toFixed(2));

// ---------- jobs ----------
$('go').onclick = async () => {
  try { await recover?.write('before-generate'); } catch { /* generation still runs */ }
  const fd = new FormData();
  fd.append('image', state.file); fd.append('engine', $('engine').value); fd.append('runner', state.runner); fd.append('remove_bg', $('rembg').checked);
  fd.append('params', JSON.stringify({ resolution: +$('res').value, input_size: +($('inres')?.value || 1024), remesh: $('remesh').value, target_faces: +$('tf').value,
    sharp_angle: +$('sa').value, smooth_strength: +$('sm').value, split_components: $('split').checked }));
  $('go').disabled = true;
  const r = await fetch('/api/jobs', { method: 'POST', body: fd });
  if (!r.ok) { $('progMsg').textContent = (await r.json()).detail; $('go').disabled = false; return; }
  track((await r.json()).id);
};
async function track(id) {
  for (;;) {
    const j = await (await fetch(`/api/jobs/${id}`)).json();
    $('barFill').style.width = `${Math.round(j.progress * 100)}%`;
    $('progMsg').textContent = `${Math.round(j.progress * 100)}% · ${j.message}`;
    if (j.status === 'done' || j.status === 'error') {
      $('go').disabled = !state.file; refreshHistory();
      if (j.status === 'done') show(j); else $('progMsg').textContent = `Failed: ${j.error}`;
      return;
    }
    await new Promise((res) => setTimeout(res, 700));
  }
}
function show(j) {
  state.current = j.id; loadGLB(`/api/jobs/${j.id}/mesh.glb?t=${j.created}`);
  $('srvGlb').href = `/api/jobs/${j.id}/mesh.glb`; $('srvObj').href = `/api/jobs/${j.id}/mesh.obj`;
  $('srvGlb').classList.remove('disabled'); $('srvObj').classList.remove('disabled');
  $('rawGlb').href = `/api/jobs/${j.id}/raw.glb`; $('rawGlb').classList.toggle('disabled', !j.stats?.raw);
  $('rawGlb').title = j.stats?.raw ? 'Unprocessed TripoSR output' : 'Not kept for this job (generated before v3)';
  document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
  const s = j.stats;
  $('stats').textContent = `${s.quads ? fmtK(s.quads) + ' quads' : fmtK(s.faces) + ' tris'} · ${s.sharp_edges ?? 0} hard edges · ${s.parts.length} object(s) · ${j.seconds}s · ${j.runner}`;
  document.querySelectorAll('#history li').forEach((li) => li.classList.toggle('sel', li.dataset.id === j.id));
}
async function refreshHistory() {
  let list = []; try { const r = await fetch('/api/jobs'); if (r.ok) list = await r.json(); } catch { /* offline */ }
  if (!Array.isArray(list)) list = [];
  $('history').innerHTML = list.map((j) => `
    <li data-id="${j.id}" class="${j.id === state.current ? 'sel' : ''}"><img src="/api/jobs/${j.id}/input" alt="">
      <div class="meta"><b>${j.engine} · ${j.runner}</b><span class="st-${j.status}">${j.status}</span> · ${new Date(j.created * 1000).toLocaleTimeString()}</div>
      <button class="del" title="Delete">×</button></li>`).join('') || '<li style="cursor:default">No generations yet</li>';
  $('history').querySelectorAll('li[data-id]').forEach((li) => {
    const j = list.find((x) => x.id === li.dataset.id);
    li.onclick = () => j.status === 'done' && show(j);
    li.querySelector('.del').onclick = async (e) => { e.stopPropagation(); await fetch(`/api/jobs/${j.id}`, { method: 'DELETE' }); refreshHistory(); };
  });
}
loadConfig(); refreshHistory().then(async () => {
  const q = new URLSearchParams(location.search);
  if (q.get('scene')) return;
  if (!q.get('noautosave')) { try { if (await recover?.maybeRecover()) return; } catch { /* offline */ } }
  if (model) return;
  try { const list = await (await fetch('/api/jobs')).json(); const j = Array.isArray(list) && list.find((x) => x.status === 'done'); if (j && !model) show(j); } catch { /* offline */ }
});
// ---------- export buttons + menus ----------
function exportAny(fmt) { if (land?.active && land.exportAs) return land.exportAs(fmt); return editor.exportAs(fmt); }
document.querySelectorAll('[data-export]').forEach((b) => b.onclick = () => b.dataset.export === 'zip' ? editor.exportZip() : exportAny(b.dataset.export));
$('mode').onchange = (e) => editor.setMode(e.target.value);
document.querySelectorAll('#selModes button').forEach((b) => b.onclick = () => editor.setSelMode(b.dataset.v));
const ACTIONS = {
  import: () => $('file').click(), glb: () => exportAny('glb'), obj: () => exportAny('obj'), stl: () => exportAny('stl'), ply: () => exportAny('ply'),
  zip: () => editor.exportZip(), raw: () => $('rawGlb').click(), srvglb: () => $('srvGlb').click(), srvobj: () => $('srvObj').click(),
  undo: () => editor.undo(), redo: () => editor.redo(), selall: () => editor.selectAll(), edit: () => editor.setMode(editor.mode === 'edit' ? 'object' : 'edit'),
  move: () => setTool('move'), rotate: () => setTool('rotate'), scale: () => setTool('scale'),
  frame: frameModel, ortho: toggleOrtho, front: () => snapView(new THREE.Vector3(0, 0, 1), 'Z'), right: () => snapView(new THREE.Vector3(1, 0, 0), 'X'), top: () => snapView(new THREE.Vector3(0, 1, 0), 'Y'),
  land: () => setWorkspace(land.active ? 'gen' : 'land'),
  sculpt: () => editor.setMode(editor.mode === 'sculpt' ? 'object' : 'sculpt'), sph2: () => newSphere(2), sph3: () => newSphere(3), sph4: () => newSphere(4),
  skeys: () => { const h = $('sculptHelp'); h.hidden = !h.hidden; },
  keys: () => { $('help').hidden = !$('help').hidden; },
  scene: () => $('sceneFile').click(), selglb: () => editor.sel ? editor.exportAs('glb', editor.sel) : $('progMsg').textContent = 'Select an object first',
  scenejson: () => exportSceneFiles(), dup: () => duplicateObject(), del: () => deleteObject(), land2scene: () => sendLandscapeToScene(),
};
document.querySelectorAll('.menu [data-act]').forEach((b) => b.onclick = () => { document.activeElement?.blur(); ACTIONS[b.dataset.act](); });
$('help').onclick = () => { $('help').hidden = true; };
window.__meshforge = { newSphere, get sculpt() { return sculpt; }, loadGLB, show, editor, get model() { return model; }, get camera() { return camera; }, controls, setTool };

// ---------- v5.1 public integration API (additive; see docs/integration.md) ----------
// MeshForge.loadGLB(url | Blob | File | ArrayBuffer) -> Promise<THREE.Object3D>; exportGLB() -> Promise<Blob>
window.MeshForge = {
  version: '8.0',
  loadGLB(src) {
    let url = src, revoke = false;
    if (src instanceof ArrayBuffer) src = new Blob([src], { type: 'model/gltf-binary' });
    if (src instanceof Blob) { url = URL.createObjectURL(src); revoke = true; }
    if (typeof url !== 'string') return Promise.reject(new Error('loadGLB expects a URL, Blob, File or ArrayBuffer'));
    return new Promise((res, rej) => loadGLB(url, (m) => { if (revoke) URL.revokeObjectURL(url); res(m); },
      (e) => { if (revoke) URL.revokeObjectURL(url); rej(e instanceof Error ? e : new Error(String(e?.message || e))); }));
  },
  exportGLB: () => editor.encode('glb'),
  get model() { return model; },
};


// ---------- v6 scenes: many separate objects (see docs/scene-import.md) ----------
function ensureScene(append) {
  if (append && model?.userData.isScene) return model;
  if (append && model && !model.userData.isScene) {
    const root = new THREE.Group(); root.name = 'Scene'; root.userData.isScene = true; root.userData.norm = new THREE.Matrix4();
    model.updateMatrixWorld(true);
    model.children.filter((c) => !c.userData.isOverlay).forEach((c) => { c.applyMatrix4(model.matrixWorld); root.add(c); });
    scene.remove(model); model = root; scene.add(root); model.visible = !land?.active;
    return root;
  }
  if (append && !model) {
    const root = new THREE.Group(); root.name = 'Scene'; root.userData.isScene = true; root.userData.norm = new THREE.Matrix4();
    model = root; scene.add(root); model.visible = !land?.active; return root;
  }
  const root = new THREE.Group(); root.name = 'Scene'; root.userData.isScene = true; root.userData.norm = new THREE.Matrix4();
  const prev = model;
  editor.leaveModes();
  if (prev) scene.remove(prev);
  model = root; scene.add(root); model.visible = !land?.active; state.current = null; explodeK = 0; if ($('explode')) $('explode').value = 0;
  editor.clearHistory();
  if (prev) editor.pushHistory({ label: 'Open scene', undo: () => { scene.remove(root); scene.add(prev); model = prev; updateInfo(); }, redo: () => { scene.remove(prev); scene.add(root); model = root; updateInfo(); } });
  return root;
}
function fitNewcomer(node, root) {
  node.position.set(0, 0, 0); node.scale.set(1, 1, 1); node.rotation.set(0, 0, 0); node.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(node);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z, 1e-6);
  const s = 1.4 / longest;
  node.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(node);
  const c = box2.getCenter(new THREE.Vector3());
  node.position.set(-c.x, -box2.min.y, -c.z);
  const others = root.children.filter((o) => o !== node && !o.userData.isOverlay);
  if (others.length) {
    const b = new THREE.Box3(); others.forEach((o) => b.expandByObject(o));
    node.position.x += b.max.x + size.x * s * 0.2 + 0.4;
  }
}
function addUndoable(parent, node, info, label) {
  sceneIO.addObject(parent, node, info);
  const nodes = [node];
  editor.pushHistory({
    label: label || ('Add ' + node.name),
    undo: () => { if (editor.sel === node || editor.selection?.().includes(node)) editor.select(null); undoAdded(parent, nodes); updateInfo(); },
    redo: () => { redoAdded(parent, nodes); updateInfo(); },
  });
  return node;
}
const sceneIO = createSceneIO({
  getRoot: () => model, editor, status: (m) => { $('progMsg').textContent = m; }, ensureScene,
  setRoot: (root) => { editor.leaveModes(); if (model && model !== root) scene.remove(model); model = root; model.visible = !land?.active; if (!scene.children.includes(root)) scene.add(root); state.current = null; explodeK = 0; $('explode').value = 0; },
  afterLoad: (man, base) => {
    applyShading(); setShading('color'); frameModel(); updateInfo();
    $('drop').classList.add('hidden'); document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
    window.__mfAfterSceneLoad?.(man);
    const ph = man?.photo; $('photoOv').hidden = true; $('oPhoto').hidden = !ph; if (ph) $('photoOv').src = sceneIO.resolve(ph);
  },
});
function sceneObjects() {
  if (!model) return [];
  if (model.userData.isScene) return model.children.filter((o) => (o.isMesh || o.isGroup) && o.userData.sceneId && !o.userData.isOverlay);
  return model.children.filter((o) => o.isMesh && !o.userData.isOverlay);
}
function walkNodes(obj, depth, out) {
  const kids = (obj.children || []).filter((c) => (c.isMesh || c.isGroup) && !c.userData.isOverlay && !c.userData.isSelection);
  for (const c of kids) { out.push({ node: c, depth }); if (!collapsed.has(c.uuid)) walkNodes(c, depth + 1, out); }
}
var olistKey = '';
const collapsed = new Set();
function refreshOutliner() {
  const el = $('outliner'); if (!el) return;
  const roots = model?.userData.isScene && !land?.active ? sceneObjects() : [];
  el.hidden = !roots.length; if (!roots.length) { olistKey = ''; return; }
  const rows = []; roots.forEach((o) => { rows.push({ node: o, depth: 0 }); if (!collapsed.has(o.uuid)) walkNodes(o, 1, rows); });
  const selSet = new Set(editor?.selection?.() || []);
  const key = rows.map((r) => `${r.node.uuid}${r.node.visible ? 1 : 0}${selSet.has(r.node) ? 1 : 0}${collapsed.has(r.node.uuid) ? 'c' : ''}${r.depth}${r.node.name}`).join('|');
  if (key === olistKey) return; olistKey = key;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('olist').innerHTML = rows.map((r, i) => {
    const o = r.node; const kids = o.children?.some((c) => (c.isMesh || c.isGroup) && !c.userData.isOverlay);
    return `<li data-i="${i}" class="${selSet.has(o) ? 'sel' : ''} ${o.visible ? '' : 'hid'}" style="padding-left:${8 + r.depth * 14}px"><button class="twisty" ${kids ? '' : 'hidden'}>${collapsed.has(o.uuid) ? '▸' : '▾'}</button><button class="eye" title="Show / hide">${o.visible ? '👁' : '◌'}</button><span class="lbl" title="${esc(o.userData.sceneId || o.name)}">${esc(o.name || 'Object')}</span>${o.userData.source ? `<span class="badge">${esc(o.userData.source)}</span>` : ''}</li>`;
  }).join('');
  $('olist').querySelectorAll('li').forEach((li) => {
    const o = rows[+li.dataset.i].node;
    li.onclick = (e) => {
      if (e.target.classList.contains('twisty')) { if (collapsed.has(o.uuid)) collapsed.delete(o.uuid); else collapsed.add(o.uuid); olistKey = ''; updateInfo(); return; }
      if (e.target.classList.contains('eye')) { o.visible = !o.visible; if (!o.visible && editor.sel === o) editor.select(null); updateInfo(); return; }
      if (e.shiftKey) editor.select(o, { toggle: true }); else selectObject(o);
    };
    li.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); if (!editor.selection().includes(o)) editor.select(o); openObjectMenu(e, editor.selection()); };
  });
}
async function selectObject(o) {
  if (typeof o === 'string') o = sceneObjects().find((m) => m.userData.sceneId === o || m.name === o);
  if (!o) return false;
  if (editor.mode !== 'object') await editor.setMode('object');
  o.visible = true; editor.select(o); updateInfo(); return true;
}
var dupN = 0;
async function duplicateObject() {
  const src = editor.sel; if (!src || !src.parent) return null;
  if (editor.mode !== 'object') await editor.setMode('object');
  const mat = (src.userData.orig || src.material).clone();
  const c = new THREE.Mesh(copyData(src.geometry, src.geometry.clone()), mat); c.position.copy(src.position); c.quaternion.copy(src.quaternion); c.scale.copy(src.scale);
  const sz = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3()); c.position.x += Math.max(sz.x * 1.1, 0.05) / (src.parent.scale.x || 1);
  c.name = `${src.name}.${String(++dupN).padStart(3, '0')}`;
  c.userData = { sceneId: src.userData.sceneId ? `${src.userData.sceneId}_copy${dupN}` : undefined, label: c.name, source: src.userData.source, ref: src.userData.ref, avgColor: src.userData.avgColor, note: src.userData.note };
  if (src.userData.mf) { c.userData.mf = JSON.parse(JSON.stringify(src.userData.mf)); const t = mats?.texOf(src); if (t) mats.adoptTextureImage(c, t.canvas, t.name); }
  const parent = src.parent; parent.add(c); applyShading();
  editor.pushHistory({ label: 'Duplicate object', undo: () => { if (editor.sel === c) editor.select(null); undoAdded(parent, [c]); updateInfo(); }, redo: () => { redoAdded(parent, [c]); updateInfo(); } });
  editor.select(c); updateInfo(); $('progMsg').textContent = `Duplicated ${src.name} → ${c.name} · Ctrl+Z to undo`; return c;
}
async function deleteObject(o = editor.sel) {
  if (!o || !o.parent) return false;
  if (editor.mode !== 'object') await editor.setMode('object');
  const parent = o.parent; editor.select(null); 
  editor.pushHistory({ label: 'Delete object', undo: () => { redoAdded(parent, [o]); updateInfo(); }, redo: () => { if (editor.sel === o) editor.select(null); undoAdded(parent, [o]); updateInfo(); } });
  undoAdded(parent, [o]);
  updateInfo(); $('progMsg').textContent = `Deleted ${o.name} · Ctrl+Z to undo`; return true;
}
var explodeK = 0;
function setExplode(k) {
  const objs = sceneObjects(); if (!objs.length) return;
  const order = objs.slice().sort((a, b) => (a.position.z - (a.userData.exz || 0)) - (b.position.z - (b.userData.exz || 0)));
  const n = order.length;
  order.forEach((o, i) => { const want = k * (i - (n - 1) / 2) * 0.5, had = o.userData.exz || 0; o.position.z += want - had; o.userData.exz = want; o.updateMatrixWorld(true); });
  explodeK = k;
}
$('explode').oninput = (e) => setExplode(+e.target.value);
$('oDup').onclick = () => duplicateObject(); $('oDel').onclick = () => deleteObject();
function selectionMeshes() { return (editor.selection?.() || []).filter((o) => o); }
function hideSelected() {
  const list = selectionMeshes().filter((o) => o.visible);
  if (!list.length) { $('progMsg').textContent = 'Nothing selected to hide'; return; }
  const prev = list.map((o) => o.visible);
  list.forEach((o) => { o.visible = false; });
  editor.pushHistory({ label: 'Hide', undo: () => { list.forEach((o, i) => { o.visible = prev[i]; }); updateInfo(); }, redo: () => { list.forEach((o) => { o.visible = false; }); updateInfo(); } });
  editor.select(null); updateInfo(); $('progMsg').textContent = `Hid ${list.length} object(s). Shift+H shows hidden objects.`;
}
function unhideAll() {
  const list = [];
  model?.traverse((o) => { if ((o.isMesh || o.isGroup) && !o.userData.isOverlay && o.visible === false) list.push(o); });
  if (!list.length) { $('progMsg').textContent = 'Nothing is hidden'; return; }
  list.forEach((o) => { o.visible = true; });
  editor.pushHistory({ label: 'Unhide', undo: () => { list.forEach((o) => { o.visible = false; }); updateInfo(); }, redo: () => { list.forEach((o) => { o.visible = true; }); updateInfo(); } });
  updateInfo(); $('progMsg').textContent = `Showed ${list.length} hidden object(s)`;
}
async function placeAsset(asset) {
  if (!asset) return null;
  const node = objectFromAsset(asset);
  node.userData.assetId = asset.id;
  node.traverse((o) => { if (o.isMesh) o.userData.assetId = asset.id; });
  const root = ensureScene(true);
  fitNewcomer(node, root);
  addUndoable(root, node, { id: asset.id, label: asset.name, source: asset.category }, 'Add ' + asset.name);
  applyShading(); updateInfo(); $('drop').classList.add('hidden');
  $('progMsg').textContent = `Added ${asset.name} (${asset.category}). Ctrl+Z removes only this object.`;
  return node;
}
const objMenu = document.createElement('div'); objMenu.id = 'objMenu'; objMenu.className = 'objmenu'; objMenu.hidden = true;
objMenu.innerHTML = '<button data-m="group">Group</button><button data-m="ungroup">Ungroup</button><button data-m="join">Join</button><button data-m="similar">Select Similar</button>';
document.body.appendChild(objMenu);
function openObjectMenu(e, list) {
  objMenu.hidden = false;
  objMenu.style.left = Math.min(e.clientX, innerWidth - 180) + 'px';
  objMenu.style.top = Math.min(e.clientY, innerHeight - 140) + 'px';
  objMenu.dataset.n = String(list.length);
}
addEventListener('pointerdown', (e) => { if (!objMenu.hidden && !objMenu.contains(e.target)) objMenu.hidden = true; });
objMenu.onclick = (e) => {
  const act = e.target.dataset.m; if (!act) return;
  objMenu.hidden = true;
  const list = selectionMeshes();
  if (act === 'group') doGroup(list);
  else if (act === 'ungroup') doUngroup(list);
  else if (act === 'join') doJoin(list);
  else if (act === 'similar') doSimilar(list[0]);
};
function doGroup(list) {
  const nodes = list.filter((n) => n.parent);
  if (nodes.length < 2) { $('progMsg').textContent = 'Select two or more objects to group'; return; }
  const made = groupNodes(nodes, THREE); if (!made) { $('progMsg').textContent = 'Group works on objects that share a parent'; return; }
  made.group.userData.sceneId = 'group_' + Math.random().toString(36).slice(2, 8);
  made.group.userData.source = 'group';
  editor.pushHistory({ label: 'Group', undo: () => { made.before.forEach((r) => { made.parent.attach(r.node); }); made.parent.remove(made.group); updateInfo(); }, redo: () => { made.parent.add(made.group); nodes.forEach((n) => made.group.attach(n)); updateInfo(); } });
  editor.select(made.group); updateInfo(); $('progMsg').textContent = `Grouped ${nodes.length} objects`;
}
function doUngroup(list) {
  const group = list.find((n) => n.isGroup && n.children.some((c) => c.isMesh || c.isGroup));
  if (!group) { $('progMsg').textContent = 'Select a group to ungroup'; return; }
  const rec = ungroupNode(group); if (!rec) return;
  editor.pushHistory({ label: 'Ungroup', undo: () => { rec.parent.add(rec.group); rec.records.forEach((r) => rec.group.attach(r.node)); updateInfo(); }, redo: () => { rec.records.forEach((r) => rec.parent.attach(r.node)); rec.parent.remove(rec.group); updateInfo(); } });
  updateInfo(); $('progMsg').textContent = 'Ungrouped';
}
function doJoin(list) {
  const meshes = [];
  list.forEach((n) => n.traverse?.((o) => { if (o.isMesh && !o.userData.isOverlay) meshes.push(o); }));
  const unique = [...new Set(meshes)];
  if (unique.length < 2) { $('progMsg').textContent = 'Select two or more meshes to join'; return; }
  const made = joinMeshes(unique, THREE);
  if (!made) { $('progMsg').textContent = 'Could not join those meshes'; return; }
  made.mesh.userData.sceneId = 'join_' + Math.random().toString(36).slice(2, 8);
  made.mesh.userData.source = 'join';
  made.mesh.userData.mf = { slots: (Array.isArray(made.mesh.material) ? made.mesh.material : [made.mesh.material]).map((m, i) => m.name || 'slot_' + i), active: 0, albedo: 'material', vcol: false };
  unique.forEach((m) => m.parent?.remove(m));
  editor.pushHistory({ label: 'Join', undo: () => { made.parent.remove(made.mesh); unique.forEach((m) => made.parent.add(m)); updateInfo(); }, redo: () => { unique.forEach((m) => m.parent?.remove(m)); made.parent.add(made.mesh); updateInfo(); } });
  editor.select(made.mesh); applyShading(); updateInfo(); $('progMsg').textContent = `Joined ${unique.length} meshes. Materials stay as slots.`;
}
function doSimilar(seed) {
  if (!seed) { $('progMsg').textContent = 'Select an object first'; return; }
  const pool = []; model?.traverse((o) => { if (o.isMesh && !o.userData.isOverlay) pool.push(o); });
  const hits = similarMeshes(seed.isMesh ? seed : (seed.children?.find((c) => c.isMesh) || seed), pool);
  const many = [seed.isMesh ? seed : hits[0], ...hits].filter(Boolean);
  editor.select(null, { many: [...new Set(many)] });
  $('progMsg').textContent = `Selected ${editor.selection().length} similar object(s)`;
  updateInfo();
}
$('oPhoto').onclick = () => { $('photoOv').hidden = !$('photoOv').hidden; };
$('photoOv').onclick = () => { $('photoOv').hidden = true; };
$('sceneFile').onchange = async (e) => {
  const f = [...e.target.files]; e.target.value = '';
  try { await recover?.write('before-import'); } catch { /* continue */ }
  if (f.length === 1 && /\.mfproj$/i.test(f[0].name)) { await openProjectBytes(await f[0].arrayBuffer()); return; }
  if (f.length === 1 && /\.gl(b|tf)$/i.test(f[0].name) && glbHasSkins(await f[0].arrayBuffer())) { await window.MeshForge.loadRig(f[0]); return; }
  if (f.length === 1 && /\.obj$/i.test(f[0].name)) { const asset = await importFile(f[0]); await placeAsset(asset); return; }
  if (f.length) await sceneIO.loadScene(f.length === 1 ? f[0] : f);
};
async function exportBundle() {
  const manifest = sceneIO.exportScene();
  if (explodeK) manifest.objects.forEach((o, i) => { const m = sceneObjects().find((x) => x.userData.sceneId === o.id); if (m) o.position[2] = +(m.position.z - (m.userData.exz || 0)).toFixed(5); });
  manifest.sceneGlb = 'scene.glb';
  return { manifest, glb: await editor.encode('glb') };
}
async function exportSceneFiles() {
  try { const { manifest, glb } = await exportBundle(); editor.save(glb, 'scene.glb'); editor.save(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), 'scene.json'); $('progMsg').textContent = `Exported scene.glb + scene.json (${manifest.objects.length} objects)`; }
  catch (err) { $('progMsg').textContent = 'Scene export failed: ' + err.message; }
}
// Landscape -> scene as Landscape > Terrain, Water, Buildings by type, Trees.
async function sendLandscapeToScene(opts = {}) {
  const terrain = land.terrain; if (!terrain) { $('progMsg').textContent = 'Open the Landscape tab and build a landscape first'; return null; }
  try { await recover?.write('before-landscape'); } catch { /* still send */ }
  if (land.active) setWorkspace('gen');
  const root = ensureScene(true);
  const m = land.hierarchy ? land.hierarchy() : bakeObject(terrain, 'Landscape');
  if (!m) return null;
  const sz = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
  const others = sceneObjects(); let width = 4; if (others.length) { const b = new THREE.Box3(); others.forEach((o) => b.expandByObject(o)); width = Math.max(b.getSize(new THREE.Vector3()).x, 1) * 1.5; }
  m.scale.setScalar(opts.scale ?? width / Math.max(sz.x, sz.z, 1e-6));
  addUndoable(root, m, { id: 'landscape', label: 'Landscape', source: 'landscape' }, 'Send landscape');
  if (!scene.children.includes(root)) scene.add(root);
  applyShading(); setShading('color'); frameModel(); updateInfo(); $('drop').classList.add('hidden');
  document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
  $('progMsg').textContent = 'Landscape added as a group (terrain, water, buildings by type, trees). Ctrl+Z removes only that group.';
  return { id: m.userData.sceneId, label: m.name };
}
Object.assign(window.MeshForge, {
  loadScene: (src, opts) => sceneIO.loadScene(src, opts),
  exportScene: () => { const m = sceneIO.exportScene(); if (explodeK) m.objects.forEach((o) => { const x = sceneObjects().find((y) => y.userData.sceneId === o.id); if (x) o.position[2] = +(x.position.z - (x.userData.exz || 0)).toFixed(5); }); return m; },
  exportSceneBundle: exportBundle,
  exportSelectedGLB: () => editor.sel ? editor.encode('glb', editor.sel) : Promise.reject(new Error('Nothing selected')),
  getObjects: () => sceneObjects().map((o) => ({ id: o.userData.sceneId ?? o.uuid, label: o.name, source: o.userData.source || '', visible: o.visible, selected: o === editor.sel,
    position: o.position.toArray(), rotation: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray() })),
  selectObject: (id) => selectObject(id),
  getSelected: () => editor.sel ? (editor.sel.userData.sceneId ?? editor.sel.uuid) : null,
  setMode: (m) => editor.setMode(m).then(() => editor.mode),
  get mode() { return editor.mode; },
  duplicateSelected: () => duplicateObject().then((c) => c && c.userData.sceneId),
  deleteSelected: () => deleteObject(),
  setVisible: (id, v) => { const o = sceneObjects().find((m) => m.userData.sceneId === id); if (o) { o.visible = !!v; updateInfo(); } return !!o; },
  setExplode: (k) => { $('explode').value = k; setExplode(+k); },
  sendLandscapeToScene,
});
window.__meshforge.sceneIO = sceneIO;
{ const sp = new URLSearchParams(location.search).get('scene'); if (sp) sceneIO.loadScene(sp).then((r) => { window.__meshforgeSceneResult = r; }); }

// ---------- v7: Chibili materials, Shader / UV workspaces, camera API ----------
mats = createMaterials({ scene, canvas, renderer, camera: () => camera, editor, meshes: () => editor.debug.meshes(), status: (m) => { $('progMsg').textContent = m; },
  updateInfo: () => updateInfo(), isChibili: () => state.shading === 'chibili', ensureUV: (m) => window.__mfEnsureUV?.(m), onTextureChange: (m) => window.__mfUV?.textureChanged(m),
  open2D: () => setWorkspace('uv'), paintTexDab: (...a) => window.__mfUV?.paintDab(...a) });
editor.debug.mats = mats;
const _sel = editor.select; // keep the material panel in sync with the selection
setInterval(() => { const k = `${editor.sel?.uuid}|${editor.mode}|${editor.debug.E?.mesh?.uuid}`; if (k !== mats._k) { mats._k = k; mats.renderUI(); } }, 250); void _sel;
function setCamera({ position, target, fov } = {}) {
  const v3 = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => Number.isFinite(+x));
  if (v3(target)) controls.target.set(+target[0], +target[1], +target[2]);
  if (v3(position)) camera.position.set(+position[0], +position[1], +position[2]);
  if (Number.isFinite(+fov) && fov > 1 && fov < 170) { persp.fov = +fov; persp.updateProjectionMatrix(); }
  camera.lookAt(controls.target); controls.update(); return { position: camera.position.toArray(), target: controls.target.toArray(), fov: persp.fov };
}
// Add ▸ Sky dome / Water plane (useful for a game viewport)
function addPrimitive(kind) {
  if (land?.active) setWorkspace('gen');
  const geo = kind === 'sky' ? new THREE.SphereGeometry(20, 48, 24) : new THREE.PlaneGeometry(6, 6, 48, 48).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: kind === 'sky' ? 0x9fd4ff : 0x1f9be8, side: THREE.DoubleSide }));
  mesh.name = kind === 'sky' ? 'Sky dome' : 'Water'; mesh.userData.mf = { slots: [kind], active: 0, albedo: 'material', vcol: false };
  const root = ensureScene(true);
  addUndoable(root, mesh, { id: kind, label: mesh.name, source: 'primitive' }, 'Add ' + mesh.name);
  $('drop').classList.add('hidden');
  document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
  applyShading(); updateInfo(); editor.select(mesh); return mesh;
}
Object.assign(ACTIONS, { addsky: () => addPrimitive('sky'), addwater: () => addPrimitive('water'), matlib: () => mats.showLibrary(mats.libEl.hidden), shader: () => setWorkspace('shader'), uvws: () => setWorkspace('uv') });
document.querySelectorAll('.menu [data-act]').forEach((b) => b.onclick = () => { document.activeElement?.blur(); ACTIONS[b.dataset.act]?.(); });
// scene.json: persist the material library and per-object slots; honour room.camera
const _exportScene = window.MeshForge.exportScene;
function withMaterials(m) { m.generator = 'MeshForge 8.0'; m.materials = mats.libJSON(); m.chibili = { ...CHIBILI };
  m.objects.forEach((o) => { const x = sceneObjects().find((y) => y.userData.sceneId === o.id); if (x?.userData.mf) { o.materials = x.userData.mf.slots.slice(); if (x.userData.mf.tex) o.texture = { ...x.userData.mf.tex }; } }); return m; }
window.MeshForge.exportScene = () => withMaterials(_exportScene());
const _bundle = exportBundle;
window.MeshForge.exportSceneBundle = async () => { const b = await _bundle(); withMaterials(b.manifest); return b; };
ACTIONS.scenejson = async () => { try { const { manifest, glb } = await window.MeshForge.exportSceneBundle(); editor.save(glb, 'scene.glb'); editor.save(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), 'scene.json'); $('progMsg').textContent = `Exported scene.glb + scene.json (${manifest.objects.length} objects, ${manifest.materials.length} materials)`; } catch (err) { $('progMsg').textContent = 'Scene export failed: ' + err.message; } };
window.__mfAfterSceneLoad = (man) => {
  if (!man) return;
  if (Array.isArray(man.materials)) mats.loadLib(man.materials);
  if (man.chibili && typeof man.chibili === 'object') Object.assign(CHIBILI, man.chibili);
  for (const o of man.objects || []) { const x = sceneObjects().find((y) => y.userData.sceneId === String(o.id)); if (x && Array.isArray(o.materials) && o.materials.length && !x.userData.mf) x.userData.mf = { slots: o.materials.slice(), active: 0, albedo: 'material', vcol: false }; }
  const cam = man.room?.camera; if (cam && (cam.position || cam.target || cam.fov)) setCamera(cam);
  applyShading();
};
Object.assign(window.MeshForge, {
  version: '8.0', setCamera, getCamera: () => ({ position: camera.position.toArray(), target: controls.target.toArray(), fov: persp.fov }),
  setShading: (v) => setShading(v), setWorkspace, chibili: CHIBILI,
  materials: {
    list: () => mats.libJSON(), get: (id) => mats.byId(id), create: (d) => mats.create(d).id, duplicate: (id) => mats.duplicate(id)?.id, rename: (id, n) => mats.rename(id, n), remove: (id) => mats.remove(id), update: (id, p) => mats.update(id, p), setActive: (id) => mats.setActive(id),
    assign: (objId, matId) => { const o = typeof objId === 'string' ? sceneObjects().find((m) => m.userData.sceneId === objId || m.name === objId) : (objId || editor.sel); return o ? mats.assignObject(o, matId) : false; },
    slots: (objId) => { const o = typeof objId === 'string' ? sceneObjects().find((m) => m.userData.sceneId === objId || m.name === objId) : (objId || editor.sel); return o?.userData.mf?.slots.slice() || null; },
  },
  addSky: () => addPrimitive('sky').name, addWater: () => addPrimitive('water').name, offline: () => !!state.offline,
});
Object.defineProperty(window.MeshForge, 'shading', { get: () => state.shading, configurable: true }); Object.defineProperty(window.MeshForge, 'workspace', { get: () => curWS, configurable: true });
window.__meshforge.mats = mats; window.__meshforge.setShading = setShading; window.__meshforge.setWorkspace = setWorkspace; window.__meshforge.addPrimitive = addPrimitive; window.__meshforge.sceneObjects = sceneObjects;

// ---------- v7 UV workspace
const uvEd = createUVEditor({ canvas, vp, editor, mats, scene, camera: () => camera, status: (m) => { $('progMsg').textContent = m; }, updateInfo: () => updateInfo(), isActiveWS: () => curWS === 'uv' });
window.__mfUV = { show: (on) => { uvEd.show(on); requestAnimationFrame(resize); }, textureChanged: () => uvEd.textureChanged(), paintDab: (...a) => uvEd.paintDab(...a) };
window.__mfEnsureUV = (m) => uvEd.ensureUV(m);
{ const prevTick = window.__mfTick; window.__mfTick = () => { prevTick?.(); uvEd.tick(); }; }
addEventListener('resize', () => { if (curWS === 'uv') uvEd.draw(); });
window.MeshForge.registerUVTool = (t) => uvEd.registerUVTool(t);
window.MeshForge.uv = {
  unwrap: (o = {}) => uvEd.run('unwrap', o), smartProject: (o = {}) => uvEd.run('smart', o), cubeProject: (o = {}) => uvEd.run('cube', o), cylinderProject: () => uvEd.run('cylinder'), sphereProject: () => uvEd.run('sphere'),
  projectFromView: () => uvEd.run('view'), reset: () => uvEd.run('reset'), pack: (o = {}) => uvEd.run('pack', o), averageScale: () => uvEd.run('average'), minimizeStretch: (o = {}) => uvEd.run('minimize', o),
  markSeam: () => uvEd.markSeam(true), clearSeam: () => uvEd.markSeam(false), seamsFromIslands: () => uvEd.seamsFromIslands(), clearAllSeams: () => uvEd.clearAllSeams(),
  exportLayout: (size) => uvEd.exportLayout(size), exportJSON: () => uvEd.exportJSON(), importText: (name, text) => uvEd.importText(name, text), importFile: (f) => uvEd.importFile(f),
  selectAll: () => uvEd.selectAll(), selectIslandAt: (u, v, add) => uvEd.selectIslandAt(u, v, add), transform: (kind, val) => uvEd.transformSelected(kind, val),
  runTool: (id) => uvEd.runTool(id), tools: () => uvEd.tools(), stats: () => uvEd.stats(), setTool: (t) => uvEd.setTool(t), options: uvEd.opt,
};
window.__meshforge.uv = uvEd;

// ---------- v7 rigging
const rig = createRig({ scene, editor, getModel: () => model, camera: () => camera, status: (m) => { $('progMsg').textContent = m; }, exportMaterial: (m, g) => mats?.exportMaterial(m, g) });
window.__mfAfterGLB = (m) => { const n = rig.attach(m); if (n) { setWorkspace('gen'); $('progMsg').textContent = `Rig loaded: ${rig.info().bones.length} bones, ${rig.info().clips.length} clip(s). Play it in Rig & animation (right panel)`; } };
window.__mfBlockMode = (m, mode) => rig.blockMode(m, mode);
window.__mfSkipExport = (m) => rig.skipExport(m);
window.__mfExtendExport = (g, o) => rig.extendExport(g, o);
{ const prevTick = window.__mfTick; window.__mfTick = () => { prevTick?.(); rig.tick(); }; }
ACTIONS.rigimp = () => $('rigFile').click();
$('rigFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await window.MeshForge.loadRig(f); };
window.MeshForge.loadRig = async (src) => { const m = await window.MeshForge.loadGLB(src); if (!rig.info().skinned) $('progMsg').textContent = 'Loaded, but that file has no skin (no rig): it opened as a normal model'; return rig.info(); };
window.MeshForge.rig = { info: () => rig.info(), play: () => rig.play(), pause: () => rig.pause(), stop: () => rig.stop(), scrub: (t) => rig.scrub(t), setClip: (i) => rig.setClip(i), selectBone: (i) => rig.selectBone(i), poseBone: (name, euler) => rig.poseBone(name, euler), restPose: () => rig.restPose(), weightView: (on) => rig.weightView(on), showBones: (on) => rig.showBones(on) };
window.__meshforge.rig = rig;

// ---------- v7.2 trusted local plugin host
const pluginBottom = document.createElement('div'); pluginBottom.id='pluginBottom'; document.body.querySelector('.workspace').appendChild(pluginBottom);
initPlugins({ api: window.MeshForge, setWorkspace, tabs: document.querySelector('.tabs'), panels: {left: document.querySelector('.props'), right: document.querySelector('.props'), bottom: pluginBottom}, offline: () => !!state.offline }).catch((e) => console.error('Plugin host failed:', e));
ACTIONS.plugins = () => window.MeshForge.showPlugins();
document.querySelector('.menu [data-act="plugins"]').onclick = () => { document.activeElement?.blur(); ACTIONS.plugins(); };

// ---------- v7.2 CPU mesh operations + floor / metric placement ----------
import('./meshops.js').then((ops) => {
  function replaceGeometry(mesh, geometry) {
    const old=mesh.geometry, at=sceneObjects().indexOf(mesh); editor.pushHistory({label:'Mesh operation',undo:()=>{mesh.geometry=old;applyShading();updateInfo();mats.renderUI();},redo:()=>{mesh.geometry=geometry;applyShading();updateInfo();mats.renderUI();}});
    mesh.geometry=geometry; mesh.geometry.computeBoundingSphere(); applyShading(); updateInfo(); if(at>=0) editor.select(mesh); return mesh;
  }
  function adaptInput(src) {
    if(typeof src==='string')return editor.debug.meshes().find(o=>o.userData.sceneId===src||o.name===src)||null;
    return src;
  }
  function opMesh(src,g) {const m=adaptInput(src);return m?.isMesh?replaceGeometry(m,g):g;}
  function worldBounds(o) { o.updateWorldMatrix(true,true);return new THREE.Box3().setFromObject(o); }
  function metricFactor(referenceMetres,measuredUnits=0,axis='y') {if(measuredUnits<=0)throw Error('measuredUnits must be positive');const axisIndex={x:0,y:1,z:2}[axis]??(axis>=0&&axis<=2?axis:1);return +referenceMetres/+measuredUnits;}
  const mfOps = {
    watertightness: ops.watertightness,
    voxelCarve: (masks,cameras,opts={}) => {const g=ops.voxelCarve(masks,cameras,opts);return {mesh:g,watertightness:ops.watertightness(g)}},
    meshBoolean: (a,b,operation='union',opts={}) => {const g=ops.meshBoolean(a,b,operation,opts);return {mesh:g,approximate:true,watertightness:ops.watertightness(g)}},
    decimate: (src,targetTris,opts={}) => {const g=ops.decimate(adaptInput(src),targetTris,opts);const m=adaptInput(src);return {mesh:m?.isMesh&&opts.apply!==false?replaceGeometry(m,g):g,watertightness:ops.watertightness(g)};},
    retopo: (src,opts={}) => {const m=adaptInput(src),p=(async()=>{const r=await ops.retopo(m,opts);if(m?.isMesh&&opts.apply!==false)r.mesh=replaceGeometry(m,r.mesh);return r;})();return p;},
    detectFloor: (src,opts={}) => {const m=adaptInput(src);return ops.detectFloor(m,opts.tolerance??.04);},
    snapToFloor(id='all',floorY=0) {
      const objects=id==='all'?editor.debug.meshes().filter(o=>!o.userData.isOverlay):[adaptInput(id)].filter(Boolean);if(!objects.length)return [];
      const placements=objects.map(o=>({o,y:o.position.y,delta:floorY-worldBounds(o).min.y}));
      objects.forEach(o=>o.position.y+=floorY-worldBounds(o).min.y);updateInfo();
      editor.pushHistory({label:'Snap to floor',undo:()=>{placements.forEach(p=>p.o.position.y=p.y);updateInfo();},redo:()=>{placements.forEach(p=>p.o.position.y=p.y+p.delta);updateInfo();}});
      return placements.map(p=>({id:p.o.userData.sceneId??p.o.uuid,delta:p.delta,y:p.o.position.y}));
    },
    setMetricScale(referenceMetres,measuredUnits,opts={}) {
      const factor=metricFactor(referenceMetres,measuredUnits,opts.axis),root=editor.getModel?.()||window.__meshforge.model;
      const objects=opts.id&&opts.id!=='all'?[adaptInput(opts.id)].filter(Boolean):editor.debug.meshes().filter(o=>!o.userData.isOverlay);
      const before=new Map(objects.map(o=>[o,{s:o.scale.clone(),p:o.position.clone()}]));objects.forEach(o=>{o.scale.multiplyScalar(factor);o.position.multiplyScalar(factor)});
      if(opts.camera!==false) setCamera({position:camera.position.toArray().map(x=>x*factor),target:controls.target.toArray().map(x=>x*factor)});
      root.userData.metricScaleFactor=factor;root.userData.units='m';if(opts.floor!==false)mfOps.snapToFloor(opts.floorId||'all',opts.floorY||0);updateInfo();
      editor.pushHistory({label:'Set metric scale',undo:()=>{before.forEach((v,o)=>{o.scale.copy(v.s);o.position.copy(v.p)});updateInfo();},redo:()=>{objects.forEach(o=>{o.scale.multiplyScalar(factor);o.position.multiplyScalar(factor)});updateInfo();}});return {factor,units:'m',objects:objects.length};
    },
    fitManifestMetres(manifest,knownDimension,measuredDimension,opts={}) {const f=metricFactor(knownDimension,measuredDimension),out=structuredClone(manifest);for(const o of out.objects||[]){o.position=(o.position||[0,0,0]).map(x=>x*f);o.scale=Array.isArray(o.scale)?o.scale.map(x=>x*f):(o.scale??1)*f}for(const k of ['position','target'])if(out.room?.camera?.[k])out.room.camera[k]=out.room.camera[k].map(x=>x*f);if(opts.applyRotation){const a=+(out.xAxisYawOffset??out.room?.xAxisYawOffset??0);if(!Number.isFinite(a))throw Error('xAxisYawOffset must be finite');const c=Math.cos(a),sn=Math.sin(a),tx=v=>[c*v[0]+sn*v[2],v[1],-sn*v[0]+c*v[2]];for(const o of out.objects||[])o.position=tx(o.position);for(const k of ['position','target'])if(out.room?.camera?.[k])out.room.camera[k]=tx(out.room.camera[k]);}if(opts.floor)for(const o of out.objects||[])o.position[1]=opts.floorY??0;out.units='m';out.metricScaleFactor=f;return out;},
  };
  Object.assign(window.MeshForge,mfOps);window.MeshForge.meshOps=ops;
}).catch(e=>console.error('Mesh operations failed:',e));

// ---------- v8 autosave, project files, content browser ----------
async function buildProjectBlob() {
  const bundle = await window.MeshForge.exportSceneBundle();
  const files = [
    { name: 'scene.json', data: new TextEncoder().encode(JSON.stringify(bundle.manifest, null, 2)) },
    { name: 'scene.glb', data: new Uint8Array(await bundle.glb.arrayBuffer()) },
    { name: 'materials.json', data: new TextEncoder().encode(JSON.stringify(bundle.manifest.materials || [])) },
  ];
  return new Blob([makeZip(files)], { type: 'application/zip' });
}
async function openProjectBytes(buf) {
  const files = readStoredZip(buf);
  if (!files['scene.glb']) throw new Error('Project has no scene.glb');
  const url = URL.createObjectURL(new Blob([files['scene.glb']], { type: 'model/gltf-binary' }));
  await new Promise((res, rej) => loadGLB(url, res, rej, { label: 'Open project', source: 'project', name: 'Project' }));
  URL.revokeObjectURL(url);
  if (files['scene.json']) {
    try { window.__mfAfterSceneLoad?.(JSON.parse(new TextDecoder().decode(files['scene.json']))); } catch { /* manifest is optional for the mesh */ }
  }
}
recover = createRecover({
  buildProject: buildProjectBlob,
  openProject: openProjectBytes,
  status: (m) => { $('progMsg').textContent = m; },
  setCamera,
});
Object.assign(window.MeshForge, {
  undo: () => editor.undo(), redo: () => editor.redo(),
  autosaveNow: (reason) => recover.write(reason || 'manual'),
  groupSelection: () => doGroup(selectionMeshes()),
  joinSelection: () => doJoin(selectionMeshes()),
  selectSimilar: () => doSimilar(editor.sel),
  hideSelection: hideSelected, unhideAll,
});
const dock = document.createElement('div'); dock.id = 'contentDock'; vp.appendChild(dock); mountBrowser(dock);
Object.assign(ACTIONS, {
  saveproj: () => recover.save(), saveas: () => recover.saveAs(), autosave: () => recover.chooseFolder(),
  openproj: () => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.mfproj,.glb,.gltf,.obj,.json'; input.onchange = async () => { const f = input.files[0]; if (!f) return; if (/\.mfproj$/i.test(f.name)) await openProjectBytes(await f.arrayBuffer()); else $('sceneFile').onchange({ target: { files: [f], value: '' } }); }; input.click(); },
});
