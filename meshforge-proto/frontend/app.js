// MeshForge front-end: original three.js (MIT) implementation. DCC-style layout and navigation conventions only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { createEditor } from './editor.js';
import { initLandscape } from './landui.js';
import { createSculpt } from './sculpt.js';
import { createSceneIO, bakeObject } from './scene.js';

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
const offsetMat = (m) => { if (m && !m.wireframe) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; } };
[MAT.solid, MAT.matcap].forEach(offsetMat);

function resize() {
  const w = vp.clientWidth, h = vp.clientHeight;
  renderer.setSize(w, h, false); persp.aspect = w / h; persp.updateProjectionMatrix();
  const s = camera === ortho ? ortho.top : 1.2; setOrthoSize(s);
}
function setOrthoSize(s) { const a = vp.clientWidth / vp.clientHeight; ortho.top = s; ortho.bottom = -s; ortho.left = -s * a; ortho.right = s * a; ortho.updateProjectionMatrix(); }
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
  if (!land?.active && editor.mode === 'object' && !e.ctrlKey && !e.metaKey && !e.altKey) {   // v6 delete / duplicate
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
    o.material = state.shading === 'color' ? o.userData.orig : MAT[state.shading];
    let ov = o.children.find((c) => c.userData.isWireOverlay);
    if (!ov) { ov = new THREE.Mesh(o.geometry, MAT.overlay); ov.userData.isOverlay = ov.userData.isWireOverlay = true; ov.raycast = () => {}; o.add(ov); }
    ov.visible = state.wireOverlay && state.shading !== 'wire';
  });
}
function setShading(v) { state.shading = v; document.querySelectorAll('#shading button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); applyShading(); }
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
  editor.reset(); if (model) scene.remove(model);
  const geo = new THREE.IcosahedronGeometry(0.7, detail ?? SPHERE_DETAIL[level] ?? 31); geo.translate(0, 0.7, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.6, side: THREE.DoubleSide }); offsetMat(mat);
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'Sphere';
  model = new THREE.Group(); model.add(mesh); model.userData.norm = new THREE.Matrix4(); scene.add(model); state.current = null;
  applyShading(); frameModel(); updateInfo(); $('drop').classList.add('hidden');
  document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
  editor.select(mesh); return editor.setMode('sculpt');
}
$('sculptron').onclick = async () => {
  if (!sculpt.active) { if (!model || land?.active) await newSphere(2); else await editor.setMode('sculpt'); if (!sculpt.active) return; sculpt.setDyn(true); return; }
  sculpt.setDyn(!sculpt.opt.dyn);
};
land = initLandscape({ scene, controls, renderer, camera: () => camera, setOrthoSize, status: (m) => { $('progMsg').textContent = m; }, setInfo: (h) => { $('vinfo').innerHTML = h; } });
function setWorkspace(w) {
  const on = w === 'land'; if (on === land.active) return;
  $('tabLand').classList.toggle('on', on); $('tabGen').classList.toggle('on', !on);
  if (on) { editor.reset(); setTool('select'); land.enter(); } else land.exit();
  if (model) model.visible = !on; grid.visible = axX.visible = axZ.visible = !on && $('ovGrid').checked;
  $('drop').classList.toggle('hidden', on || !!model); if (!on) updateInfo();
}
$('tabLand').onclick = () => setWorkspace('land'); $('tabGen').onclick = () => setWorkspace('gen');
window.MeshForgeLandscape = Object.assign(land, { setWorkspace });
renderer.setAnimationLoop(() => { editor.tick(); sculpt.tick(); controls.update(); renderer.render(scene, camera); drawGizmo(); });

function loadGLB(url, onDone, onError) {
  new GLTFLoader().load(url, (g) => {
    editor.reset();
    if (model) scene.remove(model);
    model = g.scene;
    model.traverse((o) => { if (o.isMesh && o.material) { offsetMat(o.material); o.material.side = THREE.DoubleSide; o.material.vertexColors = !!o.geometry.attributes.color; if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); } });
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = 1.4 / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(s); model.position.set(-c.x * s, -box.min.y * s, -c.z * s); model.updateMatrix(); model.userData.norm = model.matrix.clone();
    model.visible = !land?.active; scene.add(model); applyShading(); frameModel(); updateInfo();
    $('drop').classList.add('hidden');
    onDone?.(model);
  }, undefined, (e) => { console.error('GLB load failed', e); onError?.(e); });
}

// ---------- config ----------
async function loadConfig() {
  const cfg = await (await fetch('/api/config')).json(); state.config = cfg;
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
  state.file = f; $('preview').src = URL.createObjectURL(f); $('preview').hidden = false; $('fname').textContent = f.name; $('go').disabled = false;
}
$('file').onchange = (e) => setFile(e.target.files[0]);
$('upload2').onclick = () => $('file').click();
['dragenter', 'dragover'].forEach((ev) => vp.addEventListener(ev, (e) => { e.preventDefault(); vp.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => vp.addEventListener(ev, (e) => { e.preventDefault(); vp.classList.remove('over'); }));
vp.addEventListener('drop', (e) => setFile(e.dataTransfer.files[0]));
$('runner').querySelectorAll('button').forEach((b) => b.onclick = () => {
  $('runner').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); state.runner = b.dataset.v; updateRunnerHint();
});
const fmtK = (n) => n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
const bind = (id, f) => { const el = $(id); el.oninput = () => $(id + 'V').textContent = f(+el.value); };
bind('res', (v) => v); bind('tf', fmtK); bind('sa', (v) => v + '°'); bind('sm', (v) => v.toFixed(2));

// ---------- jobs ----------
$('go').onclick = async () => {
  const fd = new FormData();
  fd.append('image', state.file); fd.append('engine', $('engine').value); fd.append('runner', state.runner); fd.append('remove_bg', $('rembg').checked);
  fd.append('params', JSON.stringify({ resolution: +$('res').value, remesh: $('remesh').value, target_faces: +$('tf').value,
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
  const list = await (await fetch('/api/jobs')).json();
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
loadConfig(); refreshHistory().then(async () => {  // reopen the latest result
  const list = await (await fetch('/api/jobs')).json(); const j = list.find((x) => x.status === 'done'); if (j) show(j);
});
// ---------- export buttons + menus ----------
document.querySelectorAll('[data-export]').forEach((b) => b.onclick = () => b.dataset.export === 'zip' ? editor.exportZip() : editor.exportAs(b.dataset.export));
$('mode').onchange = (e) => editor.setMode(e.target.value);
document.querySelectorAll('#selModes button').forEach((b) => b.onclick = () => editor.setSelMode(b.dataset.v));
const ACTIONS = {
  import: () => $('file').click(), glb: () => editor.exportAs('glb'), obj: () => editor.exportAs('obj'), stl: () => editor.exportAs('stl'), ply: () => editor.exportAs('ply'),
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
  version: '6.0',
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
const sceneIO = createSceneIO({
  getRoot: () => model, editor, status: (m) => { $('progMsg').textContent = m; },
  setRoot: (root) => { editor.reset(); if (model) scene.remove(model); model = root; model.visible = !land?.active; scene.add(model); state.current = null; explodeK = 0; $('explode').value = 0; },
  afterLoad: (man, base) => {
    applyShading(); setShading('color'); frameModel(); updateInfo();
    $('drop').classList.add('hidden'); document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
    const ph = man?.photo; $('photoOv').hidden = true; $('oPhoto').hidden = !ph; if (ph) $('photoOv').src = sceneIO.resolve(ph);
  },
});
function sceneObjects() { return model ? model.children.filter((o) => o.isMesh && !o.userData.isOverlay) : []; }
var olistKey = '';
function refreshOutliner() {
  const el = $('outliner'); if (!el) return;
  const objs = model?.userData.isScene && !land?.active ? sceneObjects() : [];
  el.hidden = !objs.length; if (!objs.length) { olistKey = ''; return; }
  const sel = editor?.sel;
  const key = objs.map((o) => `${o.uuid}${o.visible ? 1 : 0}${o === sel ? 1 : 0}${o.name}`).join('|'); if (key === olistKey) return; olistKey = key;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('olist').innerHTML = objs.map((o, i) => `<li data-i="${i}" class="${o === sel ? 'sel' : ''} ${o.visible ? '' : 'hid'}"><button class="eye" title="Show / hide">${o.visible ? '👁' : '◌'}</button><span class="lbl" title="${esc(o.userData.sceneId || '')}">${esc(o.name)}</span>${o.userData.source ? `<span class="badge">${esc(o.userData.source)}</span>` : ''}</li>`).join('');
  $('olist').querySelectorAll('li').forEach((li) => {
    const o = objs[+li.dataset.i];
    li.onclick = (e) => { if (e.target.classList.contains('eye')) { o.visible = !o.visible; if (!o.visible && editor.sel === o && editor.mode === 'object') editor.select(null); updateInfo(); return; } selectObject(o); };
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
  const c = new THREE.Mesh(src.geometry.clone(), mat); c.position.copy(src.position); c.quaternion.copy(src.quaternion); c.scale.copy(src.scale);
  const sz = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3()); c.position.x += Math.max(sz.x * 1.1, 0.05) / (src.parent.scale.x || 1);
  c.name = `${src.name}.${String(++dupN).padStart(3, '0')}`;
  c.userData = { sceneId: src.userData.sceneId ? `${src.userData.sceneId}_copy${dupN}` : undefined, label: c.name, source: src.userData.source, ref: src.userData.ref, avgColor: src.userData.avgColor, note: src.userData.note };
  const parent = src.parent; parent.add(c); applyShading();
  editor.pushHistory({ label: 'Duplicate object', undo: () => { if (editor.sel === c) editor.select(null); parent.remove(c); updateInfo(); }, redo: () => { parent.add(c); updateInfo(); } });
  editor.select(c); updateInfo(); $('progMsg').textContent = `Duplicated ${src.name} → ${c.name} · Ctrl+Z to undo`; return c;
}
async function deleteObject(o = editor.sel) {
  if (!o || !o.parent) return false;
  if (editor.mode !== 'object') await editor.setMode('object');
  const parent = o.parent; editor.select(null); parent.remove(o);
  editor.pushHistory({ label: 'Delete object', undo: () => { parent.add(o); updateInfo(); }, redo: () => { if (editor.sel === o) editor.select(null); parent.remove(o); updateInfo(); } });
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
$('oPhoto').onclick = () => { $('photoOv').hidden = !$('photoOv').hidden; };
$('photoOv').onclick = () => { $('photoOv').hidden = true; };
$('sceneFile').onchange = async (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) await sceneIO.loadScene(f.length === 1 ? f[0] : f); };
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
// Landscape -> scene: copy the current terrain (and buildings) into the scene as one object, scaled to fit.
async function sendLandscapeToScene(opts = {}) {
  const terrain = land.terrain; if (!terrain) { $('progMsg').textContent = 'Open the Landscape tab and build a landscape first'; return null; }
  if (land.active) setWorkspace('gen');
  const root = sceneIO.ensureRoot(true);
  const m = bakeObject(terrain, 'Landscape'); if (!m) return null;
  const sz = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
  const others = sceneObjects(); let width = 4; if (others.length) { const b = new THREE.Box3(); others.forEach((o) => b.expandByObject(o)); width = Math.max(b.getSize(new THREE.Vector3()).x, 1) * 1.5; }
  m.scale.setScalar(opts.scale ?? width / Math.max(sz.x, 1e-6));
  sceneIO.addObject(root, m, { id: 'landscape', label: 'Landscape', source: 'landscape' });
  if (!scene.children.includes(root)) scene.add(root);
  applyShading(); setShading('color'); frameModel(); updateInfo(); $('drop').classList.add('hidden');
  document.querySelectorAll('[data-export]').forEach((b) => b.disabled = false);
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
