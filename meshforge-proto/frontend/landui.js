// MeshForge Landscape mode UI (v4): paint canvas, regions, sliders, randomize, export. Original MIT code.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/GLTFExporter.js';
import { OBJExporter } from 'three/addons/OBJExporter.js';
import { STLExporter } from 'three/addons/STLExporter.js';
import { PLYExporter } from 'three/addons/PLYExporter.js';
import { MAP, CLASSES, DEFAULTS, createBuilder, randomPaint, randomRegions, extent } from './landscape.js';

export function initLandscape(ctx) {
  const { scene, controls } = ctx;
  const state = { params: DEFAULTS(), paint: new Uint8Array(MAP * MAP).fill(1), hmap: null, regions: [] };
  const builder = createBuilder(); builder.group.visible = false; scene.add(builder.group);
  const UI = { tool: 'brush', colour: 1, size: 12, sel: -1, draft: null, active: false };
  let result = null, timer = 0, saved = null;
  const status = (m) => ctx.status(m);

  // ---------- panel ----------
  const panel = document.createElement('div'); panel.id = 'landPanel'; panel.hidden = true;
  const sw = CLASSES.map((c, i) => `<button class="swatch" data-c="${i}" title="${c.name}" style="background:rgb(${c.rgb})"></button>`).join('');
  panel.innerHTML = `
  <details open><summary>Paint map</summary>
    <div class="seg sm" id="lTools"><button data-t="brush" class="on" title="Paint (B)">Brush</button><button data-t="erase" title="Erase to grass (E)">Erase</button><button data-t="lasso" title="Lasso region: click points, double-click / Enter to close">Lasso</button><button data-t="rect" title="Rectangle region (drag)">Rect</button><button data-t="circle" title="Circle region (drag from centre)">Circle</button></div>
    <div class="palette">${sw}<span id="lColName">Grass</span></div>
    <div class="row"><span>Brush size</span><input id="lBrush" type="range" min="1" max="60" value="12"><b id="lBrushV">12</b></div>
    <div class="paintwrap" id="lWrap"><canvas id="lPaint" width="${MAP}" height="${MAP}"></canvas><canvas id="lOver" width="${MAP}" height="${MAP}"></canvas></div>
    <div class="hint0" id="lHint">Drop a painted map or a black-and-white height map on the canvas.</div>
    <div class="row"><button class="btn" id="lFill">Fill colour</button><button class="btn" id="lClear">Clear</button></div>
    <div class="row"><button class="btn" id="lLoadPaint">Load painted…</button><button class="btn" id="lLoadH">Load height map…</button></div>
    <div class="row"><button class="btn" id="lClearH" disabled>Stop using height map</button></div>
    <input type="file" id="lFile" accept="image/*" hidden>
  </details>
  <details open><summary>Regions (cliffs, hills, plateaus)</summary>
    <ul id="lRegions"></ul>
    <div id="lRegEdit" hidden>
      <div class="row"><span>Name</span><input id="rName" class="txt"></div>
      <div class="row"><span>Height (m)</span><input id="rOff" type="range" min="-10" max="20" step="0.1"><b id="rOffV"></b></div>
      <div class="row"><span>Blend (m)</span><input id="rBlend" type="range" min="0" max="6" step="0.05"><b id="rBlendV"></b></div>
      <label class="row chk"><input id="rPlat" type="checkbox"> Plateau (flatten the top)</label>
      <div class="row"><button class="btn" id="rUp">▲ Up</button><button class="btn" id="rDown">▼ Down</button><button class="btn" id="rDel">Delete</button></div>
    </div>
    <div class="hint0">Height is relative to the ground around it. Blend 0 = sharp cliff; larger = gentle hill. Regions apply top to bottom, so stacking makes terraces.</div>
  </details>
  <details open><summary>Terrain</summary><div id="lTerrain"></div></details>
  <details open><summary>Water</summary><div id="lWater"></div></details>
  <details open><summary>Buildings</summary><div id="lBuild"></div>
    <div class="row"><button class="btn" id="lGlb">Load house module (.glb)…</button><button class="btn" id="lGlbReset">Default</button></div><input type="file" id="lGlbFile" accept=".glb,.gltf" hidden></details>
  <details open><summary>Randomize</summary>
    <div class="row"><span>Seed</span><input id="lSeed" class="txt" type="number" value="1"><button class="btn" id="lDice" title="New random seed">🎲</button></div>
    <label class="row chk"><input id="lRandReg" type="checkbox" checked> Add random cliffs / hills</label>
    <button class="primary" id="lRandom">Randomize map</button>
  </details>
  <details open><summary>Export</summary>
    <label class="row chk"><input id="lExB" type="checkbox" checked> Buildings <input id="lExW" type="checkbox" checked> Water</label>
    <div class="row"><button class="btn" data-lx="glb">GLB</button><button class="btn" data-lx="obj">OBJ</button><button class="btn" data-lx="stl">STL</button><button class="btn" data-lx="ply">PLY</button></div>
    <div class="row"><button class="btn" id="lHpng">Height map PNG</button><button class="btn" id="lPpng">Painted map PNG</button></div>
    <div class="row"><button class="btn" id="lSave">Save project (.json)</button><button class="btn" id="lLoad">Open project…</button></div>
    <input type="file" id="lJson" accept=".json,application/json" hidden>
  </details>`;
  document.querySelector('.props').appendChild(panel);
  const $ = (id) => panel.querySelector('#' + id);

  // sliders bound to state.params paths
  const get = (p) => p.split('.').reduce((o, k) => o[k], state.params);
  const set = (p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], state.params)[last] = v; };
  const binders = [];
  function slider(host, label, path, min, max, step, fmt = (v) => (+v).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0), heavy = false) {
    const row = document.createElement('div'); row.className = 'row'; row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><b></b>`;
    const inp = row.querySelector('input'), out = row.querySelector('b');
    const sync = () => { inp.value = get(path); out.textContent = fmt(get(path)); }; sync(); binders.push(sync);
    inp.oninput = () => { set(path, +inp.value); out.textContent = fmt(inp.value); schedule(heavy ? 250 : 120); };
    $(host).appendChild(row);
  }
  function check(host, label, path) {
    const row = document.createElement('label'); row.className = 'row chk'; row.innerHTML = `<input type="checkbox"> ${label}`;
    const inp = row.querySelector('input'), sync = () => { inp.checked = !!get(path); }; sync(); binders.push(sync);
    inp.onchange = () => { set(path, inp.checked); schedule(30); }; $(host).appendChild(row);
  }
  slider('lTerrain', 'Grid', 'res', 64, 256, 32, (v) => `${v}²`, true);
  slider('lTerrain', 'Width', 'width', 5, 400, 1, (v) => `${v} m`, true);
  slider('lTerrain', 'Depth', 'depth', 5, 400, 1, (v) => `${v} m`, true);
  slider('lTerrain', 'Sand height', 'base.sand', -3, 6, 0.05);
  slider('lTerrain', 'Grass height', 'base.grass', -3, 8, 0.05);
  slider('lTerrain', 'Water bed', 'base.water', -6, 2, 0.05);
  slider('lTerrain', 'Mountain', 'base.mountain', 0, 20, 0.1);
  slider('lTerrain', 'Noise amount', 'noiseAmp', 0, 3, 0.05);
  slider('lTerrain', 'Noise scale', 'noiseScale', 0.5, 16, 0.5);
  slider('lTerrain', 'Octaves', 'octaves', 1, 6, 1);
  slider('lTerrain', 'Edge blend', 'blend', 0, 5, 0.05, (v) => `${(+v).toFixed(2)} m`);
  slider('lTerrain', 'H-map low', 'hmapMin', -6, 5, 0.1);
  slider('lTerrain', 'H-map high', 'hmapMax', 0, 25, 0.1);
  check('lTerrain', 'Debug colour view (palette colours)', 'debugColour');
  check('lWater', 'Show water plane', 'showWater');
  slider('lWater', 'Water level', 'waterLevel', -4, 6, 0.05, (v) => `${(+v).toFixed(2)} m`);
  check('lBuild', 'Scatter buildings', 'scatter.on');
  slider('lBuild', 'Density', 'scatter.density', 0, 1, 0.05);
  slider('lBuild', 'Min spacing', 'scatter.spacing', 0.6, 5, 0.1, (v) => `${(+v).toFixed(1)} m`);
  slider('lBuild', 'Max slope', 'scatter.maxSlope', 1, 45, 1, (v) => `${v}°`);
  slider('lBuild', 'Cliff clearance', 'scatter.avoidCliff', 0, 3, 0.1, (v) => `${(+v).toFixed(1)} m`);
  slider('lBuild', 'Tall buildings', 'scatter.tall', 0, 1, 0.05);
  slider('lBuild', 'Scale min', 'scatter.scaleMin', 0.3, 2, 0.05);
  slider('lBuild', 'Scale max', 'scatter.scaleMax', 0.3, 3, 0.05);
  check('lBuild', 'On grass', 'scatter.onGrass'); check('lBuild', 'On sand', 'scatter.onSand'); check('lBuild', 'Random rotation', 'scatter.rotate');
  const syncAll = () => { binders.forEach((f) => f()); $('lSeed').value = state.params.seed; $('lClearH').disabled = !state.hmap; renderRegions(); drawPaint(); };

  // ---------- rebuild (debounced) ----------
  function schedule(ms = 120) { clearTimeout(timer); timer = setTimeout(rebuild, ms); }
  function rebuild() {
    clearTimeout(timer); const t0 = performance.now(); result = builder.build(state);
    const ms = performance.now() - t0, n = state.params.res;
    const { width, depth } = extent(state.params);
    if (UI.active) { status(`Landscape · ${width}×${depth} m · ${n}² grid · ${(2 * n * n).toLocaleString()} tris · ${result.buildings.length} spawned · rebuilt in ${ms.toFixed(0)} ms`); ctx.setInfo(`Landscape<br><small>${width}×${depth} m · ${(2 * n * n).toLocaleString()} tris · ${result.buildings.length} spawned</small>`); }
    return result;
  }

  // ---------- paint canvas ----------
  const pc = $('lPaint'), pg = pc.getContext('2d'), oc = $('lOver'), og = oc.getContext('2d'), img = pg.createImageData(MAP, MAP);
  let drawQueued = false;
  function drawPaint() {
    drawQueued = false; const d = img.data;
    for (let i = 0; i < MAP * MAP; i++) {
      let c = CLASSES[state.paint[i]].rgb;
      if (state.hmap) { const g = state.hmap[i] * 255; c = [g * 0.7 + c[0] * 0.3, g * 0.7 + c[1] * 0.3, g * 0.7 + c[2] * 0.3]; }
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
    pg.putImageData(img, 0, 0); drawOverlay();
  }
  const queueDraw = () => { if (!drawQueued) { drawQueued = true; requestAnimationFrame(drawPaint); } };
  function shapePath(g, r) {
    const p = r.pts, M = MAP; g.beginPath();
    if (r.type === 'rect') g.rect(Math.min(p[0][0], p[1][0]) * M, Math.min(p[0][1], p[1][1]) * M, Math.abs(p[1][0] - p[0][0]) * M, Math.abs(p[1][1] - p[0][1]) * M);
    else if (r.type === 'circle') g.arc(p[0][0] * M, p[0][1] * M, Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) * M, 0, 7);
    else { p.forEach(([x, y], i) => i ? g.lineTo(x * M, y * M) : g.moveTo(x * M, y * M)); if (r !== UI.draft) g.closePath(); }
  }
  function drawOverlay() {
    og.clearRect(0, 0, MAP, MAP); og.lineWidth = 1.5;
    state.regions.forEach((r, i) => { shapePath(og, r); og.setLineDash(r.blend < 0.2 ? [] : [4, 3]); og.strokeStyle = i === UI.sel ? '#e8963a' : '#ffffffcc'; og.fillStyle = i === UI.sel ? '#e8963a33' : '#ffffff18'; og.fill(); og.stroke(); });
    if (UI.draft) { og.setLineDash([3, 3]); og.strokeStyle = '#fff'; shapePath(og, UI.draft); og.stroke(); }
    og.setLineDash([]);
  }
  const uv = (e) => { const r = pc.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  function dab(u, v, c) {
    const R = UI.size / 2, cx = u * MAP, cy = v * MAP;
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(MAP - 1, Math.ceil(cy + R)); y++)
      for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(MAP - 1, Math.ceil(cx + R)); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= R * R) state.paint[y * MAP + x] = c;
  }
  function stroke(a, b, c) { const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * MAP / Math.max(1, UI.size / 4))); for (let s = 1; s <= steps; s++) dab(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps, c); }
  let drag = null;
  oc.addEventListener('pointerdown', (e) => {
    oc.setPointerCapture(e.pointerId); const p = uv(e);
    if (UI.tool === 'brush' || UI.tool === 'erase') { const c = UI.tool === 'erase' ? 1 : UI.colour; drag = { last: p, c }; dab(p[0], p[1], c); queueDraw(); schedule(150); }
    else if (UI.tool === 'rect' || UI.tool === 'circle') { UI.draft = { type: UI.tool, pts: [p, p] }; drag = { shape: true }; }
    else if (UI.tool === 'lasso') { if (!UI.draft) UI.draft = { type: 'poly', pts: [p] }; else UI.draft.pts.push(p); drag = { lasso: true }; drawOverlay(); }
  });
  oc.addEventListener('pointermove', (e) => {
    if (!drag) { if (UI.draft?.type === 'poly') { const p = uv(e); const pts = UI.draft.pts; UI.draft = { ...UI.draft, pts: [...pts] }; UI.draft.pts.push(p); drawOverlay(); UI.draft.pts.pop(); } return; }
    const p = uv(e);
    if (drag.c !== undefined) { stroke(drag.last, p, drag.c); drag.last = p; queueDraw(); schedule(150); }
    else if (drag.shape) { UI.draft.pts[1] = p; drawOverlay(); }
    else if (drag.lasso && e.buttons) { const l = UI.draft.pts.at(-1); if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.012) UI.draft.pts.push(p); drawOverlay(); } // freehand lasso while held
  });
  oc.addEventListener('pointerup', () => {
    if (drag?.shape) { const p = UI.draft.pts; if (Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) > 0.01) addRegion(UI.draft); UI.draft = null; drawOverlay(); }
    else if (drag?.lasso && UI.draft.pts.length > 8) closeLasso();   // freehand drag closes automatically
    drag = null;
  });
  oc.addEventListener('dblclick', closeLasso);
  function closeLasso() { if (UI.draft?.type === 'poly' && UI.draft.pts.length >= 3) addRegion(UI.draft); UI.draft = null; drawOverlay(); }
  function addRegion(d) {
    const r = { name: `${{ poly: 'Lasso', rect: 'Rect', circle: 'Circle' }[d.type]} ${state.regions.length + 1}`, type: d.type, pts: d.pts.map((p) => [+p[0].toFixed(4), +p[1].toFixed(4)]), offset: 3, blend: 0.05, plateau: true };
    state.regions.push(r); UI.sel = state.regions.length - 1; renderRegions(); schedule(30); return r;
  }
  function renderRegions() {
    const ul = $('lRegions');
    ul.innerHTML = state.regions.map((r, i) => `<li data-i="${i}" class="${i === UI.sel ? 'sel' : ''}"><b>${r.name}</b><span>${r.offset > 0 ? '+' : ''}${r.offset} m · ${r.blend < 0.2 ? 'cliff' : 'blend ' + r.blend + ' m'}${r.plateau ? ' · plateau' : ''}</span><input type="checkbox" title="Enabled" ${r.hidden ? '' : 'checked'}></li>`).join('') || '<li class="empty">No regions. Pick Lasso, Rect or Circle and draw on the map.</li>';
    ul.querySelectorAll('li[data-i]').forEach((li) => {
      li.onclick = (e) => { if (e.target.type === 'checkbox') return; UI.sel = +li.dataset.i; renderRegions(); drawOverlay(); };
      li.querySelector('input').onchange = (e) => { state.regions[+li.dataset.i].hidden = !e.target.checked; schedule(30); };
    });
    const r = state.regions[UI.sel]; $('lRegEdit').hidden = !r; if (!r) return;
    $('rName').value = r.name; $('rOff').value = r.offset; $('rOffV').textContent = `${r.offset} m`; $('rBlend').value = r.blend; $('rBlendV').textContent = r.blend < 0.2 ? 'cliff' : `${r.blend} m`; $('rPlat').checked = r.plateau;
    drawOverlay();
  }
  const cur = () => state.regions[UI.sel];
  $('rName').oninput = (e) => { cur().name = e.target.value; renderRegionsLite(); };
  const renderRegionsLite = () => { const li = $('lRegions').querySelector(`li[data-i="${UI.sel}"] b`); if (li) li.textContent = cur().name; };
  $('rOff').oninput = (e) => { cur().offset = +e.target.value; renderRegions(); schedule(120); };
  $('rBlend').oninput = (e) => { cur().blend = +e.target.value; renderRegions(); schedule(120); };
  $('rPlat').onchange = (e) => { cur().plateau = e.target.checked; renderRegions(); schedule(30); };
  const move = (d) => { const i = UI.sel, j = i + d; if (j < 0 || j >= state.regions.length) return; [state.regions[i], state.regions[j]] = [state.regions[j], state.regions[i]]; UI.sel = j; renderRegions(); schedule(30); };
  $('rUp').onclick = () => move(-1); $('rDown').onclick = () => move(1);
  $('rDel').onclick = () => { state.regions.splice(UI.sel, 1); UI.sel = Math.min(UI.sel, state.regions.length - 1); renderRegions(); schedule(30); };

  function setTool(t) { UI.tool = t; UI.draft = null; panel.querySelectorAll('#lTools button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); drawOverlay(); $('lHint').textContent = { brush: 'Paint with the selected colour. Drop an image here to load it.', erase: 'Erase back to grass.', lasso: 'Drag to draw freehand, or click points and double-click (Enter) to close.', rect: 'Drag a rectangle to add a region.', circle: 'Drag from the centre to add a circular region.' }[t]; }
  function setColour(i) { UI.colour = i; panel.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', +b.dataset.c === i)); $('lColName').textContent = CLASSES[i].name; if (UI.tool === 'erase' || UI.tool !== 'brush') setTool('brush'); }
  panel.querySelectorAll('#lTools button').forEach((b) => b.onclick = () => setTool(b.dataset.t));
  panel.querySelectorAll('.swatch').forEach((b) => b.onclick = () => setColour(+b.dataset.c)); setColour(1); setTool('brush');
  $('lBrush').oninput = (e) => { UI.size = +e.target.value; $('lBrushV').textContent = UI.size; };
  $('lFill').onclick = () => { state.paint.fill(UI.colour); drawPaint(); schedule(30); };
  $('lClear').onclick = () => { state.paint.fill(1); state.hmap = null; state.regions = []; UI.sel = -1; syncAll(); schedule(30); };
  $('lClearH').onclick = () => { state.hmap = null; syncAll(); schedule(30); };

  // ---------- image import ----------
  async function imageToData(src) {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const c = document.createElement('canvas'); c.width = c.height = MAP; const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(im, 0, 0, MAP, MAP); return g.getImageData(0, 0, MAP, MAP).data;
  }
  function paintFromRGBA(d) { for (let i = 0; i < MAP * MAP; i++) { let best = 0, bd = 1e9; CLASSES.forEach((c, k) => { const dd = (d[i * 4] - c.rgb[0]) ** 2 + (d[i * 4 + 1] - c.rgb[1]) ** 2 + (d[i * 4 + 2] - c.rgb[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }); state.paint[i] = best; } }
  function hmapFromRGBA(d) {
    const h = new Float32Array(MAP * MAP); for (let i = 0; i < MAP * MAP; i++) h[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    state.hmap = h; const P = state.params, wl = (P.waterLevel - P.hmapMin) / (P.hmapMax - P.hmapMin);
    // classify for building rules: below water = water, just above = sand, high = mountain
    for (let i = 0; i < MAP * MAP; i++) state.paint[i] = h[i] < wl ? 2 : h[i] < wl + 0.04 ? 0 : h[i] > 0.7 ? 3 : 1;
  }
  async function loadImage(file, kind) {
    const url = URL.createObjectURL(file); try { const d = await imageToData(url); if (kind === 'height') hmapFromRGBA(d); else { state.hmap = null; paintFromRGBA(d); } syncAll(); rebuild(); status(`Loaded ${kind === 'height' ? 'height map' : 'painted map'} ${file.name}`); } finally { URL.revokeObjectURL(url); }
  }
  function looksGrey(d) { let s = 0; for (let i = 0; i < d.length; i += 64) s += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]); return s / (d.length / 64) < 6; }
  let fileKind = 'paint';
  $('lLoadPaint').onclick = () => { fileKind = 'paint'; $('lFile').click(); };
  $('lLoadH').onclick = () => { fileKind = 'height'; $('lFile').click(); };
  $('lFile').onchange = (e) => { const f = e.target.files[0]; if (f) loadImage(f, fileKind); e.target.value = ''; };
  const wrap = $('lWrap');
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); wrap.classList.add('over'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('over'));
  wrap.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); wrap.classList.remove('over'); const f = e.dataTransfer.files[0]; if (!f) return;
    if (/json$/i.test(f.name)) return loadProject(await f.text());
    const url = URL.createObjectURL(f); const d = await imageToData(url); URL.revokeObjectURL(url); loadImage(f, looksGrey(d) ? 'height' : 'paint');
  });

  // ---------- custom building module ----------
  $('lGlb').onclick = () => $('lGlbFile').click();
  $('lGlbReset').onclick = () => { builder.setModules({}); rebuild(); };
  $('lGlbFile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return; const url = URL.createObjectURL(f);
    new GLTFLoader().load(url, (g) => {
      g.scene.updateMatrixWorld(true); const geos = [];
      g.scene.traverse((o) => { if (o.isMesh) { let geo = o.geometry.clone().applyMatrix4(o.matrixWorld); geo = geo.index ? geo.toNonIndexed() : geo; for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k); if (!geo.attributes.normal) geo.computeVertexNormals(); geos.push(geo); } });
      const box = new THREE.Box3(); geos.forEach((x) => { x.computeBoundingBox(); box.union(x.boundingBox); });
      const sz = box.getSize(new THREE.Vector3()), s = 0.9 / Math.max(sz.x, sz.z, 1e-6), c = box.getCenter(new THREE.Vector3());
      geos.forEach((x) => x.translate(-c.x, -box.min.y, -c.z).scale(s, s, s));
      builder.setModules({ house: geos }); rebuild(); URL.revokeObjectURL(url); status(`Using ${f.name} as the house module (${geos.length} mesh part(s))`);
    }, undefined, (err) => status('Could not load module: ' + err.message));
    e.target.value = '';
  };

  // ---------- randomize ----------
  function randomize(seed = state.params.seed, withRegions = $('lRandReg').checked) {
    state.params.seed = seed | 0; state.hmap = null; state.paint = randomPaint(state.params.seed);
    state.regions = withRegions ? randomRegions(state.params.seed, 2) : []; UI.sel = -1; syncAll(); return rebuild();
  }
  $('lRandom').onclick = () => randomize(+$('lSeed').value || 1);
  $('lDice').onclick = () => { $('lSeed').value = Math.floor(Math.random() * 1e6); randomize(+$('lSeed').value); };
  $('lSeed').onchange = (e) => { state.params.seed = +e.target.value | 0; schedule(30); };

  // ---------- export / save ----------
  function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function encode(fmt) {
    const g = builder.exportGroup({ buildings: $('lExB').checked, water: $('lExW').checked }); ctx.decorateExport?.(g);
    if (fmt === 'obj' && ctx.objBundle) return ctx.objBundle(g, `landscape_${state.params.seed}`);
    if (fmt === 'glb') return new Blob([await new GLTFExporter().parseAsync(g, { binary: true })], { type: 'model/gltf-binary' });
    if (fmt === 'obj') return new Blob([new OBJExporter().parse(g)], { type: 'text/plain' });
    if (fmt === 'stl') return new Blob([new STLExporter().parse(g, { binary: true })], { type: 'model/stl' });
    if (fmt === 'ply') return new Blob([await new Promise((res) => new PLYExporter().parse(g, res, { binary: true }))], { type: 'application/octet-stream' });
  }
  async function exportAs(fmt) { try { const blob = await encode(fmt); const zip = fmt === 'obj' && ctx.objBundle; save(blob, `landscape_${state.params.seed}${zip ? '_obj.zip' : '.' + fmt}`); status(`Exported landscape ${fmt.toUpperCase()}${zip ? ' + MTL (zip)' : ''} (${(blob.size / 1024).toFixed(0)} KB)`); return blob; } catch (err) { status('Export failed: ' + err.message); console.error(err); return null; } }
  panel.querySelectorAll('[data-lx]').forEach((b) => b.onclick = async () => { if (ctx.objBundle) return exportAs(b.dataset.lx); try { const blob = await encode(b.dataset.lx); save(blob, `landscape_${state.params.seed}.${b.dataset.lx}`); status(`Exported landscape ${b.dataset.lx.toUpperCase()} (${(blob.size / 1024).toFixed(0)} KB)`); } catch (err) { status('Export failed: ' + err.message); console.error(err); } });
  function heightPNG() {
    const { F, n } = result.field; let lo = Infinity, hi = -Infinity; for (const v of F) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), im = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const v = Math.round((F[i] - lo) / Math.max(1e-6, hi - lo) * 255); im.data.set([v, v, v, 255], i * 4); }
    g.putImageData(im, 0, 0); return { canvas: c, lo, hi };
  }
  $('lHpng').onclick = () => { const { canvas, lo, hi } = heightPNG(); canvas.toBlob((b) => save(b, `landscape_${state.params.seed}_height.png`)); status(`Height map PNG: black = ${lo.toFixed(2)} m, white = ${hi.toFixed(2)} m`); };
  function paintCanvas() { const c = document.createElement('canvas'); c.width = c.height = MAP; const g = c.getContext('2d'), im = g.createImageData(MAP, MAP); for (let i = 0; i < MAP * MAP; i++) im.data.set([...CLASSES[state.paint[i]].rgb, 255], i * 4); g.putImageData(im, 0, 0); return c; }
  $('lPpng').onclick = () => paintCanvas().toBlob((b) => save(b, `landscape_${state.params.seed}_paint.png`));
  function hmapDataURL() { if (!state.hmap) return null; const c = document.createElement('canvas'); c.width = c.height = MAP; const g = c.getContext('2d'), im = g.createImageData(MAP, MAP); for (let i = 0; i < MAP * MAP; i++) { const v = Math.round(state.hmap[i] * 255); im.data.set([v, v, v, 255], i * 4); } g.putImageData(im, 0, 0); return c.toDataURL('image/png'); }
  function projectJSON() { return JSON.stringify({ format: 'meshforge-landscape', version: 1, params: state.params, regions: state.regions, extraSpawners: state.extraSpawners || [], paint: paintCanvas().toDataURL('image/png'), heightmap: hmapDataURL() }, null, 1); }
  async function loadProject(text) {
    const j = typeof text === 'string' ? JSON.parse(text) : text; if (j.format !== 'meshforge-landscape') throw new Error('Not a MeshForge landscape file');
    const d = DEFAULTS(); state.params = { ...d, ...j.params, base: { ...d.base, ...j.params?.base }, scatter: { ...d.scatter, ...j.params?.scatter } };
    state.regions = j.regions || []; state.extraSpawners = j.extraSpawners || []; UI.sel = -1; renderSpawners();
    paintFromRGBA(await imageToData(j.paint));
    if (j.heightmap) { const hd = await imageToData(j.heightmap); state.hmap = new Float32Array(MAP * MAP); for (let i = 0; i < MAP * MAP; i++) state.hmap[i] = hd[i * 4] / 255; } else state.hmap = null;
    syncAll(); rebuild(); status('Opened landscape project');
  }
  $('lSave').onclick = () => save(new Blob([projectJSON()], { type: 'application/json' }), `landscape_${state.params.seed}.json`);
  $('lLoad').onclick = () => $('lJson').click();
  $('lJson').onchange = async (e) => { const f = e.target.files[0]; if (f) try { await loadProject(await f.text()); } catch (err) { status('Open failed: ' + err.message); } e.target.value = ''; };

  // ---------- mode switching ----------
  function frame() { const { width, depth } = extent(state.params); const s = Math.max(width, depth), cam = ctx.camera(); controls.target.set(0, 0, 0); cam.position.set(s * 0.75, s * 0.7, s * 0.9); if (cam.isOrthographicCamera) ctx.setOrthoSize(s * 0.6); controls.update(); }
  state.extraSpawners = state.extraSpawners || [];
  const spawnHost = document.createElement('div'); spawnHost.id = 'lSpawnList'; $('lBuild').appendChild(spawnHost);
  const spawnBtns = document.createElement('div'); spawnBtns.className = 'row';
  spawnBtns.innerHTML = `<button class="btn" id="lAddTree" type="button">Add trees</button><button class="btn" id="lAddSel" type="button">Add selected mesh</button><button class="btn" id="lUseLevel" type="button">Use as level ground</button>`;
  $('lBuild').appendChild(spawnBtns);
  function renderSpawners() {
    const rules = state.extraSpawners || [];
    spawnHost.innerHTML = rules.map((r, i) => `<div class="row"><b>${r.name || r.kind}</b> count <input data-i="${i}" data-k="count" type="number" min="0" max="400" value="${r.count ?? 0}" style="width:52px"> scale <input data-i="${i}" data-k="scaleMin" type="number" step="0.1" value="${r.scaleMin ?? 0.7}" style="width:46px"><input data-i="${i}" data-k="scaleMax" type="number" step="0.1" value="${r.scaleMax ?? 1.4}" style="width:46px"><button type="button" data-del="${i}">×</button></div>`).join('')
      || '<div class="hint0">Houses follow the sliders above. Add trees, or turn the selected scene mesh into a spawn type.</div>';
    spawnHost.querySelectorAll('input').forEach((inp) => { inp.onchange = () => { const rule = state.extraSpawners[+inp.dataset.i]; if (!rule) return; rule[inp.dataset.k] = +inp.value; schedule(40); }; });
    spawnHost.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { state.extraSpawners.splice(+b.dataset.del, 1); renderSpawners(); schedule(30); }; });
  }
  function addSpawner(rule) {
    state.extraSpawners.push({ enabled: true, count: 12, scaleMin: 0.7, scaleMax: 1.4, rotate: true, maxSlope: 28, paints: ['grass'], seed: state.params.seed, waterMargin: 0.1, ...rule, id: rule.id || `sp_${state.extraSpawners.length + 1}` });
    renderSpawners(); rebuild();
    return state.extraSpawners[state.extraSpawners.length - 1];
  }
  renderSpawners();
  $('lAddTree').onclick = () => addSpawner({ kind: 'tree', name: 'Trees', count: 16 });
  $('lAddSel').onclick = () => window.MeshForge?.captureSpawn?.();
  $('lUseLevel').onclick = () => window.MeshForge?.useAsLevel?.();
  function enter() {
    if (UI.active) return; UI.active = true; saved = { pos: ctx.camera().position.clone(), tgt: controls.target.clone(), far: ctx.camera().far };
    document.body.classList.add('land'); panel.hidden = false; builder.group.visible = true;
    const cam = ctx.camera(); cam.far = 1000; cam.updateProjectionMatrix();
    if (!result) rebuild(); frame(); rebuild();
  }
  function exit() {
    if (!UI.active) return; UI.active = false; document.body.classList.remove('land'); panel.hidden = true; builder.group.visible = false;
    const cam = ctx.camera(); cam.position.copy(saved.pos); controls.target.copy(saved.tgt); cam.far = saved.far; cam.updateProjectionMatrix(); controls.update(); status('Generate workspace');
  }
  addEventListener('keydown', (e) => {
    if (!UI.active || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === 'Enter' && UI.draft) { closeLasso(); e.stopImmediatePropagation(); }
    else if (e.key === 'Escape' && UI.draft) { UI.draft = null; drawOverlay(); e.stopImmediatePropagation(); }
  }, true);

  drawPaint(); renderRegions();
  // ---------- public API for the future game / Play button ----------
  const api = {
    // generate({seed, randomize:true, regions:true, params:{...}}) -> { group, terrain, sampleHeight(x,z), buildings, field, state }
    generate(opts = {}) {
      if (opts.params) Object.assign(state.params, opts.params);
      if (opts.randomize !== false) randomize(opts.seed ?? Math.floor(Math.random() * 1e6), opts.regions ?? true);
      else { if (opts.seed != null) state.params.seed = opts.seed; syncAll(); rebuild(); }
      return { group: builder.group, terrain: builder.terrain, sampleHeight: result.sampleHeight, buildings: result.buildings, field: result.field, state };
    },
    rebuild, randomize, enter, exit, frame, addSpawner, renderSpawners, levelGroup: () => builder.levelGroup(), setAsset: (id, geos) => builder.setAsset(id, geos),
    get active() { return UI.active; }, get terrain() { return builder.terrain; }, get state() { return state; }, get result() { return result; },
    sampleHeight: (x, z) => result?.sampleHeight(x, z) ?? 0,
    addRegion: (r) => { const reg = addRegion({ type: r.type || 'poly', pts: r.pts }); Object.assign(reg, r); renderRegions(); rebuild(); return reg; },
    paintCircle: (u, v, size, c) => { const s = UI.size; UI.size = size; dab(u, v, c); UI.size = s; drawPaint(); schedule(10); },
    loadProject, projectJSON, encode, exportAs, get group() { return builder.group; }, heightPNG, paintCanvas, setTool, setColour,
  };
  return api;
}
