// MeshForge v7 materials: library (12 defaults), per-object material slots (per-triangle assignment through
// geometry groups), bottom library window, drag & drop, Material Paint brush, engine-made paintable textures,
// export/import of materials. Original MIT code written for MeshForge.
import * as THREE from 'three';
import { CHIBILI, makeChibiliMaterial, makeOutlineMaterial, syncUniforms, smoothOutlineNormals, renderSwatch, lightDir } from './chibili.js';
import { getSlots, setSlots, applyGroups, triCount } from './mfdata.js';
import { createColorWheel } from './colorwheel.js';

export const DEFAULT_MATERIALS = [
  { id: 'cherry', name: 'Cherry Red', color: '#e8383d', shade: '#6a2a5a' },
  { id: 'tangerine', name: 'Tangerine', color: '#f58a1f', shade: '#7a3a4a' },
  { id: 'sunflower', name: 'Sunflower', color: '#f7d038', shade: '#8a5a4a' },
  { id: 'leaf', name: 'Leaf Green', color: '#52c24a', shade: '#2a5a5a' },
  { id: 'aqua', name: 'Aqua Cyan', color: '#31c6d8', shade: '#2a4a7a' },
  { id: 'cobalt', name: 'Cobalt Blue', color: '#2f63dc', shade: '#2a2a6a' },
  { id: 'grape', name: 'Grape Purple', color: '#8c4ad3', shade: '#3a2a6a' },
  { id: 'bubblegum', name: 'Bubblegum Pink', color: '#f47eb6', shade: '#7a3a6a' },
  { id: 'chalk', name: 'Chalk White', color: '#f3efe6', shade: '#8a7f9a' },
  { id: 'ink', name: 'Ink Black', color: '#2a2830', shade: '#141218' },
  { id: 'sky', name: 'Toon Sky', kind: 'sky', color: '#9fd4ff', top: '#3d8ce6', bottom: '#d7f1ff', outline: 'off', bands: 4 },
  { id: 'water', name: 'Toon Water', kind: 'water', color: '#1f9be8', shade: '#1a5aa8', foam: '#f2fbff', foamScale: 2.2, wave: 0.015, bands: 2 },
];
const AUTO = '__auto';
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FALL = { soft: (t) => { const x = 1 - t; return x * x * (3 - 2 * x); }, linear: (t) => 1 - t, constant: (t) => (t < 0.98 ? 1 : 0), sharp: (t) => (1 - t) ** 3 };

export function createMaterials(ctx) {
  // ctx: { scene, canvas, camera(), editor, meshes(), status(m), updateInfo(), isChibili(), applyShading(), ensureUV(mesh), onTextureChange(mesh) }
  const $ = (id) => document.getElementById(id);
  const canvas = ctx.canvas, vp = canvas.parentElement;
  const lib = DEFAULT_MATERIALS.map((d) => ({ ...d }));
  let activeId = lib[0].id, seq = 1;
  const RT = new WeakMap(), live = new Set();
  const brush = { on: false, mode: 'face', size: 40, opacity: 1, falloff: 'soft', color: null };
  const byId = (id) => lib.find((m) => m.id === id);
  const status = (m) => ctx.status(m);
  const clock = new THREE.Clock();

  // ---------- per-object data ----------
  function mfOf(mesh) { return (mesh.userData.mf ||= { slots: [AUTO], active: 0, albedo: 'material', vcol: false }); }
  function origColor(mesh) { const m = mesh.userData.orig || mesh.material; const c = (Array.isArray(m) ? m[0] : m)?.color; return c?.isColor ? '#' + c.getHexString() : '#cccccc'; }
  function defFor(mesh, id) {
    if (id === AUTO) return { id: AUTO, name: 'Object colour', color: origColor(mesh) };
    return byId(id) || { id, name: id + ' (missing)', color: '#ff00ff' };
  }
  function rt(mesh) {
    let r = RT.get(mesh); if (r) return r;
    r = { inst: [], outline: null, tex: null }; RT.set(mesh, r); live.add(mesh); return r;
  }
  function instFor(mesh) {
    const mf = mfOf(mesh), r = rt(mesh);
    while (r.inst.length < mf.slots.length) r.inst.push(makeChibiliMaterial());
    r.inst.length = mf.slots.length; return r.inst;
  }
  function ensureOutline(mesh) {
    const r = rt(mesh);
    if (r.outline && r.outline.parent === mesh && r.outline.geometry === mesh.geometry) return r.outline;
    if (r.outline) r.outline.parent?.remove(r.outline);
    const geo = mesh.geometry; if (!geo.index || geo.attributes.normal) smoothOutlineNormals(geo);
    const mat = r.outlineMat || (r.outlineMat = makeOutlineMaterial());
    const smooth = !!geo.attributes.mfOutlineN; if (!!mat.defines.MF_SMOOTHN !== smooth) { if (smooth) mat.defines.MF_SMOOTHN = ''; else delete mat.defines.MF_SMOOTHN; mat.needsUpdate = true; }
    let o;
    if (mesh.isSkinnedMesh) { o = new THREE.SkinnedMesh(geo, mat); o.bind(mesh.skeleton, mesh.bindMatrix); o.bindMode = mesh.bindMode; }
    else o = new THREE.Mesh(geo, mat);
    o.userData.isOverlay = true; o.userData.isChibiliOutline = true; o.raycast = () => {}; o.frustumCulled = false; o.renderOrder = -1;
    mesh.add(o); r.outline = o; return o;
  }
  // called by the app's applyShading for every mesh
  function apply(mesh, on) {
    const r = RT.get(mesh);
    if (!on) { if (r?.outline) r.outline.visible = false; return null; }
    const mf = mfOf(mesh), inst = instFor(mesh);
    if (mf.albedo === 'texture' && r?.tex) { mesh.material = inst[0]; }
    else if (inst.length > 1) { applyGroups(mesh.geometry, inst.length); mesh.geometry.userData.mfGK = groupKey(mesh); mesh.material = inst; }
    else mesh.material = inst[0];
    syncMesh(mesh, 0);
    const o = ensureOutline(mesh); o.visible = outlineOn(mesh);
    return mesh.material;
  }
  const groupKey = (mesh) => `${triCount(mesh.geometry)}/${mfOf(mesh).slots.length}`;
  function outlineOn(mesh) { const d = defFor(mesh, mfOf(mesh).slots[0]); if (d.outline === 'off') return false; if (d.outline === 'on') return true; return CHIBILI.outline && d.kind !== 'sky'; }
  function syncMesh(mesh, time) {
    const mf = mfOf(mesh), r = rt(mesh), geo = mesh.geometry, L = lightDir();
    const texOn = mf.albedo === 'texture' && r.tex;
    const hasCol = !!geo.attributes.color;
    r.inst.forEach((m, i) => {
      const id = mf.slots[i], d = defFor(mesh, id);
      const useV = hasCol && (mf.vcol || id === AUTO) && !texOn;
      const dd = (texOn || (mf.vcol && hasCol)) ? { ...d, color: '#ffffff' } : d;
      syncUniforms(m, dd, { light: L, time, vertexColors: useV, map: texOn ? r.tex.texture : null });
    });
    if (r.outline) {
      const d = defFor(mesh, mf.slots[0]), u = r.outline.material.uniforms;
      u.uWidth.value = (d.outline === 'on' && d.outlineWidth > 0 ? d.outlineWidth : CHIBILI.outlineWidth) * (ctx.renderer?.getPixelRatio() || 1);
      u.uColor.value.set(d.outline === 'on' && d.outlineColor ? d.outlineColor : CHIBILI.outlineColor);
      const sz = ctx.renderer?.getDrawingBufferSize(new THREE.Vector2()); if (sz) u.uRes.value.copy(sz);
      r.outline.visible = ctx.isChibili() && outlineOn(mesh) && mesh.visible;
      if (r.outline.geometry !== mesh.geometry) ensureOutline(mesh);
    }
  }
  function tick() {
    const t = clock.getElapsedTime(), chib = ctx.isChibili();
    for (const mesh of live) {
      if (!mesh.parent && !mesh.userData.mfKeep) { continue; }
      const r = RT.get(mesh); if (!r) continue;
      if (!chib) { if (r.outline) r.outline.visible = false; continue; }
      const inst = r.inst; if (!inst.length) continue;
      const isOurs = Array.isArray(mesh.material) ? mesh.material[0] === inst[0] : mesh.material === inst[0];
      if (!isOurs) { if (r.outline) r.outline.visible = false; continue; }
      if (Array.isArray(mesh.material) && mesh.geometry.userData.mfGK !== groupKey(mesh)) { applyGroups(mesh.geometry, inst.length); mesh.geometry.userData.mfGK = groupKey(mesh); }
      syncMesh(mesh, t);
    }
    if (paintDot) updateDot();
  }

  // ---------- slots / assignment (undoable) ----------
  function snap(mesh) { const g = mesh.geometry; return { geo: g, slots: getSlots(g).slice(), mf: JSON.parse(JSON.stringify(mfOf(mesh))) }; }
  function restore(mesh, s) { if (mesh.geometry === s.geo) setSlots(s.geo, s.slots.slice()); mesh.userData.mf = JSON.parse(JSON.stringify(s.mf)); refresh(mesh); }
  function record(mesh, label, before) {
    const after = snap(mesh);
    ctx.editor.pushHistory({ label, undo: () => restore(mesh, before), redo: () => restore(mesh, after) });
  }
  function refresh(mesh) { if (ctx.isChibili()) apply(mesh, true); renderUI(); ctx.updateInfo?.(); }
  function slotIndex(mesh, id, add = true) { const mf = mfOf(mesh); let i = mf.slots.indexOf(id); if (i < 0 && add) { mf.slots.push(id); i = mf.slots.length - 1; } return i; }
  function assignObject(mesh, id = activeId) {
    if (!mesh) return false; const before = snap(mesh), mf = mfOf(mesh);
    mf.slots = [id]; mf.active = 0; getSlots(mesh.geometry).fill(0);
    record(mesh, `Assign ${defFor(mesh, id).name}`, before); refresh(mesh); status(`${mesh.name || 'Object'}: material ${defFor(mesh, id).name}`); return true;
  }
  function assignFaces(mesh, tris, id = activeId, label) {
    if (!mesh || !tris.length) return 0; const before = snap(mesh), i = slotIndex(mesh, id), s = getSlots(mesh.geometry);
    let n = 0; for (const t of tris) if (t < s.length && s[t] !== i) { s[t] = i; n++; }
    mfOf(mesh).active = i;
    record(mesh, label || `Assign ${defFor(mesh, id).name} to ${tris.length} face(s)`, before); refresh(mesh); return n;
  }
  function assignSlotToSelection(slot = mfOf(ctx.editor.sel || {}).active) {
    const mesh = ctx.editor.debug.E?.mesh; if (!mesh) { status('Enter Edit Mode and select faces first'); return 0; }
    const tris = ctx.editor.faceSelection(); if (!tris.length) { status('Select some faces first (3 = face select)'); return 0; }
    const mf = mfOf(mesh), id = mf.slots[slot] ?? activeId; const n = assignFaces(mesh, tris, id, `Assign slot ${slot + 1}`);
    status(`Assigned ${defFor(mesh, id).name} to ${tris.length} face(s)`); return n;
  }
  function selectSlotFaces(slot, on = true) {
    const mesh = ctx.editor.debug.E?.mesh; if (!mesh) return 0; const s = getSlots(mesh.geometry), list = [];
    for (let t = 0; t < triCount(mesh.geometry); t++) if (s[t] === slot) list.push(t);
    ctx.editor.selectFaces(list, on); return list.length;
  }
  function addSlot(mesh, id = activeId) { const before = snap(mesh), mf = mfOf(mesh); mf.slots.push(id); mf.active = mf.slots.length - 1; record(mesh, 'Add material slot', before); refresh(mesh); }
  function removeSlot(mesh, slot = mfOf(mesh).active) {
    const mf = mfOf(mesh); if (mf.slots.length <= 1) { status('An object keeps at least one slot'); return; }
    const before = snap(mesh), s = getSlots(mesh.geometry);
    for (let t = 0; t < s.length; t++) { if (s[t] === slot) s[t] = 0; else if (s[t] > slot) s[t]--; }
    mf.slots.splice(slot, 1); mf.active = Math.max(0, Math.min(mf.active, mf.slots.length - 1));
    record(mesh, 'Remove material slot', before); refresh(mesh);
  }
  function setSlotMaterial(mesh, slot, id) { const before = snap(mesh), mf = mfOf(mesh); mf.slots[slot] = id; record(mesh, 'Change slot material', before); refresh(mesh); }

  // ---------- library CRUD ----------
  function uniqueName(n) { let name = n, k = 1; while (lib.some((m) => m.name === name)) name = `${n}.${String(k++).padStart(3, '0')}`; return name; }
  function newId(base) { let id; do { id = `${base}_${seq++}`; } while (byId(id)); return id; }
  function create(def = {}) { const m = { name: 'Material', color: '#d0d0d0', shade: '#5b4a7a', ...def }; m.id = def.id && !byId(def.id) ? def.id : newId('mat'); m.name = uniqueName(m.name); lib.push(m); activeId = m.id; renderUI(true); return m; }
  function duplicate(id = activeId) { const s = byId(id); if (!s) return null; const { id: _x, ...rest } = s; return create({ ...JSON.parse(JSON.stringify(rest)), name: s.name }); }
  function rename(id, name) { const m = byId(id); if (!m || !name) return false; m.name = uniqueName(String(name).slice(0, 48)); renderUI(true); return true; }
  function remove(id = activeId) {
    const i = lib.findIndex((m) => m.id === id); if (i < 0) return false;
    if (lib.length <= 1) { status('Keep at least one material'); return false; }
    const used = ctx.meshes().filter((m) => m.userData.mf?.slots.includes(id));
    used.forEach((m) => { const mf = m.userData.mf; mf.slots = mf.slots.map((s) => (s === id ? AUTO : s)); refresh(m); });
    lib.splice(i, 1); if (activeId === id) activeId = lib[Math.max(0, i - 1)].id; renderUI(true);
    status(`Deleted material${used.length ? ` (${used.length} object(s) fell back to their own colour)` : ''}`); return true;
  }
  function update(id, patch) { const m = byId(id); if (!m) return false; Object.assign(m, patch); thumbs.delete(id); renderUI(true); return true; }
  function setActive(id) { if (byId(id)) { activeId = id; renderUI(); } }
  function libJSON() { return JSON.parse(JSON.stringify(lib)); }
  function loadLib(arr, { replace = false } = {}) {
    if (!Array.isArray(arr)) return 0; let n = 0;
    if (replace) lib.length = 0;
    for (const d of arr) { if (!d || !d.id) continue; const ex = byId(d.id); if (ex) Object.assign(ex, d); else { lib.push({ ...d }); n++; } thumbs.delete(d.id); }
    if (!byId(activeId)) activeId = lib[0]?.id; renderUI(true); return n;
  }

  // ---------- textures (engine-made, paintable) ----------
  function texOf(mesh) { return RT.get(mesh)?.tex || null; }
  function createTexture(mesh, { name = 'albedo', res = 1024, fill = 'materials' } = {}) {
    if (!mesh) return null; ctx.ensureUV?.(mesh); const mf = mfOf(mesh), r = rt(mesh);
    const c = document.createElement('canvas'); c.width = c.height = res; const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, res, res);
    if (fill === 'materials') bakeMaterialsInto(mesh, g, res);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.name = name; tex.anisotropy = 4;
    r.tex = { name, res, canvas: c, ctx: g, texture: tex };
    mf.albedo = 'texture'; mf.tex = { name, res };
    refresh(mesh); ctx.onTextureChange?.(mesh); status(`Texture "${name}" (${res}×${res}) created on ${mesh.name || 'object'}. Paint it in the UV workspace or with the Texture brush`); return r.tex;
  }
  function bakeMaterialsInto(mesh, g, res) {
    const geo = mesh.geometry, uv = geo.attributes.uv; if (!uv) return;
    const idx = geo.index, nt = triCount(geo), s = getSlots(geo), mf = mfOf(mesh), col = geo.attributes.color;
    const cache = mf.slots.map((id) => defFor(mesh, id).color);
    const tmp = new THREE.Color();
    for (let t = 0; t < nt; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      let fill = cache[s[t]] || '#ffffff';
      if (col && (mf.vcol || mf.slots[s[t]] === AUTO)) { tmp.setRGB((col.getX(ia) + col.getX(ib) + col.getX(ic)) / 3, (col.getY(ia) + col.getY(ib) + col.getY(ic)) / 3, (col.getZ(ia) + col.getZ(ib) + col.getZ(ic)) / 3); if (mf.slots[s[t]] === AUTO) tmp.multiply(new THREE.Color(cache[s[t]])); fill = '#' + tmp.getHexString(); }
      g.fillStyle = g.strokeStyle = fill; g.lineWidth = 2; g.beginPath();
      g.moveTo(uv.getX(ia) * res, (1 - uv.getY(ia)) * res); g.lineTo(uv.getX(ib) * res, (1 - uv.getY(ib)) * res); g.lineTo(uv.getX(ic) * res, (1 - uv.getY(ic)) * res); g.closePath(); g.fill(); g.stroke();
    }
  }
  function deleteTexture(mesh) { const r = RT.get(mesh); if (!r?.tex) return false; r.tex.texture.dispose(); r.tex = null; const mf = mfOf(mesh); mf.albedo = 'material'; delete mf.tex; refresh(mesh); ctx.onTextureChange?.(mesh); return true; }
  function renameTexture(mesh, name) { const t = texOf(mesh); if (!t) return false; t.name = t.texture.name = String(name).slice(0, 48) || 'albedo'; mfOf(mesh).tex.name = t.name; renderUI(); return true; }
  function setAlbedo(mesh, mode) { const mf = mfOf(mesh); if (mode === 'texture' && !texOf(mesh)) { createTexture(mesh, { name: `${(mesh.name || 'object').replace(/\W+/g, '_')}_albedo`, res: +($('mtRes')?.value || 1024) }); return; } mf.albedo = mode; refresh(mesh); }
  function texDirty(mesh) { const t = texOf(mesh); if (t) t.texture.needsUpdate = true; }
  function adoptTextureImage(mesh, image, name) {
    const w = image.width || 1024, res = [512, 1024, 2048].reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
    const c = document.createElement('canvas'); c.width = c.height = res; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(image, 0, 0, res, res);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.name = name;
    rt(mesh).tex = { name, res, canvas: c, ctx: g, texture: tex }; const mf = mfOf(mesh); mf.albedo = 'texture'; mf.tex = { name, res };
  }

  // ---------- export / import ----------
  function stdFrom(def, extra = {}) {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.kind === 'sky' ? (def.bottom || def.color) : def.color || '#cccccc'), roughness: 0.6, metalness: 0, ...extra });
    m.name = def.name || def.id; if (def.id !== AUTO) m.userData = { chibili: { ...def } };
    if (def.kind === 'water') { m.transparent = (def.opacity ?? 1) < 1; }
    return m;
  }
  // geo: a clone of the mesh geometry that will be exported (slots copied onto it). Returns a material or an array, or null for the old path.
  function exportMaterial(mesh, geo) {
    const mf = mesh.userData.mf; if (!mf) return null;
    const r = RT.get(mesh);
    if (mf.albedo === 'texture' && r?.tex) {
      const c = document.createElement('canvas'); c.width = c.height = r.tex.res; c.getContext('2d').drawImage(r.tex.canvas, 0, 0);
      const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.name = r.tex.name;
      const d = defFor(mesh, mf.slots[0]); const m = stdFrom({ ...d, color: '#ffffff' }, { map }); m.name = r.tex.name;
      m.userData = { ...(m.userData || {}), mfTexture: { name: r.tex.name, res: r.tex.res, base: d.id } }; geo.clearGroups(); return m;
    }
    const useV = !!geo.attributes.color;
    const mats = mf.slots.map((id) => { const d = defFor(mesh, id); return stdFrom(mf.vcol && useV ? { ...d, color: '#ffffff' } : d, { vertexColors: useV && (mf.vcol || id === AUTO) }); });
    if (mats.length === 1) { geo.clearGroups(); return mats[0]; }
    sortBySlot(geo, mats.length); return mats;
  }
  function sortBySlot(geo, n) {
    const nt = triCount(geo), s = getSlots(geo), order = Array.from({ length: nt }, (_, i) => i).sort((a, b) => (s[a] - s[b]) || (a - b));
    if (geo.index) { const I = geo.index.array, J = new (I.constructor)(nt * 3); order.forEach((t, k) => { J[k * 3] = I[t * 3]; J[k * 3 + 1] = I[t * 3 + 1]; J[k * 3 + 2] = I[t * 3 + 2]; }); geo.setIndex(new THREE.BufferAttribute(J, 1)); }
    else for (const name of Object.keys(geo.attributes)) { const a = geo.attributes[name], is = a.itemSize, A = a.array, B = new (A.constructor)(nt * 3 * is); order.forEach((t, k) => B.set(A.subarray(t * 3 * is, (t + 1) * 3 * is), k * 3 * is)); geo.setAttribute(name, new THREE.BufferAttribute(B, is, a.normalized)); }
    const ns = new Uint16Array(nt); order.forEach((t, k) => (ns[k] = s[t])); setSlots(geo, ns); geo.setDrawRange(0, Infinity); applyGroups(geo, n);
  }
  // adopt materials that MeshForge wrote into GLB extras (round trip) for one mesh; parts = list of {material, triStart, triCount}
  function adopt(mesh, parts) {
    const defs = []; let any = false;
    for (const p of parts) { const d = p.material?.userData?.chibili; if (d && d.id) { any = true; if (!byId(d.id)) lib.push({ ...d }); defs.push(d.id); } else defs.push(AUTO); }
    const texPart = parts.find((p) => p.material?.userData?.mfTexture && p.material.map?.image);
    if (!any && !texPart) return false;
    const mf = mfOf(mesh), uniq = [...new Set(defs)]; mf.slots = uniq;
    const s = getSlots(mesh.geometry); parts.forEach((p, i) => s.fill(uniq.indexOf(defs[i]), p.triStart, p.triStart + p.triCount));
    if (texPart) { const t = texPart.material.userData.mfTexture; adoptTextureImage(mesh, texPart.material.map.image, t.name || 'albedo'); if (t.base && byId(t.base)) mf.slots = [t.base]; }
    renderUI(true); return true;
  }

  // ---------- UI: bottom library window ----------
  const thumbs = new Map();
  const libEl = document.createElement('div'); libEl.id = 'matLib'; libEl.className = 'matlib'; libEl.hidden = true;
  libEl.innerHTML = `<div class="mlhead"><button id="mlFold" class="mlfold" title="Collapse / expand">▾</button><b>Material Library</b><span class="mlhint">drag a swatch onto an object · Edit Mode: drop on a face</span><span class="grow"></span>
    <button data-ml="new" title="New material">＋ New</button><button data-ml="dup" title="Duplicate the active material">⧉ Duplicate</button><button data-ml="ren" title="Rename (or double-click a swatch)">✎ Rename</button><button data-ml="del" title="Delete the active material">🗑 Delete</button><button data-ml="assign" class="acc" title="Assign to the selected object, or to the selected faces in Edit Mode">Assign</button></div>
    <div class="mlgrid" id="mlGrid"></div>`;
  vp.appendChild(libEl);
  const menu = document.createElement('div'); menu.className = 'mlmenu'; menu.hidden = true; document.body.appendChild(menu);
  function libAction(a, id = activeId) {
    if (a === 'new') return create({ name: 'Material', color: brush.color || '#d0d0d0' });
    if (a === 'dup') return duplicate(id);
    if (a === 'ren') { const m = byId(id); const n = prompt('Material name', m?.name); if (n) rename(id, n); return; }
    if (a === 'del') return remove(id);
    if (a === 'assign') return assignActive(id);
  }
  function assignActive(id = activeId) {
    const E = ctx.editor.debug.E;
    if (ctx.editor.mode === 'edit' && E) { const tris = ctx.editor.faceSelection(); if (tris.length) { assignFaces(E.mesh, tris, id); status(`Assigned ${byId(id)?.name} to ${tris.length} face(s)`); return; } }
    const sel = ctx.editor.sel; if (!sel) { status('Select an object first (or drag the swatch onto it)'); return; }
    assignObject(sel, id);
  }
  libEl.querySelectorAll('[data-ml]').forEach((b) => b.onclick = () => libAction(b.dataset.ml));
  $('mlFold').onclick = () => { libEl.classList.toggle('folded'); $('mlFold').textContent = libEl.classList.contains('folded') ? '▸' : '▾'; };
  addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; }, true);
  function renderLib() {
    const grid = $('mlGrid'); if (!grid) return;
    grid.innerHTML = lib.map((m) => {
      if (!thumbs.has(m.id)) thumbs.set(m.id, renderSwatch(m));
      return `<div class="mlsw ${m.id === activeId ? 'on' : ''}" draggable="true" data-id="${esc(m.id)}" title="${esc(m.name)}${m.kind && m.kind !== 'toon' ? ` (${m.kind})` : ''} · drag onto an object"><img src="${thumbs.get(m.id)}" alt="" draggable="false"><span>${esc(m.name)}</span></div>`;
    }).join('');
    grid.querySelectorAll('.mlsw').forEach((el) => {
      const id = el.dataset.id;
      el.onclick = () => setActive(id);
      el.ondblclick = () => libAction('ren', id);
      el.oncontextmenu = (e) => { e.preventDefault(); setActive(id); menu.innerHTML = ['new:New material', 'dup:Duplicate', 'ren:Rename…', 'assign:Assign to selection', 'del:Delete'].map((s) => `<button data-a="${s.split(':')[0]}">${s.split(':')[1]}</button>`).join('');
        Object.assign(menu.style, { left: e.clientX + 'px', top: (e.clientY - 150) + 'px' }); menu.hidden = false;
        menu.querySelectorAll('button').forEach((b) => b.onclick = () => { menu.hidden = true; libAction(b.dataset.a, id); }); };
      el.ondragstart = (e) => { e.dataTransfer.setData('text/x-mf-material', id); e.dataTransfer.setData('text/plain', 'mf-material:' + id); e.dataTransfer.effectAllowed = 'copy'; setActive(id); };
    });
  }
  // drop a library swatch onto the viewport
  vp.addEventListener('drop', (e) => {
    const dt = e.dataTransfer; let id = dt?.getData('text/x-mf-material');
    if (!id) { const t = dt?.getData('text/plain') || ''; if (t.startsWith('mf-material:')) id = t.slice(12); }
    if (!id) return; e.preventDefault(); e.stopPropagation(); dropMaterial(id, e.clientX, e.clientY);
  }, true);
  function rayHit(cx, cy, objs) {
    const r = canvas.getBoundingClientRect(), rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), ctx.camera());
    return rc.intersectObjects(objs, false)[0] || null;
  }
  function dropMaterial(id, cx, cy) {
    const E = ctx.editor.debug.E;
    if (ctx.editor.mode === 'edit' && E) {
      const h = rayHit(cx, cy, [E.mesh]); if (!h) { status('Drop it on a face of the mesh you are editing'); return false; }
      const sel = ctx.editor.faceSelection(), t = h.faceIndex;
      const tris = sel.includes(t) ? sel : (E.partner[t] >= 0 ? [t, E.partner[t]] : [t]);
      assignFaces(E.mesh, tris, id); status(`Assigned ${byId(id)?.name} to ${tris.length} face(s)`); return true;
    }
    const h = rayHit(cx, cy, ctx.meshes()); if (!h) { status('Drop the material on an object'); return false; }
    assignObject(h.object, id); ctx.editor.select(h.object); return true;
  }

  // ---------- UI: right sidebar (Shader workspace) ----------
  const panel = document.createElement('div'); panel.id = 'shaderPanel'; panel.className = 'ws-panel'; panel.hidden = true;
  panel.innerHTML = `
  <details open><summary>Material Slots</summary>
    <div class="slotbox"><ul id="mtSlots" class="slots"></ul><div class="slotbtns"><button id="mtSlotAdd" title="Add slot (uses the active library material)">＋</button><button id="mtSlotDel" title="Remove slot">－</button></div></div>
    <div class="row"><button class="btn" id="mtAssign" title="Edit Mode: give the selected faces the active slot">Assign</button><button class="btn" id="mtSelect" title="Edit Mode: select faces using this slot">Select</button><button class="btn" id="mtDeselect">Deselect</button></div>
    <div class="row"><button class="btn" id="mtSetSlot" title="Put the active library material into the active slot">Use library material in slot</button></div>
    <div class="hint0" id="mtSlotHint">Select an object. In Edit Mode pick faces (3), choose a slot and press Assign.</div>
  </details>
  <details open><summary>Material</summary>
    <div class="row"><span>Name</span><input id="mtName" class="txt" style="grid-column:2/4"></div>
    <div class="row"><span>Type</span><select id="mtKind"><option value="toon">Toon surface</option><option value="sky">Sky gradient</option><option value="water">Toon water</option></select></div>
    <div class="row"><span>Base colour</span><input id="mtColor" type="color"><b></b></div>
    <div class="row"><span>Shadow tint</span><input id="mtShade" type="color"><b></b></div>
    <div class="row"><span>Light bands</span><select id="mtBands"><option value="0">Global</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></div>
    <div class="row"><span>Band softness</span><input id="mtSoft" type="range" min="-0.01" max="0.5" step="0.01"><b id="mtSoftV"></b></div>
    <div class="row"><span>Rim light</span><input id="mtRim" type="range" min="-0.01" max="1" step="0.01"><b id="mtRimV"></b></div>
    <div class="row"><span>Outline</span><select id="mtOutline"><option value="">Global</option><option value="on">Custom</option><option value="off">Off</option></select></div>
    <div class="row" id="mtOutRow"><span>Outline px</span><input id="mtOutW" type="range" min="0.5" max="10" step="0.5"><input id="mtOutC" type="color"></div>
    <div class="row" data-k="sky"><span>Sky top</span><input id="mtTop" type="color"><b></b></div>
    <div class="row" data-k="sky"><span>Sky horizon</span><input id="mtBottom" type="color"><b></b></div>
    <div class="row" data-k="water"><span>Foam colour</span><input id="mtFoam" type="color"><b></b></div>
    <div class="row" data-k="water"><span>Foam scale</span><input id="mtFoamS" type="range" min="0.3" max="8" step="0.1"><b id="mtFoamSV"></b></div>
    <div class="row" data-k="water"><span>Waves</span><input id="mtWave" type="range" min="0" max="0.08" step="0.005"><b id="mtWaveV"></b></div>
    <div class="row"><button class="btn" id="mtNew">＋ New</button><button class="btn" id="mtDup">⧉ Duplicate</button></div>
  </details>
  <details open><summary>Material Paint brush</summary>
    <div class="row"><span>Brush</span><button class="btn ptoggle" id="mpOn" title="Paint the active material onto the mesh (P)">🖌 Paint off</button></div>
    <div class="row"><span>Paints</span><div class="seg" id="mpMode"><button data-v="face" class="on" title="Assign the material to faces under the brush">Face material</button><button data-v="vcol" title="Blend the material colour into vertex colours">Vertex colour</button><button data-v="tex" title="Paint the colour onto the object's texture">Texture</button></div></div>
    <div class="row"><span>Size (px)</span><input id="mpSize" type="range" min="2" max="300" value="40"><input id="mpSizeN" class="txt num" type="number" min="2" max="300" value="40"></div>
    <div class="row"><span>Opacity</span><input id="mpOp" type="range" min="0.01" max="1" step="0.01" value="1"><input id="mpOpN" class="txt num" type="number" min="0.01" max="1" step="0.01" value="1"></div>
    <div class="row"><span>Falloff</span><select id="mpFall"><option value="soft">Smooth</option><option value="linear">Linear</option><option value="sharp">Sharp</option><option value="constant">Constant</option></select></div>
    <label class="row chk"><input type="checkbox" id="mpPress" checked> Pen pressure changes size</label>
    <div class="hint0">Colour wheel: changes the active material's colour (and the paint colour).</div>
    <div id="mpWheel"></div>
  </details>
  <details open><summary>Texture</summary>
    <div class="row"><span>Albedo</span><div class="seg" id="mtAlb"><button data-v="material" class="on">Material colours</button><button data-v="texture">Texture</button></div></div>
    <div class="row"><span>Name</span><input id="mtTexName" class="txt" style="grid-column:2/4" placeholder="body_albedo"></div>
    <div class="row"><span>Resolution</span><select id="mtRes"><option>512</option><option selected>1024</option><option>2048</option></select></div>
    <div class="row"><span>Start from</span><select id="mtFill"><option value="materials">Material colours</option><option value="blank">Blank white</option></select></div>
    <div class="row"><button class="btn" id="mtTexNew">Create texture</button><button class="btn" id="mtTexDel">Delete</button></div>
    <div class="row"><button class="btn" id="mtTex2D" title="Open the split 3D / 2D paint view (UV workspace)">Paint in 2D view…</button></div>
    <div class="hint0" id="mtTexHint">Textures are made inside MeshForge (no import yet) and are saved into GLB, and into OBJ as MTL + PNG.</div>
  </details>
  <details open><summary>Chibili render settings</summary>
    <div class="row"><span>Light bands</span><input id="chBands" type="range" min="1" max="5" step="1"><b id="chBandsV"></b></div>
    <div class="row"><span>Softness</span><input id="chSoft" type="range" min="0" max="0.5" step="0.01"><b id="chSoftV"></b></div>
    <div class="row"><span>Shadow tint</span><input id="chTint" type="range" min="0" max="1" step="0.05"><b id="chTintV"></b></div>
    <div class="row"><span>Rim light</span><input id="chRim" type="range" min="0" max="1" step="0.05"><b id="chRimV"></b></div>
    <div class="row"><span>Highlight</span><input id="chHigh" type="range" min="0" max="0.6" step="0.02"><b id="chHighV"></b></div>
    <label class="row chk"><input type="checkbox" id="chOut"> Outlines</label>
    <div class="row"><span>Outline px</span><input id="chOutW" type="range" min="0.5" max="10" step="0.5"><input id="chOutC" type="color"></div>
    <div class="row"><span>Light angle</span><input id="chAz" type="range" min="-180" max="180" step="5"><b id="chAzV"></b></div>
    <div class="row"><span>Light height</span><input id="chEl" type="range" min="-10" max="90" step="5"><b id="chElV"></b></div>
  </details>`;
  document.querySelector('.props').appendChild(panel);
  const wheel = createColorWheel($('mpWheel'), (hex) => { brush.color = hex; const m = byId(activeId); if (m) { m.color = hex; thumbs.delete(m.id); renderUI(true); } }, 160);

  const curMesh = () => ctx.editor.debug.E?.mesh || ctx.editor.sel;
  function renderUI(libToo) {
    if (libToo) renderLib(); else libEl.querySelectorAll('.mlsw').forEach((el) => el.classList.toggle('on', el.dataset.id === activeId));
    if (panel.hidden) return;
    const mesh = curMesh(), mf = mesh ? mfOf(mesh) : null;
    $('mtSlots').innerHTML = mf ? mf.slots.map((id, i) => { const d = defFor(mesh, id); return `<li data-i="${i}" class="${i === mf.active ? 'on' : ''}"><i style="background:${esc(d.color)}"></i>${i + 1}. ${esc(d.name)}</li>`; }).join('') : '<li class="dim">No object selected</li>';
    $('mtSlots').querySelectorAll('li[data-i]').forEach((li) => li.onclick = () => { mf.active = +li.dataset.i; const id = mf.slots[mf.active]; if (byId(id)) activeId = id; renderUI(); });
    $('mtSlotHint').textContent = ctx.editor.mode === 'edit' ? 'Edit Mode: select faces, pick a slot, press Assign. Drag a swatch onto a face to assign it directly.' : 'Select an object. Drag a library swatch onto it, or Tab into Edit Mode to assign per face.';
    const m = byId(activeId);
    if (m) {
      const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
      set('mtName', m.name); set('mtKind', m.kind || 'toon'); set('mtColor', m.color || '#cccccc'); set('mtShade', m.shade || '#5b4a7a');
      set('mtBands', String(m.bands || 0)); set('mtSoft', m.soft ?? -0.01); $('mtSoftV').textContent = m.soft >= 0 ? m.soft.toFixed(2) : 'global';
      set('mtRim', m.rim ?? -0.01); $('mtRimV').textContent = m.rim >= 0 ? m.rim.toFixed(2) : 'global';
      set('mtOutline', m.outline || ''); set('mtOutW', m.outlineWidth || CHIBILI.outlineWidth); set('mtOutC', m.outlineColor || CHIBILI.outlineColor); $('mtOutRow').hidden = m.outline !== 'on';
      set('mtTop', m.top || '#3d8ce6'); set('mtBottom', m.bottom || '#d7f1ff'); set('mtFoam', m.foam || '#f2fbff'); set('mtFoamS', m.foamScale || 2.2); $('mtFoamSV').textContent = (m.foamScale || 2.2).toFixed(1);
      set('mtWave', m.wave ?? 0.015); $('mtWaveV').textContent = (m.wave ?? 0.015).toFixed(3);
      panel.querySelectorAll('[data-k]').forEach((r) => (r.hidden = r.dataset.k !== (m.kind || 'toon')));
      if (document.activeElement?.closest?.('.cwheel') == null) wheel.set(m.color || '#ffffff');
    }
    const t = mesh ? texOf(mesh) : null;
    $('mtAlb').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === (mf?.albedo || 'material')));
    if (document.activeElement !== $('mtTexName')) $('mtTexName').value = t ? t.name : (mesh ? `${(mesh.name || 'object').replace(/\W+/g, '_')}_albedo` : '');
    $('mtTexDel').disabled = !t; $('mtTexHint').textContent = t ? `"${t.name}" ${t.res}×${t.res} on ${mesh.name || 'object'}. Saved into GLB (embedded PNG) and OBJ (MTL + PNG).` : 'Textures are made inside MeshForge (no import yet) and are saved into GLB, and into OBJ as MTL + PNG.';
    $('mpOn').textContent = brush.on ? '🖌 Painting (P)' : '🖌 Paint off'; $('mpOn').classList.toggle('on', brush.on);
    $('mpMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === brush.mode));
    const G = CHIBILI, sv = (id, v, txt) => { $(id).value = v; if ($(id + 'V')) $(id + 'V').textContent = txt ?? v; };
    sv('chBands', G.bands); sv('chSoft', G.soft, G.soft.toFixed(2)); sv('chTint', G.shadowTint, G.shadowTint.toFixed(2)); sv('chRim', G.rim, G.rim.toFixed(2)); sv('chHigh', G.highlight, G.highlight.toFixed(2));
    $('chOut').checked = G.outline; $('chOutW').value = G.outlineWidth; $('chOutC').value = G.outlineColor; sv('chAz', G.lightAz, G.lightAz + '°'); sv('chEl', G.lightEl, G.lightEl + '°');
  }
  const editM = (patch) => { const m = byId(activeId); if (!m) return; Object.assign(m, patch); thumbs.delete(m.id); renderUI(true); };
  $('mtName').onchange = (e) => rename(activeId, e.target.value);
  $('mtKind').onchange = (e) => editM({ kind: e.target.value });
  $('mtColor').oninput = (e) => { editM({ color: e.target.value }); wheel.set(e.target.value); };
  $('mtShade').oninput = (e) => editM({ shade: e.target.value });
  $('mtBands').onchange = (e) => editM({ bands: +e.target.value });
  $('mtSoft').oninput = (e) => editM({ soft: +e.target.value < 0 ? undefined : +e.target.value });
  $('mtRim').oninput = (e) => editM({ rim: +e.target.value < 0 ? undefined : +e.target.value });
  $('mtOutline').onchange = (e) => editM({ outline: e.target.value || undefined });
  $('mtOutW').oninput = (e) => editM({ outlineWidth: +e.target.value }); $('mtOutC').oninput = (e) => editM({ outlineColor: e.target.value });
  $('mtTop').oninput = (e) => editM({ top: e.target.value }); $('mtBottom').oninput = (e) => editM({ bottom: e.target.value });
  $('mtFoam').oninput = (e) => editM({ foam: e.target.value }); $('mtFoamS').oninput = (e) => editM({ foamScale: +e.target.value }); $('mtWave').oninput = (e) => editM({ wave: +e.target.value });
  $('mtNew').onclick = () => libAction('new'); $('mtDup').onclick = () => libAction('dup');
  $('mtSlotAdd').onclick = () => { const m = curMesh(); if (m) addSlot(m); };
  $('mtSlotDel').onclick = () => { const m = curMesh(); if (m) removeSlot(m); };
  $('mtAssign').onclick = () => assignSlotToSelection(mfOf(curMesh() || { userData: {} }).active);
  $('mtSelect').onclick = () => { const m = curMesh(); if (m) selectSlotFaces(mfOf(m).active, true); };
  $('mtDeselect').onclick = () => { const m = curMesh(); if (m) selectSlotFaces(mfOf(m).active, false); };
  $('mtSetSlot').onclick = () => { const m = curMesh(); if (m) setSlotMaterial(m, mfOf(m).active, activeId); };
  $('mtAlb').querySelectorAll('button').forEach((b) => b.onclick = () => { const m = curMesh(); if (!m) return status('Select an object first'); setAlbedo(m, b.dataset.v); });
  $('mtTexNew').onclick = () => { const m = curMesh(); if (!m) return status('Select an object first'); createTexture(m, { name: $('mtTexName').value || 'albedo', res: +$('mtRes').value, fill: $('mtFill').value }); };
  $('mtTexDel').onclick = () => { const m = curMesh(); if (m) deleteTexture(m); };
  $('mtTexName').onchange = (e) => { const m = curMesh(); if (m && texOf(m)) renameTexture(m, e.target.value); };
  $('mtTex2D').onclick = () => ctx.open2D?.();
  const G = CHIBILI, gset = (k, v) => { G[k] = v; thumbs.clear(); renderUI(true); };
  $('chBands').oninput = (e) => gset('bands', +e.target.value); $('chSoft').oninput = (e) => gset('soft', +e.target.value); $('chTint').oninput = (e) => gset('shadowTint', +e.target.value);
  $('chRim').oninput = (e) => gset('rim', +e.target.value); $('chHigh').oninput = (e) => gset('highlight', +e.target.value); $('chOut').onchange = (e) => gset('outline', e.target.checked);
  $('chOutW').oninput = (e) => gset('outlineWidth', +e.target.value); $('chOutC').oninput = (e) => gset('outlineColor', e.target.value);
  $('chAz').oninput = (e) => gset('lightAz', +e.target.value); $('chEl').oninput = (e) => gset('lightEl', +e.target.value);
  // brush settings
  const link = (a, b, key) => { const f = (v) => { brush[key] = +v; $(a).value = v; $(b).value = v; }; $(a).oninput = (e) => f(e.target.value); $(b).onchange = (e) => f(e.target.value); };
  link('mpSize', 'mpSizeN', 'size'); link('mpOp', 'mpOpN', 'opacity');
  $('mpFall').onchange = (e) => (brush.falloff = e.target.value);
  $('mpMode').querySelectorAll('button').forEach((b) => b.onclick = () => { brush.mode = b.dataset.v; renderUI(); });
  $('mpOn').onclick = () => setPaint(!brush.on);

  // ---------- Material Paint brush ----------
  let stroke = null, paintDot = null, hoverXY = null;
  function setPaint(on) {
    brush.on = !!on; if (on && ctx.editor.mode === 'sculpt') { ctx.editor.setMode('object'); }
    if (on && !paintDot) { paintDot = document.createElement('div'); paintDot.className = 'paintdot'; vp.appendChild(paintDot); }
    if (paintDot) paintDot.hidden = !on; document.body.classList.toggle('mpaint', brush.on); renderUI(); ctx.onPaintToggle?.(brush.on);
    status(on ? `Material Paint: drag on a mesh to paint ${byId(activeId)?.name} (${{ face: 'face material', vcol: 'vertex colour', tex: 'texture' }[brush.mode]}). P or the button turns it off` : 'Material Paint off');
  }
  function updateDot() { if (!paintDot || !brush.on || !hoverXY) { if (paintDot) paintDot.style.display = 'none'; return; } const r = canvas.getBoundingClientRect(), vr = vp.getBoundingClientRect(); paintDot.style.display = 'block'; const d = brush.size * 2;
    Object.assign(paintDot.style, { width: d + 'px', height: d + 'px', left: (hoverXY[0] - vr.left - brush.size) + 'px', top: (hoverXY[1] - vr.top - brush.size) + 'px' }); void r; }
  function worldRadius(point, px) {
    const c = ctx.camera(), r = canvas.getBoundingClientRect(); let wpp;
    if (c.isOrthographicCamera) wpp = (c.top - c.bottom) / c.zoom / r.height;
    else { const d = point.clone().sub(c.position).dot(c.getWorldDirection(new THREE.Vector3())); wpp = 2 * d * Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) / r.height; }
    return px * wpp;
  }
  function blockPointer(e) { return brush.on && e.button === 0 && e.target === canvas && ctx.editor.mode !== 'sculpt'; }
  vp.addEventListener('pointerdown', (e) => {
    if (!blockPointer(e)) return;
    const objs = ctx.editor.mode === 'edit' && ctx.editor.debug.E ? [ctx.editor.debug.E.mesh] : ctx.meshes();
    const h = rayHit(e.clientX, e.clientY, objs); if (!h) return;   // off the mesh: let the camera orbit
    e.stopPropagation(); e.preventDefault(); canvas.setPointerCapture?.(e.pointerId);
    beginPaint(h, e);
  }, true);
  addEventListener('pointermove', (e) => {
    hoverXY = [e.clientX, e.clientY];
    if (!stroke) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; for (const ce of (evs.length ? evs : [e])) { const h = rayHit(ce.clientX, ce.clientY, [stroke.mesh]); if (h) dab(h, ce); }
  });
  addEventListener('pointerup', () => endPaint());
  function beginPaint(h, e) {
    const mesh = h.object, mf = mfOf(mesh), geo = mesh.geometry;
    let mode = brush.mode;
    if (mode === 'tex' && !texOf(mesh)) { createTexture(mesh, { name: `${(mesh.name || 'object').replace(/\W+/g, '_')}_albedo`, res: 1024 }); }
    if (mode === 'tex' && mf.albedo !== 'texture') setAlbedo(mesh, 'texture');
    const before = snap(mesh);
    stroke = { mesh, mode, before, weights: new Map(), slot: mode === 'face' ? slotIndex(mesh, activeId) : 0, color: new THREE.Color(byId(activeId)?.color || brush.color || '#ffffff') };
    if (mode === 'vcol') {
      if (!geo.attributes.color || !mf.vcol) initVertexColours(mesh);
      stroke.c0 = geo.attributes.color.array.slice(); before.colors = stroke.c0;
    }
    if (mode === 'tex') { const t = texOf(mesh); stroke.img0 = t.ctx.getImageData(0, 0, t.res, t.res); }
    mesh.updateMatrixWorld(true);
    stroke.inv = mesh.matrixWorld.clone().invert(); stroke.scale = mesh.matrixWorld.getMaxScaleOnAxis();
    stroke.cent = centroids(geo);
    dab(h, e);
  }
  function initVertexColours(mesh) {
    const geo = mesh.geometry, mf = mfOf(mesh), n = geo.attributes.position.count, s = getSlots(geo), idx = geo.index, nt = triCount(geo);
    const had = geo.attributes.color; const C = new Float32Array(n * 3); const tmp = new THREE.Color();
    const slotCol = mf.slots.map((id) => new THREE.Color(defFor(mesh, id).color));
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = idx ? idx.getX(t * 3 + k) : t * 3 + k; tmp.copy(slotCol[s[t]] || slotCol[0]); if (had && mf.slots[s[t]] === AUTO) tmp.multiply(new THREE.Color(had.getX(v), had.getY(v), had.getZ(v))); C[v * 3] = tmp.r; C[v * 3 + 1] = tmp.g; C[v * 3 + 2] = tmp.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); mf.vcol = true; refresh(mesh);
  }
  function centroids(geo) {
    const P = geo.attributes.position, idx = geo.index, nt = triCount(geo), C = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = idx ? idx.getX(t * 3 + k) : t * 3 + k; C[t * 3] += P.getX(v) / 3; C[t * 3 + 1] += P.getY(v) / 3; C[t * 3 + 2] += P.getZ(v) / 3; }
    return C;
  }
  function pressureOf(e) { return e && e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1; }
  function dab(h, e) {
    const S = stroke; if (!S) return; const mesh = S.mesh, geo = mesh.geometry, F = FALL[brush.falloff] || FALL.soft;
    const pr = pressureOf(e), px = brush.size * ($('mpPress').checked ? pr : 1);
    const rW = worldRadius(h.point, px), rL = rW / S.scale, c = h.point.clone().applyMatrix4(S.inv), r2 = rL * rL;
    if (S.mode === 'face') {
      const s = getSlots(geo), C = S.cent, nt = C.length / 3; let changed = false;
      for (let t = 0; t < nt; t++) { const dx = C[t * 3] - c.x, dy = C[t * 3 + 1] - c.y, dz = C[t * 3 + 2] - c.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > r2) continue;
        const w = F(Math.sqrt(d2) / rL) * brush.opacity; if (w >= 0.5 && s[t] !== S.slot) { s[t] = S.slot; changed = true; } }
      if (h.faceIndex != null && s[h.faceIndex] !== S.slot) { s[h.faceIndex] = S.slot; changed = true; }
      if (changed && ctx.isChibili()) { applyGroups(geo, mfOf(mesh).slots.length); geo.userData.mfGK = groupKey(mesh); if (!Array.isArray(mesh.material)) apply(mesh, true); }
    } else if (S.mode === 'vcol') {
      const P = geo.attributes.position, A = geo.attributes.color, col = A.array, n = P.count, tc = S.color;
      for (let v = 0; v < n; v++) { const dx = P.getX(v) - c.x, dy = P.getY(v) - c.y, dz = P.getZ(v) - c.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > r2) continue;
        const w = F(Math.sqrt(d2) / rL) * brush.opacity * pr, prev = S.weights.get(v) || 0; if (w <= prev) continue; S.weights.set(v, w);
        col[v * 3] = S.c0[v * 3] + (tc.r - S.c0[v * 3]) * w; col[v * 3 + 1] = S.c0[v * 3 + 1] + (tc.g - S.c0[v * 3 + 1]) * w; col[v * 3 + 2] = S.c0[v * 3 + 2] + (tc.b - S.c0[v * 3 + 2]) * w; }
      A.needsUpdate = true;
    } else if (S.mode === 'tex' && h.uv) {
      const t = texOf(mesh); if (!t) return;
      const texR = texelRadius(geo, h, rL, t.res);
      ctx.paintTexDab?.(mesh, h.uv.x, h.uv.y, texR, { color: '#' + S.color.getHexString(), opacity: brush.opacity * pr, falloff: brush.falloff }) || paintTexDabSimple(t, h.uv, texR, S.color, brush.opacity * pr);
      t.texture.needsUpdate = true;
    }
  }
  function texelRadius(geo, h, rL, res) {
    const idx = geo.index, uv = geo.attributes.uv, P = geo.attributes.position, t = h.faceIndex; if (!uv || t == null) return 8;
    const v = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
    const a = new THREE.Vector3().fromBufferAttribute(P, v[0]), b = new THREE.Vector3().fromBufferAttribute(P, v[1]), cc = new THREE.Vector3().fromBufferAttribute(P, v[2]);
    const A3 = b.clone().sub(a).cross(cc.clone().sub(a)).length() / 2;
    const ua = [uv.getX(v[0]), uv.getY(v[0])], ub = [uv.getX(v[1]), uv.getY(v[1])], uc = [uv.getX(v[2]), uv.getY(v[2])];
    const A2 = Math.abs((ub[0] - ua[0]) * (uc[1] - ua[1]) - (uc[0] - ua[0]) * (ub[1] - ua[1])) / 2;
    if (A3 < 1e-12 || A2 < 1e-12) return 6;
    return Math.max(1, Math.min(res / 2, rL * Math.sqrt(A2 / A3) * res));
  }
  function paintTexDabSimple(t, uv, r, color, op) {
    const g = t.ctx, x = uv.x * t.res, y = (1 - uv.y) * t.res, grd = g.createRadialGradient(x, y, 0, x, y, r), c = '#' + color.getHexString();
    grd.addColorStop(0, c); grd.addColorStop(0.6, c); grd.addColorStop(1, c + '00'); g.globalAlpha = op; g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.globalAlpha = 1; return true;
  }
  function endPaint() {
    const S = stroke; if (!S) return; stroke = null; const mesh = S.mesh, geo = mesh.geometry;
    if (S.mode === 'vcol') {
      const before = S.before, c0 = S.c0, c1 = geo.attributes.color.array.slice(), mfB = before.mf, mfA = JSON.parse(JSON.stringify(mfOf(mesh)));
      const setC = (arr, mfv) => { if (mesh.geometry !== geo) return; geo.attributes.color.array.set(arr); geo.attributes.color.needsUpdate = true; mesh.userData.mf = JSON.parse(JSON.stringify(mfv)); refresh(mesh); };
      ctx.editor.pushHistory({ label: 'Vertex colour paint', undo: () => setC(c0, mfB.vcol ? mfB : mfA), redo: () => setC(c1, mfA) });
    } else if (S.mode === 'tex') {
      const t = texOf(mesh), a = S.img0, b = t.ctx.getImageData(0, 0, t.res, t.res);
      ctx.editor.pushHistory({ label: 'Texture paint', undo: () => { t.ctx.putImageData(a, 0, 0); t.texture.needsUpdate = true; ctx.onTextureChange?.(mesh); }, redo: () => { t.ctx.putImageData(b, 0, 0); t.texture.needsUpdate = true; ctx.onTextureChange?.(mesh); } });
      ctx.onTextureChange?.(mesh);
    } else record(mesh, `Paint ${byId(activeId)?.name}`, S.before);
    refresh(mesh); status(`Painted ${byId(activeId)?.name} · Ctrl+Z to undo`);
  }
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === 'p' || e.key === 'P') && !document.body.classList.contains('land') && ctx.editor.mode !== 'sculpt' && (document.body.classList.contains('ws-shader') || brush.on)) { e.preventDefault(); e.stopImmediatePropagation(); setPaint(!brush.on); }
  }, true);

  function show(on) { libEl.hidden = !on; panel.hidden = !on; if (!on && brush.on) setPaint(false); if (on) renderUI(true); }
  function showLibrary(on) { libEl.hidden = !on; if (on) renderLib(); }
  renderUI(true);
  // test/debug + API
  return {
    lib, AUTO, apply, tick, mfOf, defFor, byId, get activeId() { return activeId; }, setActive, create, duplicate, rename, remove, update, libJSON, loadLib,
    assignObject, assignFaces, assignSlotToSelection, selectSlotFaces, addSlot, removeSlot, setSlotMaterial, dropMaterial,
    createTexture, deleteTexture, renameTexture, texOf, texDirty, setAlbedo, exportMaterial, adopt, adoptTextureImage,
    brush, setPaint, blockPointer, show, showLibrary, renderUI, initVertexColours, wheel, paintDab: (h, e) => dab(h, e), beginPaint, endPaint,
    get libEl() { return libEl; }, get panel() { return panel; },
  };
}
