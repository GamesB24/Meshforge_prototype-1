// MeshForge v7 UV workspace (original MIT code): seams, unwrap / project / pack tools, stretch overlay,
// UV import/export, a 2D split view with UV selection + transforms, 2D/3D texture painting and AI hooks.
import * as THREE from 'three';
import * as UV from './uv.js';
import { getSeams, pkey, triCount } from './mfdata.js';

const ICON = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  select: ICON('<path d="M5 3l12 9-5 1 3 6-2 1-3-6-4 4z"/>'), brush: ICON('<path d="M4 20c2 0 4-1 4-4l9-9-3-3-9 9c-3 0-4 2-4 4z"/>'),
  eraser: ICON('<path d="M3 17l9-9 6 6-6 6H7z"/><path d="M12 20h9"/>'), fill: ICON('<path d="M5 12l7-7 7 7-7 7z"/><path d="M19 15c1 2 2 3 2 4a2 2 0 0 1-4 0c0-1 1-2 2-4z"/>'),
  soften: ICON('<circle cx="12" cy="12" r="7" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="2"/>'), sync: ICON('<path d="M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a5 5 0 0 0-9 3"/><path d="M20 12a8 8 0 0 1-14 5l-2 2v-6h6l-2 2a5 5 0 0 0 9-3"/>'),
  ai: ICON('<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><path d="M19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>'),
};
const registry = [];
const mm = (a, f, x) => { for (let i = 0; i < a.length; i++) x = f(x, a[i]); return x; }; // registered UV tools (AI hooks)

export function createUVEditor(ctx) {
  // ctx: { canvas, vp, editor, mats, status, camera(), scene, setWorkspace, isActiveWS() }
  const $ = (id) => document.getElementById(id), { editor, mats } = ctx, status = (m) => ctx.status(m);
  const target = () => editor.debug.E?.mesh || editor.sel;
  let topoCache = null; const M = (mesh) => { if (!topoCache || topoCache.mesh !== mesh || topoCache.geo !== mesh.geometry || topoCache.ver !== mesh.geometry.attributes.uv?.version) topoCache = { mesh, geo: mesh.geometry, ver: mesh.geometry.attributes.uv?.version, M: UV.topo(mesh.geometry) }; return topoCache.M; };
  const cached = (mesh, k, f) => { M(mesh); return topoCache[k] || (topoCache[k] = f(topoCache.M)); };
  const islandsOf = (mesh) => cached(mesh, 'isl', UV.uvIslands), stretchOf = (mesh) => cached(mesh, 'st', (m) => UV.stretch(m));
  const opt = { method: 'angle', margin: 0.02, angle: 66, areaW: 0, rotate: true, cube: 1, stretch: false, sync: false, tool: 'select', size: 24, opacity: 1, color: '#ff6f61', iters: 10, layout: 1024 };

  // ---------------------------------------------------------- side panel
  const panel = document.createElement('div'); panel.id = 'uvPanel'; panel.className = 'ws-panel';
  panel.innerHTML = `
  <details open class="acc"><summary>Seams</summary>
    <div class="row"><button class="btn" id="uvMark">Mark Seam</button><button class="btn" id="uvClear">Clear Seam</button></div>
    <div class="row"><button class="btn" id="uvSeamIsl">Seams from Islands</button><button class="btn" id="uvSeamAll">Clear all</button></div>
    <div class="hint0">Edit Mode (Tab), edge select (2), pick edges, then Mark Seam. Seams are drawn in coral.</div>
  </details>
  <details open class="acc"><summary>Unwrap</summary>
    <div class="row"><span>Method</span><select id="uvMethod"><option value="angle">Angle based (smooth)</option><option value="conformal">Conformal (LSCM)</option></select></div>
    <div class="row"><span>Margin</span><input id="uvMargin" type="range" min="0" max="0.1" step="0.005" value="0.02"><b id="uvMarginV">0.020</b></div>
    <div class="row"><button class="btn" id="uvUnwrap">Unwrap (U)</button></div>
    <div class="row"><span>Angle limit</span><input id="uvAngle" type="range" min="1" max="89" value="66"><b id="uvAngleV">66°</b></div>
    <div class="row"><span>Area weight</span><input id="uvAreaW" type="range" min="0" max="1" step="0.05" value="0"><b id="uvAreaWV">0.00</b></div>
    <div class="row"><button class="btn" id="uvSmart">Smart UV Project</button></div>
    <div class="row"><span>Cube size</span><input id="uvCube" class="txt num" type="number" min="0.01" step="0.1" value="1"><button class="btn" id="uvCubeP">Cube</button></div>
    <div class="row"><button class="btn" id="uvCyl">Cylinder</button><button class="btn" id="uvSph">Sphere</button><button class="btn" id="uvView">From View</button><button class="btn" id="uvReset">Reset</button></div>
  </details>
  <details open class="acc"><summary>Islands</summary>
    <label class="row chk"><input id="uvRot" type="checkbox" checked> Rotate when packing</label>
    <div class="row"><button class="btn" id="uvPack">Pack Islands</button><button class="btn" id="uvAvg">Average Island Scale</button></div>
    <div class="row"><span>Iterations</span><input id="uvIters" class="txt num" type="number" min="1" max="100" value="10"><button class="btn" id="uvMin">Minimize Stretch</button></div>
    <label class="row chk"><input id="uvStretch" type="checkbox"> Show stretch <span class="uvscale"></span></label>
    <div class="hint0" id="uvInfo">—</div>
  </details>
  <details open class="acc"><summary>Texture</summary>
    <div class="row"><span>Name</span><input id="uvTexName" class="txt" value="albedo"></div>
    <div class="row"><span>Size</span><select id="uvRes"><option>512</option><option selected>1024</option><option>2048</option></select><button class="btn" id="uvTexNew">New</button><button class="btn" id="uvTexDel">Delete</button></div>
    <div class="row"><span>Paint colour</span><input id="uvCol" type="color" value="#ff6f61"><span>Size</span><input id="uvSize" class="txt num" type="number" min="1" max="512" value="24"></div>
    <div class="row"><span>Opacity</span><input id="uvOp" type="range" min="0.05" max="1" step="0.05" value="1"><b id="uvOpV">1.00</b></div>
    <div class="hint0">Textures are made in MeshForge (no import in v7). In the 3D half, the Shader tab's Texture brush paints onto the same image.</div>
  </details>
  <details open class="acc"><summary>Import / export</summary>
    <div class="row"><button class="btn" id="uvLayout">UV layout PNG</button><select id="uvLayoutRes"><option>512</option><option selected>1024</option><option>2048</option><option>4096</option></select></div>
    <div class="row"><button class="btn" id="uvJson">Export UV JSON</button><button class="btn" id="uvImp">Import UVs…</button></div>
    <input type="file" id="uvFile" accept=".obj,.glb,.gltf,.json" hidden>
    <div class="hint0">Import takes UVs from an OBJ / GLB / glTF of the same mesh (matched by triangle positions) or a MeshForge UV JSON.</div>
  </details>
  <details open class="acc"><summary>${I.ai} AI tools</summary>
    <div class="row"><button class="btn" disabled title="Planned: learns where an artist would cut">Auto seams (AI)</button><button class="btn" disabled title="Planned">Texture from prompt (AI)</button></div>
    <div class="row"><button class="btn" disabled title="Planned">Smart pack (AI)</button><button class="btn" disabled title="Planned">Style transfer (AI)</button></div>
    <div id="uvTools" class="row wrap"></div>
    <div class="hint0">Placeholders for now. Developers can add tools with <code>MeshForge.registerUVTool({id, label, run(ctx)})</code>; see docs/ai-hooks.md.</div>
  </details>`;
  document.querySelector('.props').appendChild(panel);
  const bindR = (id, key, fmt) => { const el = $(id); el.oninput = () => { opt[key] = +el.value; if ($(id + 'V')) $(id + 'V').textContent = fmt(+el.value); }; };
  bindR('uvMargin', 'margin', (v) => v.toFixed(3)); bindR('uvAngle', 'angle', (v) => v + '°'); bindR('uvAreaW', 'areaW', (v) => v.toFixed(2)); bindR('uvOp', 'opacity', (v) => v.toFixed(2));
  $('uvMethod').onchange = (e) => (opt.method = e.target.value); $('uvRot').onchange = (e) => (opt.rotate = e.target.checked);
  $('uvCube').onchange = (e) => (opt.cube = Math.max(0.01, +e.target.value || 1)); $('uvIters').onchange = (e) => (opt.iters = THREE.MathUtils.clamp(+e.target.value || 10, 1, 100));
  $('uvCol').oninput = (e) => (opt.color = e.target.value); $('uvSize').onchange = (e) => (opt.size = THREE.MathUtils.clamp(+e.target.value || 24, 1, 512));
  $('uvStretch').onchange = (e) => { opt.stretch = e.target.checked; overlay3D(); draw(); };
  $('uvMark').onclick = () => markSeam(true); $('uvClear').onclick = () => markSeam(false); $('uvSeamIsl').onclick = () => seamsFromIslands(); $('uvSeamAll').onclick = () => clearAllSeams();
  $('uvUnwrap').onclick = () => run('unwrap'); $('uvSmart').onclick = () => run('smart'); $('uvCubeP').onclick = () => run('cube'); $('uvCyl').onclick = () => run('cylinder'); $('uvSph').onclick = () => run('sphere'); $('uvView').onclick = () => run('view'); $('uvReset').onclick = () => run('reset');
  $('uvPack').onclick = () => run('pack'); $('uvAvg').onclick = () => run('average'); $('uvMin').onclick = () => run('minimize');
  $('uvTexNew').onclick = () => { const m = target(); if (!m) return status('Select an object first'); mats.createTexture(m, { name: $('uvTexName').value.trim() || 'albedo', res: +$('uvRes').value }); baseImg.delete(m); draw(); };
  $('uvTexDel').onclick = () => { const m = target(); if (m && mats.deleteTexture(m)) { status('Texture deleted'); draw(); } };
  $('uvTexName').onchange = (e) => { const m = target(); if (m && mats.texOf(m)) mats.renameTexture(m, e.target.value.trim()); };
  $('uvLayout').onclick = () => exportLayout(+$('uvLayoutRes').value); $('uvJson').onclick = () => exportJSON();
  $('uvImp').onclick = () => $('uvFile').click(); $('uvFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await importFile(f); };

  // ---------------------------------------------------------- 2D view
  const vp = ctx.vp, wrap = document.createElement('div'); wrap.id = 'uv2d'; wrap.hidden = true;
  wrap.innerHTML = `<div class="uvbar"><b>UV Editor</b><span class="seg" id="uvTools2">
    <button data-t="select" class="on" title="Select islands (click), box select (drag), G/R/S to move/rotate/scale">${I.select}</button>
    <button data-t="brush" title="Paint brush (B)">${I.brush}</button><button data-t="eraser" title="Eraser: back to the base colours">${I.eraser}</button>
    <button data-t="fill" title="Fill an area of similar colour">${I.fill}</button><button data-t="soften" title="Soften (blur)">${I.soften}</button></span>
    <button class="uvsync" id="uvSync" title="Sync selection with the 3D Edit Mode faces">${I.sync}</button>
    <span class="grow"></span><span id="uvZoom">100%</span><button class="btn" id="uvFit" title="Frame the 0-1 square (Home)">Fit</button></div>
    <canvas id="uvc"></canvas><div class="uvhint">Wheel zoom · middle/right drag pan · click island · Shift add · A all · G R S transform</div>`;
  vp.appendChild(wrap);
  const cv = wrap.querySelector('#uvc'); let g2 = cv.getContext('2d');
  const view = { zoom: 1, px: 0, py: 0 }; let selC = null; // selected corners
  const baseImg = new WeakMap(); let modal = null, drag = null, painting = null, hover = null;
  wrap.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => setTool(b.dataset.t));
  $('uvSync').onclick = () => { opt.sync = !opt.sync; $('uvSync').classList.toggle('on', opt.sync); status(`UV sync selection ${opt.sync ? 'on: the 2D view follows the 3D face selection' : 'off'}`); draw(); };
  $('uvFit').onclick = () => fit();
  function setTool(t) { opt.tool = t; wrap.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); cv.style.cursor = t === 'select' ? 'default' : 'crosshair'; draw(); }
  function size() { const r = wrap.getBoundingClientRect(), bar = 28; const w = Math.max(10, r.width | 0), h = Math.max(10, (r.height - bar) | 0); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } return [w, h]; }
  function fit() { const [w, h] = size(); const s = Math.min(w, h) * 0.86; view.zoom = s; view.px = (w - s) / 2; view.py = (h - s) / 2 + s; draw(); }
  const toScr = (u, v) => [view.px + u * view.zoom, view.py - v * view.zoom], toUV = (x, y) => [(x - view.px) / view.zoom, (view.py - y) / view.zoom];
  function checker() { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#3c3c44' : '#4a4a54'; g.fillRect(x * 32, y * 32, 32, 32); } return c; }
  const CHK = checker();
  function curSel(mesh, m) { // per-corner selection, honouring sync
    if (opt.sync && editor.mode === 'edit' && editor.debug.E?.mesh === mesh) { const f = editor.faceSelection(), s = new Uint8Array(m.nt * 3); for (const t of f) if (t < m.nt) s[t * 3] = s[t * 3 + 1] = s[t * 3 + 2] = 1; return s; }
    if (!selC || selC.length !== m.nt * 3) selC = new Uint8Array(m.nt * 3); return selC;
  }
  let rafPending = false; function draw() { if (wrap.hidden || rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; drawNow(); }); }
  let wireC = null, wireKey = '';
  function drawNow() {
    if (wrap.hidden) return; const [w, h] = size(); g2.setTransform(1, 0, 0, 1, 0, 0); g2.fillStyle = '#232327'; g2.fillRect(0, 0, w, h);
    const [x0, y0] = toScr(0, 1), S = view.zoom, mesh = target();
    g2.imageSmoothingEnabled = S < 800; const tex = mesh && mats.texOf(mesh);
    g2.drawImage(tex ? tex.canvas : CHK, x0, y0, S, S);
    g2.strokeStyle = '#ff6f61'; g2.lineWidth = 1; g2.strokeRect(x0 + 0.5, y0 + 0.5, S, S);
    $('uvZoom').textContent = Math.round(S / Math.min(w, h) * 100 / 0.86) + '%';
    if (!mesh) { g2.fillStyle = '#aaa'; g2.font = '13px sans-serif'; g2.fillText('Select an object to see its UVs', 12, 20); return; }
    if (!mesh.geometry.attributes.uv) { g2.fillStyle = '#ddd'; g2.font = '13px sans-serif'; g2.fillText('No UVs yet: use Unwrap or Smart UV Project', 12, 20); return; }
    const m = M(mesh), uv = m.UV, sel = curSel(mesh, m); const showAll = !(opt.sync && editor.mode === 'edit');
    // the wire / selection layer is cached and only rebuilt when the view, UVs or selection change (painting only redraws the texture)
    let selHash = 0; for (let i = 0; i < sel.length; i += 3) if (sel[i]) selHash = (selHash * 31 + i) >>> 0;
    const key = [w, h, view.zoom, view.px, view.py, mesh.geometry.uuid, uv.length, selHash, opt.stretch, opt.tool === 'select', showAll].join('|');
    if (key !== wireKey || !wireC) {
      wireKey = key; wireC ||= document.createElement('canvas'); wireC.width = w; wireC.height = h; const G = wireC.getContext('2d'), keep = g2; g2 = G;
      try {
        if (opt.stretch) { const { S: st } = stretchOf(mesh); for (let t = 0; t < m.nt; t++) { const [r, gg, b] = UV.stretchColor(st[t]); g2.fillStyle = `rgba(${r * 255 | 0},${gg * 255 | 0},${b * 255 | 0},0.55)`; tri(uv, t, true); } }
        const al = THREE.MathUtils.clamp(6000 / m.nt, 0.12, 0.75); g2.strokeStyle = `rgba(235,240,255,${al})`; g2.lineWidth = 1; g2.beginPath(); for (let t = 0; t < m.nt; t++) if (showAll || sel[t * 3]) tri(uv, t, false, true); g2.stroke();
        g2.strokeStyle = `rgba(46,196,182,${Math.min(1, al * 1.4)})`; g2.lineWidth = m.nt > 20000 ? 1 : 1.6; g2.beginPath(); let any = 0; for (let t = 0; t < m.nt; t++) if (sel[t * 3] && sel[t * 3 + 1] && sel[t * 3 + 2]) { tri(uv, t, false, true); any++; } g2.stroke();
        if (any && opt.tool === 'select') { g2.fillStyle = 'rgba(46,196,182,0.18)'; g2.beginPath(); for (let t = 0; t < m.nt; t++) if (sel[t * 3] && sel[t * 3 + 1] && sel[t * 3 + 2]) tri(uv, t, false, true); g2.fill(); }
      } finally { g2 = keep; }
    }
    g2.drawImage(wireC, 0, 0);
    if (drag?.box) { g2.strokeStyle = '#fff'; g2.setLineDash([4, 3]); g2.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); g2.setLineDash([]); }
    if (hover && opt.tool !== 'select' && tex) { g2.strokeStyle = '#fff'; g2.beginPath(); g2.arc(hover[0], hover[1], opt.size / tex.res * S, 0, Math.PI * 2); g2.stroke(); }
    if (modal) { g2.fillStyle = '#fff'; g2.font = '12px sans-serif'; g2.fillText(modal.label, 10, h - 10); }
  }
  function tri(uv, t, fill, path) { const o = t * 6; const a = toScr(uv[o], uv[o + 1]), b = toScr(uv[o + 2], uv[o + 3]), c = toScr(uv[o + 4], uv[o + 5]);
    if (path) { g2.moveTo(a[0], a[1]); g2.lineTo(b[0], b[1]); g2.lineTo(c[0], c[1]); g2.lineTo(a[0], a[1]); return; }
    g2.beginPath(); g2.moveTo(a[0], a[1]); g2.lineTo(b[0], b[1]); g2.lineTo(c[0], c[1]); g2.closePath(); fill ? g2.fill() : g2.stroke(); }
  // selection helpers
  function islandAt(m, u, v) { const uv = m.UV; for (let t = 0; t < m.nt; t++) { const o = t * 6; if (inTri(u, v, uv[o], uv[o + 1], uv[o + 2], uv[o + 3], uv[o + 4], uv[o + 5])) { const isl = islandsOf(target()); return isl.charts[isl.chartOf[t]].tris; } } return null; }
  function inTri(px, py, ax, ay, bx, by, cx2, cy2) { const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by), d2 = (px - cx2) * (by - cy2) - (bx - cx2) * (py - cy2), d3 = (px - ax) * (cy2 - ay) - (cx2 - ax) * (py - ay); const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0; return !(neg && pos); }
  function setSelTris(mesh, m, tris, add) {
    if (opt.sync && editor.mode === 'edit' && editor.debug.E?.mesh === mesh) { if (!add) editor.selectFaces(editor.faceSelection(), false); editor.selectFaces(tris, true); return; }
    const s = curSel(mesh, m); if (!add) s.fill(0); for (const t of tris) s[t * 3] = s[t * 3 + 1] = s[t * 3 + 2] = 1;
  }
  function selectedTris(mesh, m) { const s = curSel(mesh, m), out = []; for (let t = 0; t < m.nt; t++) if (s[t * 3] && s[t * 3 + 1] && s[t * 3 + 2]) out.push(t); return out; }
  // pointer
  const lp = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = lp(e), f = Math.exp(-e.deltaY * 0.0015), [u, v] = toUV(x, y); view.zoom = THREE.MathUtils.clamp(view.zoom * f, 40, 40000); view.px = x - u * view.zoom; view.py = y + v * view.zoom; draw(); }, { passive: false });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture?.(e.pointerId); const [x, y] = lp(e); const mesh = target();
    if (modal) { if (e.button === 0) endModal(true); else endModal(false); return; }
    if (e.button === 1 || e.button === 2) { drag = { pan: true, x, y, px: view.px, py: view.py }; return; }
    if (!mesh || !mesh.geometry.attributes.uv) return;
    if (opt.tool === 'select') { drag = { box: false, x0: x, y0: y, x1: x, y1: y, add: e.shiftKey }; return; }
    beginPaint2D(mesh, e, x, y);
  });
  cv.addEventListener('pointermove', (e) => {
    const [x, y] = lp(e); hover = [x, y];
    if (modal) { updateModal(x, y); return; }
    if (drag?.pan) { view.px = drag.px + x - drag.x; view.py = drag.py + y - drag.y; draw(); return; }
    if (drag && !drag.pan) { drag.x1 = x; drag.y1 = y; if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > 4) drag.box = true; draw(); return; }
    if (painting) { paintMove(x, y, e); return; }
    if (opt.tool !== 'select') draw();
  });
  cv.addEventListener('pointerup', (e) => {
    const [x, y] = lp(e);
    if (painting) { endPaint2D(); return; }
    if (drag && !drag.pan) { const mesh = target(); if (mesh?.geometry.attributes.uv) { const m = M(mesh);
      if (drag.box) { const [ua, va] = toUV(Math.min(drag.x0, x), Math.max(drag.y0, y)), [ub, vb] = toUV(Math.max(drag.x0, x), Math.min(drag.y0, y)), tris = [];
        for (let t = 0; t < m.nt; t++) { let inn = true; for (let k = 0; k < 3; k++) { const u = m.UV[(t * 3 + k) * 2], v = m.UV[(t * 3 + k) * 2 + 1]; if (u < ua || u > ub || v < va || v > vb) inn = false; } if (inn) tris.push(t); }
        setSelTris(mesh, m, tris, drag.add); status(`${tris.length} UV faces selected`); }
      else { const [u, v] = toUV(x, y), isl = islandAt(m, u, v); if (isl) { setSelTris(mesh, m, isl, drag.add); status(`Island selected (${isl.length} faces) · G / R / S to move, rotate, scale`); } else if (!drag.add) setSelTris(mesh, m, [], false); } } }
    drag = null; draw();
  });
  cv.addEventListener('pointerleave', () => { hover = null; draw(); });
  // keys while the pointer is over the 2D view
  addEventListener('keydown', (e) => {
    if (wrap.hidden || !hover || e.target.closest?.('input,select,textarea')) return; const k = e.key.toLowerCase(), mesh = target();
    if (modal) { if (k === 'escape') endModal(false); else if (k === 'enter') endModal(true); else if (k === 'x' || k === 'y') { modal.axis = modal.axis === k ? null : k; updateModal(...modal.last); } e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!mesh?.geometry.attributes.uv) return; const m = M(mesh);
    if (['g', 'r', 's'].includes(k) && !e.ctrlKey) { startModal(k); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (k === 'a' && !e.ctrlKey) { setSelTris(mesh, m, e.altKey ? [] : [...Array(m.nt).keys()], false); draw(); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (k === 'home') { fit(); e.preventDefault(); }
    else if (k === 'b') { setTool('brush'); e.stopImmediatePropagation(); }
  }, true);
  function startModal(kind, from) {
    const mesh = target(), m = M(mesh), tris = selectedTris(mesh, m); if (!tris.length) { status('Select UV islands first (click one, or A for all)'); return false; }
    const ids = []; for (const t of tris) for (let k = 0; k < 3; k++) ids.push(t * 3 + k);
    let cx = 0, cy = 0; for (const c of ids) { cx += m.UV[c * 2]; cy += m.UV[c * 2 + 1]; } cx /= ids.length; cy /= ids.length;
    const start = from || hover || [cv.width / 2, cv.height / 2];
    modal = { kind, mesh, m, ids, orig: Float32Array.from(ids.flatMap((c) => [m.UV[c * 2], m.UV[c * 2 + 1]])), c: [cx, cy], start, last: start, axis: null, label: '' };
    status(`${{ g: 'Move', r: 'Rotate', s: 'Scale' }[kind]} UVs · move the mouse · X/Y constrain · click or Enter to confirm · Esc / right-click to cancel`); return true;
  }
  function updateModal(x, y) {
    const D = modal; if (!D) return; D.last = [x, y]; const uv = D.m.UV; const [u0, v0] = toUV(...D.start), [u1, v1] = toUV(x, y), [cu, cvv] = D.c, [sx, sy] = toScr(cu, cvv);
    let f = (u, v) => [u, v];
    if (D.kind === 'g') { let du = u1 - u0, dv = v1 - v0; if (D.axis === 'x') dv = 0; if (D.axis === 'y') du = 0; f = (u, v) => [u + du, v + dv]; D.label = `Move ${du.toFixed(3)}, ${dv.toFixed(3)}`; }
    if (D.kind === 'r') { const a = Math.atan2(-(y - sy), x - sx) - Math.atan2(-(D.start[1] - sy), D.start[0] - sx), c = Math.cos(a), s = Math.sin(a); f = (u, v) => [cu + (u - cu) * c - (v - cvv) * s, cvv + (u - cu) * s + (v - cvv) * c]; D.label = `Rotate ${THREE.MathUtils.radToDeg(a).toFixed(1)}°`; }
    if (D.kind === 's') { const k = Math.hypot(x - sx, y - sy) / (Math.hypot(D.start[0] - sx, D.start[1] - sy) || 1), kx = D.axis === 'y' ? 1 : k, ky = D.axis === 'x' ? 1 : k; f = (u, v) => [cu + (u - cu) * kx, cvv + (v - cvv) * ky]; D.label = `Scale ${k.toFixed(3)}`; }
    D.ids.forEach((c, i) => { const [a, b] = f(D.orig[i * 2], D.orig[i * 2 + 1]); uv[c * 2] = a; uv[c * 2 + 1] = b; }); D.f = f; wireKey = ''; draw();
  }
  function endModal(ok) {
    const D = modal; modal = null; if (!D) return;
    const uv = D.m.UV; if (!ok) { D.ids.forEach((c, i) => { uv[c * 2] = D.orig[i * 2]; uv[c * 2 + 1] = D.orig[i * 2 + 1]; }); wireKey = ''; draw(); status('Cancelled'); return; }
    const keepSel = selC ? selC.slice() : null; commit(D.mesh, uv.slice(), { g: 'Move UVs', r: 'Rotate UVs', s: 'Scale UVs' }[D.kind], D.m); if (keepSel) selC = keepSel;
  }
  // API transform (tests / scripts): kind g|r|s with value (du,dv) | degrees | factor
  function transformSelected(kind, val) {
    const mesh = target(); if (!mesh?.geometry.attributes.uv) return false; const m = M(mesh), tris = selectedTris(mesh, m); if (!tris.length) return false;
    const ids = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) ids.add(t * 3 + k); let cx = 0, cy = 0; for (const c of ids) { cx += m.UV[c * 2]; cy += m.UV[c * 2 + 1]; } cx /= ids.size; cy /= ids.size;
    const uv = m.UV.slice(); for (const c of ids) { let u = uv[c * 2], v = uv[c * 2 + 1];
      if (kind === 'g') { u += val[0]; v += val[1]; } else if (kind === 'r') { const a = THREE.MathUtils.degToRad(val), cs = Math.cos(a), sn = Math.sin(a); [u, v] = [cx + (u - cx) * cs - (v - cy) * sn, cy + (u - cx) * sn + (v - cy) * cs]; } else { u = cx + (u - cx) * val; v = cy + (v - cy) * val; }
      uv[c * 2] = u; uv[c * 2 + 1] = v; }
    const keep = selC ? selC.slice() : null; commit(mesh, uv, 'Transform UVs', m); if (keep) selC = keep; return true;
  }

  // ---------------------------------------------------------- texture painting (2D view and 3D brush)
  function texFor(mesh) { const t = mats.texOf(mesh); if (t && !baseImg.has(mesh)) baseImg.set(mesh, t.ctx.getImageData(0, 0, t.res, t.res)); return t; }
  function beginPaint2D(mesh, e, x, y) {
    const t = texFor(mesh); if (!t) { status('This object has no texture yet: Texture ▸ New'); return; }
    painting = { mesh, t, before: t.ctx.getImageData(0, 0, t.res, t.res), last: null };
    const [u, v] = toUV(x, y);
    if (opt.tool === 'fill') { floodFill(t, u, v, opt.color, opt.opacity); endPaint2D(); return; }
    paintMove(x, y, e);
  }
  function paintMove(x, y, e) {
    const P = painting; if (!P) return; const pr = e?.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1; const [u, v] = toUV(x, y);
    const step = Math.max(1, opt.size * 0.25) / P.t.res; const pts = [];
    if (P.last) { const d = Math.hypot(u - P.last[0], v - P.last[1]), n = Math.max(1, Math.ceil(d / step)); for (let i = 1; i <= n; i++) pts.push([P.last[0] + (u - P.last[0]) * i / n, P.last[1] + (v - P.last[1]) * i / n]); } else pts.push([u, v]);
    for (const q of pts) paintDab(P.mesh, q[0], q[1], opt.size, { color: opt.color, opacity: opt.opacity * pr, tool: opt.tool }, true);
    P.last = [u, v]; draw();
  }
  function endPaint2D() {
    const P = painting; painting = null; if (!P) return; const t = P.t, a = P.before, b = t.ctx.getImageData(0, 0, t.res, t.res), mesh = P.mesh;
    editor.pushHistory({ label: '2D texture paint', undo: () => { t.ctx.putImageData(a, 0, 0); t.texture.needsUpdate = true; draw(); }, redo: () => { t.ctx.putImageData(b, 0, 0); t.texture.needsUpdate = true; draw(); } }); void mesh;
    status('Painted the texture · Ctrl+Z to undo'); draw();
  }
  // one dab at (u,v); r in texture pixels. Used by the 2D view and by the Shader tab's 3D texture brush.
  function paintDab(mesh, u, v, r, o = {}, internal = false) {
    const t = texFor(mesh); if (!t) return false; const res = t.res, g = t.ctx, cx = u * res, cy = (1 - v) * res, R = Math.max(1, r), tool = o.tool || 'brush';
    const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R)), x1 = Math.min(res, Math.ceil(cx + R)), y1 = Math.min(res, Math.ceil(cy + R)); if (x1 <= x0 || y1 <= y0) return true;
    const img = g.getImageData(x0, y0, x1 - x0, y1 - y0), d = img.data, col = new THREE.Color(o.color || '#ffffff'), cr = Math.round(col.r * 255), cg = Math.round(col.g * 255), cb = Math.round(col.b * 255);
    const base = tool === 'eraser' ? baseImg.get(mesh) : null, w = x1 - x0, src = tool === 'soften' ? d.slice() : null, soft = o.falloff !== 'hard';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R; if (dd > 1) continue; const f = (soft ? (1 - dd * dd) ** 1.5 : 1) * (o.opacity ?? 1), i = ((y - y0) * w + (x - x0)) * 4;
      if (tool === 'soften') { let s0 = 0, s1 = 0, s2 = 0, n = 0; for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) { const xx = x - x0 + k, yy = y - y0 + j; if (xx < 0 || yy < 0 || xx >= w || yy >= y1 - y0) continue; const q = (yy * w + xx) * 4; s0 += src[q]; s1 += src[q + 1]; s2 += src[q + 2]; n++; }
        d[i] += (s0 / n - d[i]) * f; d[i + 1] += (s1 / n - d[i + 1]) * f; d[i + 2] += (s2 / n - d[i + 2]) * f; continue; }
      let tr = cr, tg = cg, tb = cb; if (base) { const q = (y * res + x) * 4; tr = base.data[q]; tg = base.data[q + 1]; tb = base.data[q + 2]; }
      d[i] += (tr - d[i]) * f; d[i + 1] += (tg - d[i + 1]) * f; d[i + 2] += (tb - d[i + 2]) * f; d[i + 3] = 255;
    }
    g.putImageData(img, x0, y0); t.texture.needsUpdate = true; if (!internal) draw(); return true;
  }
  function floodFill(t, u, v, color, op) {
    const res = t.res, X = Math.floor(u * res), Y = Math.floor((1 - v) * res); if (X < 0 || Y < 0 || X >= res || Y >= res) return 0;
    const img = t.ctx.getImageData(0, 0, res, res), d = img.data, i0 = (Y * res + X) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], tol = 40, seen = new Uint8Array(res * res), st = [Y * res + X];
    const c = new THREE.Color(color), cr = c.r * 255, cg = c.g * 255, cb = c.b * 255; let n = 0;
    while (st.length) { const p = st.pop(); if (seen[p]) continue; seen[p] = 1; const i = p * 4; if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > tol) continue;
      d[i] += (cr - d[i]) * op; d[i + 1] += (cg - d[i + 1]) * op; d[i + 2] += (cb - d[i + 2]) * op; n++; const x = p % res, y = (p / res) | 0;
      if (x > 0) st.push(p - 1); if (x < res - 1) st.push(p + 1); if (y > 0) st.push(p - res); if (y < res - 1) st.push(p + res); }
    t.ctx.putImageData(img, 0, 0); t.texture.needsUpdate = true; status(`Filled ${n.toLocaleString()} pixels`); return n;
  }

  // ---------------------------------------------------------- operations
  function setGeometry(mesh, g) {
    const old = mesh.geometry; mesh.geometry = g; mesh.traverse((c) => { if (c !== mesh && c.geometry === old) c.geometry = g; });
    if (editor.mode === 'edit' && editor.debug.E?.mesh === mesh) editor.rebuildEdit();
    topoCache = null; overlay3D(); seamOverlay(); ctx.updateInfo?.();
  }
  function commit(mesh, uv, label, m = M(mesh)) {
    const before = mesh.geometry, after = UV.writeUVs(mesh, uv, m);
    setGeometry(mesh, after); editor.pushHistory({ label, undo: () => setGeometry(mesh, before), redo: () => setGeometry(mesh, after) });
    wireKey = ''; info(mesh, stretchOf(mesh).mean); draw(); return after;
  }
  function info(mesh, mean) { const m = M(mesh), isl = islandsOf(mesh).charts.length; $('uvInfo').textContent = `${isl} island${isl === 1 ? '' : 's'} · ${m.nt.toLocaleString()} faces · avg stretch ${(mean * 100).toFixed(1)}%`; }
  function run(op, o = {}) {
    if (editor.mode === 'sculpt') editor.setMode('object');
    const mesh = target(); if (!mesh) { status('Select an object first'); return null; }
    const t0 = performance.now(), m = M(mesh); let r;
    const need = ['pack', 'average', 'minimize'].includes(op);
    if (need && !mesh.geometry.attributes.uv) { status('No UVs yet: Unwrap or Smart UV Project first'); return null; }
    const P = { ...opt, ...o };
    const selT = need ? (() => { const s = selectedTris(mesh, m); if (!s.length) return null; const a = new Uint8Array(m.nt); for (const t of s) a[t] = 1; return a; })() : null;
    switch (op) {
      case 'unwrap': r = UV.unwrap(m, { method: P.method, margin: P.margin }); break;
      case 'smart': r = UV.smartProject(m, { angle: P.angle, margin: P.margin, areaWeight: P.areaW }); break;
      case 'cube': r = UV.cubeProject(m, { size: P.cube }); break;
      case 'cylinder': r = UV.cylinderProject(m); break;
      case 'sphere': r = UV.sphereProject(m); break;
      case 'view': { const c = ctx.camera(); mesh.updateMatrixWorld(true); const mvp = new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse).multiply(mesh.matrixWorld); r = UV.viewProject(m, mvp); break; }
      case 'reset': r = UV.resetUV(m); break;
      case 'pack': r = UV.pack(m, m.UV.slice(), { margin: P.margin, rotate: P.rotate, average: false, selected: selT }); break;
      case 'average': r = UV.pack(m, m.UV.slice(), { margin: P.margin, rotate: false, average: true, selected: selT }); break;
      case 'minimize': r = UV.minimizeStretch(m, { iterations: P.iters, selected: selT }); break;
      default: return null;
    }
    const label = { unwrap: `Unwrap (${P.method === 'angle' ? 'angle based' : 'conformal'})`, smart: 'Smart UV Project', cube: 'Cube Projection', cylinder: 'Cylinder Projection', sphere: 'Sphere Projection', view: 'Project from View', reset: 'Reset UVs', pack: 'Pack Islands', average: 'Average Island Scale', minimize: 'Minimize Stretch' }[op];
    commit(mesh, r.uv, label, m); const ms = performance.now() - t0, st = stretchOf(mesh);
    status(`${label}: ${islandsOf(mesh).charts.length} islands · avg stretch ${(st.mean * 100).toFixed(1)}% · ${ms.toFixed(0)} ms`);
    return { op, islands: islandsOf(mesh).charts.length, stretch: st.mean, ms, iters: r.iters };
  }
  // seams (Edit Mode edges)
  function markSeam(on) {
    const E = editor.debug.E; if (!E || editor.mode !== 'edit') { status('Seams are marked in Edit Mode: Tab, press 2 for edges, select, then Mark Seam'); return 0; }
    const edges = editor.selectedEdgesW(); if (!edges.length) { status('Select some edges first'); return 0; }
    const mesh = E.mesh, set = getSeams(mesh.geometry), before = new Set(set), U = E.U; let n = 0;
    for (const [a, b] of edges) { const ka = pkey(U[a * 3], U[a * 3 + 1], U[a * 3 + 2]), kb = pkey(U[b * 3], U[b * 3 + 1], U[b * 3 + 2]), k = ka < kb ? ka + '|' + kb : kb + '|' + ka; if (on && !set.has(k)) { set.add(k); n++; } if (!on && set.delete(k)) n++; }
    const after = new Set(set), geo = mesh.geometry; const apply = (s) => { const g = getSeams(geo); g.clear(); for (const k of s) g.add(k); seamOverlay(); };
    editor.pushHistory({ label: on ? 'Mark Seam' : 'Clear Seam', undo: () => apply(before), redo: () => apply(after) }); seamOverlay();
    status(`${on ? 'Marked' : 'Cleared'} ${n} seam edge${n === 1 ? '' : 's'} (${set.size} total)`); return n;
  }
  function markSeamsByKeys(mesh, keys, on = true) { const s = getSeams(mesh.geometry); for (const k of keys) on ? s.add(k) : s.delete(k); seamOverlay(); return s.size; }
  function seamsFromIslands() { const mesh = target(); if (!mesh?.geometry.attributes.uv) return 0; const m = M(mesh), I2 = UV.uvIslands(m), s = getSeams(mesh.geometry), before = new Set(s); let n = 0;
    for (const l of m.E.values()) { if (l.length === 4 && I2.chartOf[l[0]] === I2.chartOf[l[2]]) { // same island: still a seam if UVs differ along the edge
        const a = m.T[l[0] * 3 + l[1]], b = m.T[l[0] * 3 + (l[1] + 1) % 3]; const c1 = [0, 1, 2].map((k) => l[2] * 3 + k).filter((c) => m.T[c] === a || m.T[c] === b), c0 = [l[0] * 3 + l[1], l[0] * 3 + (l[1] + 1) % 3];
        const same = c0.every((c) => c1.some((d) => m.T[d] === m.T[c] && Math.abs(m.UV[d * 2] - m.UV[c * 2]) + Math.abs(m.UV[d * 2 + 1] - m.UV[c * 2 + 1]) < 1e-6)); if (same) continue; }
      if (l.length !== 4) continue; const a = m.T[l[0] * 3 + l[1]], b = m.T[l[0] * 3 + (l[1] + 1) % 3], ka = m.keys[a], kb = m.keys[b], k = ka < kb ? ka + '|' + kb : kb + '|' + ka; if (!s.has(k)) { s.add(k); n++; } }
    const after = new Set(s), geo = mesh.geometry, apply = (x) => { const g = getSeams(geo); g.clear(); for (const k of x) g.add(k); seamOverlay(); };
    editor.pushHistory({ label: 'Seams from Islands', undo: () => apply(before), redo: () => apply(after) }); seamOverlay(); status(`Seams from islands: ${n} edges added`); return n; }
  function clearAllSeams() { const mesh = target(); if (!mesh) return; const s = getSeams(mesh.geometry), before = new Set(s), geo = mesh.geometry; s.clear(); editor.pushHistory({ label: 'Clear all seams', undo: () => { for (const k of before) getSeams(geo).add(k); seamOverlay(); }, redo: () => { getSeams(geo).clear(); seamOverlay(); } }); seamOverlay(); status('All seams cleared'); }
  // overlays in 3D
  let seamLines = null, stretchMesh = null;
  const seamMat = new THREE.LineBasicMaterial({ color: 0xff5a3c, depthTest: true });
  function seamOverlay() {
    if (seamLines) { seamLines.parent?.remove(seamLines); seamLines.geometry.dispose(); seamLines = null; }
    const mesh = target(); if (!mesh || !(editor.mode === 'edit' || ctx.isActiveWS())) return; const s = getSeams(mesh.geometry, false); if (!s || !s.size) return;
    const pos = mesh.geometry.attributes.position, nrm = mesh.geometry.attributes.normal, idx = mesh.geometry.index, nt = triCount(mesh.geometry), out = [], done = new Set();
    mesh.geometry.computeBoundingSphere(); const lift = (mesh.geometry.boundingSphere?.radius || 1) * 0.004; // lift off the surface so the edit wire / stretch overlay do not hide the seams
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const ia = idx ? idx.getX(t * 3 + k) : t * 3 + k, ib = idx ? idx.getX(t * 3 + (k + 1) % 3) : t * 3 + (k + 1) % 3;
      const ka = pkey(pos.getX(ia), pos.getY(ia), pos.getZ(ia)), kb = pkey(pos.getX(ib), pos.getY(ib), pos.getZ(ib)), key = ka < kb ? ka + '|' + kb : kb + '|' + ka; if (!s.has(key) || done.has(key)) continue; done.add(key);
      for (const i of [ia, ib]) out.push(pos.getX(i) + (nrm ? nrm.getX(i) * lift : 0), pos.getY(i) + (nrm ? nrm.getY(i) * lift : 0), pos.getZ(i) + (nrm ? nrm.getZ(i) * lift : 0)); }
    if (!out.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    seamLines = new THREE.LineSegments(g, seamMat); seamLines.userData.isOverlay = true; seamLines.renderOrder = 6; seamLines.raycast = () => {}; mesh.add(seamLines);
  }
  function overlay3D() {
    if (stretchMesh) { stretchMesh.parent?.remove(stretchMesh); stretchMesh.geometry.dispose(); stretchMesh = null; }
    const mesh = target(); if (!opt.stretch || !mesh?.geometry.attributes.uv || !ctx.isActiveWS()) return;
    const m = M(mesh), { S } = UV.stretch(m), P = m.P, T = m.T, pos = new Float32Array(m.nt * 9), col = new Float32Array(m.nt * 9);
    for (let t = 0; t < m.nt; t++) { const c = UV.stretchColor(S[t]); for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; pos.set([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], (t * 3 + k) * 3); col.set(c, (t * 3 + k) * 3); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    stretchMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); stretchMesh.userData.isOverlay = true; stretchMesh.raycast = () => {}; mesh.add(stretchMesh);
  }
  // import / export
  function save(blob, name) { editor.save(blob, name); }
  function exportLayout(size = 1024) { const mesh = target(); if (!mesh?.geometry.attributes.uv) { status('No UVs to export'); return null; } const c = UV.layoutCanvas(M(mesh), { size, fill: opt.stretch });
    return new Promise((res) => c.toBlob((b) => { save(b, `${(mesh.name || 'mesh').replace(/\W+/g, '_')}_uv_layout.png`); status(`UV layout PNG ${size}×${size} saved`); res(b); }, 'image/png')); }
  function exportJSON() { const mesh = target(); if (!mesh?.geometry.attributes.uv) { status('No UVs to export'); return null; } const j = UV.uvJSON(M(mesh), mesh.name); save(new Blob([JSON.stringify(j)], { type: 'application/json' }), `${(mesh.name || 'mesh').replace(/\W+/g, '_')}_uv.json`); return j; }
  async function importFile(f) {
    const mesh = target(); if (!mesh) { status('Select the object that should receive the UVs first'); return null; }
    try {
      const m = M(mesh), name = f.name.toLowerCase(); let r;
      if (name.endsWith('.json')) r = UV.parseUVJSON(m, JSON.parse(await f.text()));
      else {
        let root;
        if (name.endsWith('.obj')) root = parseOBJ(await f.text());
        else { const { GLTFLoader } = await import('three/addons/GLTFLoader.js'); const buf = await f.arrayBuffer(); root = (await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej))).scene; }
        root.updateMatrixWorld(true); const srcs = []; root.traverse((o) => { if (o.isMesh && o.geometry.attributes.uv) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); srcs.push(g); } });
        // compare in the target's local space when shapes were exported with transforms baked in
        r = UV.transferUVs(m, srcs);
        if (!r || r.matched + r.partial / 3 < m.nt * 0.5) { mesh.updateMatrixWorld(true); const inv = mesh.matrixWorld.clone().invert(); const s2 = srcs.map((g) => g.clone().applyMatrix4(inv)); const r2 = UV.transferUVs(m, s2); if (r2 && (!r || r2.matched > r.matched)) r = r2; }
        if (!r) throw new Error('that file has no UVs'); if (!r.matched && !r.partial) throw new Error('no triangles of that file match this object (it must be the same mesh)');
      }
      commit(mesh, r.uv, 'Import UVs'); status(`Imported UVs from ${f.name}${r.total ? ` · ${r.matched}/${r.total} faces matched exactly` : ''}`); return r;
    } catch (err) { status('UV import failed: ' + err.message); return null; }
  }
  async function importText(name, text) { return importFile(new File([text], name)); }
  // small OBJ reader (positions + texture coordinates only; n-gons fanned), original code
  function parseOBJ(text) {
    const v = [], vt = [], pos = [], uv = []; let missing = 0;
    const idx = (s, n) => { const i = parseInt(s, 10); return i < 0 ? n + i : i - 1; };
    for (const raw of text.split('\n')) { const l = raw.trim(); if (!l || l[0] === '#') continue; const p = l.split(/\s+/);
      if (p[0] === 'v') v.push(+p[1], +p[2], +p[3]); else if (p[0] === 'vt') vt.push(+p[1], +p[2]);
      else if (p[0] === 'f') { const c = p.slice(1).map((q) => q.split('/')); for (let k = 1; k + 1 < c.length; k++) for (const q of [c[0], c[k], c[k + 1]]) { const a = idx(q[0], v.length / 3); pos.push(v[a * 3], v[a * 3 + 1], v[a * 3 + 2]); if (q[1]) { const b = idx(q[1], vt.length / 2); uv.push(vt[b * 2], vt[b * 2 + 1]); } else { uv.push(0, 0); missing++; } } } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (vt.length && missing < pos.length / 3) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const root = new THREE.Group(); root.add(new THREE.Mesh(g)); return root;
  }
  // ensure UVs for texture creation
  function ensureUV(mesh) { if (mesh.geometry.attributes.uv) return false; const before = editor.sel; void before; const m = UV.topo(mesh.geometry), r = UV.smartProject(m, { angle: 66, margin: 0.02 }); commit(mesh, r.uv, 'Smart UV Project (for texture)', m); status('The object had no UVs, so Smart UV Project made them first'); return true; }
  // AI hooks
  function renderTools() { const h = $('uvTools'); h.innerHTML = ''; for (const t of registry) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = t.label; b.title = t.id; b.onclick = () => runTool(t.id); h.appendChild(b); } }
  async function runTool(id) {
    const t = registry.find((x) => x.id === id), mesh = target(); if (!t || !mesh) return null; const m = M(mesh);
    const c = { mesh, THREE, topology: { positions: m.P, triangles: m.T, faceCount: m.nt }, uv: m.UV.slice(), selectedFaces: selectedTris(mesh, m), texture: mats.texOf(mesh)?.canvas || null, status,
      apply: (uv, label = t.label) => { if (!(uv instanceof Float32Array) || uv.length !== m.nt * 6) throw new Error(`apply(uv) needs a Float32Array of ${m.nt * 6} values (per-corner UVs)`); commit(mesh, uv, label, m); return true; },
      textureChanged: () => { const tx = mats.texOf(mesh); if (tx) tx.texture.needsUpdate = true; draw(); }, algorithms: UV };
    try { const out = await t.run(c); draw(); return out ?? true; } catch (err) { status(`${t.label} failed: ${err.message}`); return null; }
  }
  function registerUVTool(t) { if (!t || typeof t.id !== 'string' || typeof t.run !== 'function') throw new Error('registerUVTool needs {id, label, run(ctx)}'); const i = registry.findIndex((x) => x.id === t.id); const e = { id: t.id, label: String(t.label || t.id), run: t.run }; if (i >= 0) registry[i] = e; else registry.push(e); renderTools(); return t.id; }
  // U menu in the 3D view (Edit Mode, or Object Mode in the UV workspace)
  const umenu = document.createElement('div'); umenu.className = 'mlmenu uvmenu'; umenu.hidden = true; document.body.appendChild(umenu);
  const UITEMS = [['unwrap', 'Unwrap'], ['smart', 'Smart UV Project'], ['cube', 'Cube Projection'], ['cylinder', 'Cylinder Projection'], ['sphere', 'Sphere Projection'], ['view', 'Project from View'], ['reset', 'Reset']];
  umenu.innerHTML = '<b>UV</b>' + UITEMS.map(([k, l]) => `<button data-u="${k}">${l}</button>`).join('');
  umenu.querySelectorAll('button').forEach((b) => b.onclick = () => { umenu.hidden = true; run(b.dataset.u); });
  let lastXY = [200, 200]; addEventListener('pointermove', (e) => { lastXY = [e.clientX, e.clientY]; }, true);
  addEventListener('pointerdown', (e) => { if (!umenu.hidden && !umenu.contains(e.target)) umenu.hidden = true; }, true);
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && !umenu.hidden) { umenu.hidden = true; return; }
    if (e.key.toLowerCase() !== 'u' || hover || editor.mode === 'sculpt' || !target()) return;
    if (!(editor.mode === 'edit' || ctx.isActiveWS())) return;
    e.preventDefault(); e.stopImmediatePropagation(); umenu.style.left = Math.min(innerWidth - 200, lastXY[0]) + 'px'; umenu.style.top = Math.min(innerHeight - 240, lastXY[1]) + 'px'; umenu.hidden = false;
  }, true);
  // show / hide
  function show(on) { wrap.hidden = !on; document.body.classList.toggle('uvsplit', on); if (on) { requestAnimationFrame(() => { fit(); seamOverlay(); overlay3D(); const m = target(); if (m?.geometry.attributes.uv) info(m, stretchOf(m).mean); }); } else { overlay3D(); seamOverlay(); } }
  let lastKey = '';
  function tick() { if (wrap.hidden && editor.mode !== 'edit') { if (seamLines && !ctx.isActiveWS()) seamOverlay(); return; } const m = target(); const k = `${m?.uuid}|${m?.geometry.uuid}|${editor.mode}|${opt.sync ? editor.faceSelection().length : ''}`; if (k !== lastKey) { lastKey = k; topoCache = null; seamOverlay(); overlay3D(); draw(); } }
  return { show, draw, tick, run, markSeam, markSeamsByKeys, seamsFromIslands, clearAllSeams, exportLayout, exportJSON, importFile, importText, ensureUV, paintDab, floodFill, registerUVTool, runTool, transformSelected,
    selectAll: () => { const mesh = target(); if (!mesh?.geometry.attributes.uv) return 0; const m = M(mesh); setSelTris(mesh, m, [...Array(m.nt).keys()], false); draw(); return m.nt; },
    selectIslandAt: (u, v, add) => { const mesh = target(), m = M(mesh), isl = islandAt(m, u, v); if (isl) setSelTris(mesh, m, isl, add); draw(); return isl ? isl.length : 0; },
    stats: () => { const mesh = target(); if (!mesh?.geometry.attributes.uv) return null; const m = M(mesh); return { islands: islandsOf(mesh).charts.length, faces: m.nt, stretch: stretchOf(mesh).mean, seams: getSeams(mesh.geometry, false)?.size || 0, uvMin: mm(m.UV, Math.min, Infinity), uvMax: mm(m.UV, Math.max, -Infinity) }; },
    setTool, opt, view, fit, openUMenu: () => { umenu.hidden = false; return umenu.querySelectorAll('button').length; }, startModal, updateModal, endModal, textureChanged: () => draw(), get el() { return wrap; }, tools: () => registry.map((t) => ({ id: t.id, label: t.label })) };
}
