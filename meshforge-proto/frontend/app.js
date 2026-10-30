// MeshForge front-end: original three.js (MIT) implementation. DCC-style layout and navigation conventions only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { createEditor } from './editor.js';

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
let editor = null; // created below, once the scene exists

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
  if (!model) return;
  const s = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(s.center); camera.position.copy(s.center).addScaledVector(dir, s.radius * 3.6);
  if (camera === ortho) setOrthoSize(s.radius * 1.3); controls.update();
}
let viewLabel = 'User Perspective';
function updateInfo() {
  let tris = 0; model?.traverse((o) => { if (o.isMesh && !o.userData.isOverlay) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  const objs = model ? model.children.filter((o) => o.isMesh || o.children.length).length || 1 : 0;
  const extra = editor?.infoLine(); $('vinfo').innerHTML = `${viewLabel}<br><small>${model ? `(${objs}) object${objs > 1 ? 's' : ''} · ${Math.round(tris).toLocaleString()} tris` : 'No object'}</small>${extra ? `<br><small class="sel">${extra}</small>` : ''}`;
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
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
function setTool(t) { document.querySelectorAll('.tool[data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === t)); setLeft(t); editor.setTool(t); }
document.querySelectorAll('.tool[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));

editor = createEditor({
  scene, controls, canvas, renderer, camera: () => camera, getModel: () => model, jobId: () => state.current, updateInfo: () => updateInfo(),
  status: (m) => { $('progMsg').textContent = m; },
  setModeUI: (m) => { $('mode').value = m; $('selModes').hidden = m !== 'edit'; },
  setSelModeUI: (m) => document.querySelectorAll('#selModes button').forEach((b) => b.classList.toggle('on', b.dataset.v === m)),
});
renderer.setAnimationLoop(() => { editor.tick(); controls.update(); renderer.render(scene, camera); drawGizmo(); });

function loadGLB(url) {
  new GLTFLoader().load(url, (g) => {
    editor.reset();
    if (model) scene.remove(model);
    model = g.scene;
    model.traverse((o) => { if (o.isMesh && o.material) { offsetMat(o.material); o.material.side = THREE.DoubleSide; o.material.vertexColors = !!o.geometry.attributes.color; if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); } });
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = 1.4 / Math.max(size.x, size.y, size.z);
    model.scale.setScalar(s); model.position.set(-c.x * s, -box.min.y * s, -c.z * s); model.updateMatrix(); model.userData.norm = model.matrix.clone();
    scene.add(model); applyShading(); frameModel(); updateInfo();
    $('drop').classList.add('hidden');
  });
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
  keys: () => { $('help').hidden = !$('help').hidden; },
};
document.querySelectorAll('.menu [data-act]').forEach((b) => b.onclick = () => { document.activeElement?.blur(); ACTIONS[b.dataset.act](); });
$('help').onclick = () => { $('help').hidden = true; };
window.__meshforge = { loadGLB, show, editor, get model() { return model; }, get camera() { return camera; }, controls, setTool };
