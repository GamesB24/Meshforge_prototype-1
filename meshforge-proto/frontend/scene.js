// MeshForge v6 scene import / export (original MIT code).
// A "scene" is many separate objects in one viewport. Each object is ONE THREE.Mesh (its parts are merged,
// part colours baked into vertex colours) placed as a direct child of the scene root group, so the existing
// object picking, Edit Mode, Sculpt Mode, gizmo and undo work on one object at a time.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';

const D2R = Math.PI / 180;
const isOverlay = (o) => o.userData?.isOverlay;

// Merge every mesh under `root` into one geometry expressed in root's local space.
export function bakeObject(root, name) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const parts = []; root.traverse((o) => { if (o.isMesh && !isOverlay(o) && o.geometry?.attributes?.position) parts.push(o); });
  if (!parts.length) return null;
  const rel = (m) => new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
  let geo, mat, partInfo = [], hadVC = false;
  if (parts.length === 1 && !Array.isArray(parts[0].material)) {           // keep UVs / textures / vertex colours as they are
    const p = parts[0]; geo = p.geometry.clone(); geo.applyMatrix4(rel(p));
    mat = p.material.clone(); mat.userData = p.material.userData; if (p.material.map) mat.map = p.material.map;
    partInfo = [{ material: p.material, triStart: 0, triCount: (geo.index ? geo.index.count : geo.attributes.position.count) / 3 }]; hadVC = true;
  } else {
    const P = [], N = [], C = [], UV = []; const col = new THREE.Color(); const allUV = parts.every((p) => p.geometry.attributes.uv);
    for (const p of parts) {
      let g = p.geometry.clone(); if (g.index) g = g.toNonIndexed(); g.applyMatrix4(rel(p));
      if (!g.attributes.normal) g.computeVertexNormals();
      const pos = g.attributes.position, nor = g.attributes.normal, vc = g.attributes.color;
      const m = Array.isArray(p.material) ? p.material[0] : p.material; const mc = m?.color || new THREE.Color(1, 1, 1);
      partInfo.push({ material: m, triStart: P.length / 9, triCount: pos.count / 3 }); if (vc) hadVC = true;
      if (allUV) { const ua = g.attributes.uv; for (let i = 0; i < pos.count; i++) UV.push(ua.getX(i), ua.getY(i)); }
      for (let i = 0; i < pos.count; i++) {
        P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        if (vc) col.setRGB(vc.getX(i), vc.getY(i), vc.getZ(i)); else col.setRGB(1, 1, 1);
        C.push(col.r * mc.r, col.g * mc.g, col.b * mc.b);
      }
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); if (allUV) geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0 });
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  mat.side = THREE.DoubleSide; mat.vertexColors = !!geo.attributes.color;
  const mesh = new THREE.Mesh(geo, mat); mesh.name = name || root.name || 'object';
  // v7: MeshForge-written materials (GLB extras) come back as material slots / an engine texture
  const mats = window.__meshforge?.mats;
  if (mats && partInfo.length && partInfo.some((p) => p.material?.userData?.chibili || p.material?.userData?.mfTexture) && mats.adopt(mesh, partInfo)) {
    if (partInfo.length > 1 && !hadVC) { geo.deleteAttribute('color'); mat.vertexColors = false; }
  }
  const ca = geo.attributes.color;   // remember the average colour: Sculpt Mode welds the mesh and drops vertex colours
  if (ca) { const a = new THREE.Color(0, 0, 0); for (let i = 0; i < ca.count; i++) { a.r += ca.getX(i); a.g += ca.getY(i); a.b += ca.getZ(i); } a.multiplyScalar(1 / Math.max(ca.count, 1)); mesh.userData.avgColor = a.multiply(mat.color || new THREE.Color(1, 1, 1)).getHex(); }
  return mesh;
}

function applyTransform(obj, o) {
  const v3 = (a) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => Number.isFinite(+x));
  if (v3(o.position)) obj.position.set(+o.position[0], +o.position[1], +o.position[2]);
  const q = o.quaternion || (Array.isArray(o.rotation) && o.rotation.length === 4 ? o.rotation : null);
  if (q) obj.quaternion.set(+q[0], +q[1], +q[2], +q[3]).normalize();
  else if (v3(o.rotationDeg)) obj.rotation.set(o.rotationDeg[0] * D2R, o.rotationDeg[1] * D2R, o.rotationDeg[2] * D2R);
  else if (v3(o.rotation)) { const k = o.rotationUnits === 'deg' || o.rotationUnits === 'degrees' ? D2R : 1; obj.rotation.set(o.rotation[0] * k, o.rotation[1] * k, o.rotation[2] * k); }
  if (Number.isFinite(+o.scale) && o.scale !== null && !Array.isArray(o.scale)) obj.scale.setScalar(+o.scale);
  else if (v3(o.scale)) obj.scale.set(+o.scale[0], +o.scale[1], +o.scale[2]);
}

export function createSceneIO(ctx) {
  // ctx: { getRoot(), setRoot(group), editor, afterLoad(), status(msg) }
  let manifest = null, baseURL = null, fileMap = null;
  const loader = new GLTFLoader();
  const parseGLB = (buf, base) => new Promise((res, rej) => loader.parse(buf, base || '', res, rej));

  async function fetchBuf(ref) {
    if (ref instanceof Blob) return ref.arrayBuffer();
    if (ref instanceof ArrayBuffer) return ref;
    const key = String(ref).split(/[\\/]/).pop();
    if (fileMap && fileMap.has(key)) return fileMap.get(key).arrayBuffer();
    const url = baseURL ? new URL(ref, baseURL).href : ref;
    const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.arrayBuffer();
  }
  const resolve = (ref) => { try { return baseURL ? new URL(ref, baseURL).href : ref; } catch { return ref; } };

  function ensureRoot(append) {
    let root = ctx.getRoot();
    if (!append || !root?.userData.isScene) {
      root = new THREE.Group(); root.name = 'Scene'; root.userData.isScene = true; root.userData.norm = new THREE.Matrix4();
      ctx.setRoot(root);
    }
    return root;
  }
  let seq = 0;
  function addObject(root, mesh, info) {
    const id = String(info.id ?? `obj_${++seq}`);
    let uid = id, k = 2; while (objects().some((m) => m.userData.sceneId === uid)) uid = `${id}_${k++}`;
    mesh.name = String(info.label || info.name || mesh.name || uid);
    mesh.userData.sceneId = uid; mesh.userData.label = mesh.name; mesh.userData.source = info.source || '';
    mesh.userData.note = info.note; mesh.userData.ref = info.glb || info.mesh || info.url || null; mesh.userData.extra = info.extra;
    if (info.color) { try { mesh.material.color = new THREE.Color(info.color); } catch { /* ignore bad colour */ } }
    if (info.visible === false) mesh.visible = false;
    if (Array.isArray(info.behaviours)) mesh.userData.behaviours = JSON.parse(JSON.stringify(info.behaviours));
    root.add(mesh); return mesh;
  }
  const objects = () => (ctx.getRoot()?.userData.isScene ? ctx.getRoot().children.filter((o) => o.isMesh && o.userData.sceneId) : []);

  // Accept: manifest object, URL string (.json or .glb/.gltf), File/Blob, ArrayBuffer, FileList/array of Files.
  async function loadScene(src, opts = {}) {
    const errors = [], loaded = []; fileMap = null; baseURL = null;
    try {
      if (src instanceof FileList || Array.isArray(src)) {
        const files = [...src]; fileMap = new Map(files.map((f) => [f.name, f]));
        src = files.find((f) => /\.json$/i.test(f.name)) || files.find((f) => /\.gl(b|tf)$/i.test(f.name));
        if (!src) throw new Error('No .json or .glb among the chosen files');
      }
      let kind = null, data = null;
      if (typeof src === 'string') {
        baseURL = new URL(src, location.href).href;
        const r = await fetch(baseURL); if (!r.ok) throw new Error(`HTTP ${r.status} for ${src}`);
        const buf = await r.arrayBuffer(); [kind, data] = sniff(buf);
      } else if (src instanceof Blob || src instanceof ArrayBuffer) {
        const buf = src instanceof Blob ? await src.arrayBuffer() : src; [kind, data] = sniff(buf);
        if (opts.baseURL) baseURL = new URL(opts.baseURL, location.href).href;
      } else if (src && typeof src === 'object') { kind = 'json'; data = src; if (opts.baseURL) baseURL = new URL(opts.baseURL, location.href).href; }
      else throw new Error('loadScene expects a URL, File, Blob, ArrayBuffer or manifest object');
      ctx.editor.reset();
      const root = ensureRoot(!!opts.append);
      if (kind === 'glb') {
        manifest = { version: 1, objects: [] };
        const g = await parseGLB(data, baseURL || '');
        let tops = g.scene.children;
        if (tops.length === 1 && !tops[0].isMesh && tops[0].children.length > 1) tops = tops[0].children;   // single wrapper node
        g.scene.updateMatrixWorld(true);
        tops.forEach((t, i) => {
          const m = bakeObject(t, t.name); if (!m) return;
          t.matrixWorld.decompose(m.position, m.quaternion, m.scale);
          const x = t.userData || {}; // MeshForge-exported scenes keep id/label/source in node extras
          loaded.push(addObject(root, m, { id: x.id || t.name || `obj_${i}`, label: x.label || t.name || `Object ${i + 1}`, source: x.source || 'glb' }));
        });
      } else {
        manifest = data; const list = Array.isArray(data.objects) ? data.objects : [];
        if (!list.length) errors.push('Manifest has no objects');
        const results = await Promise.allSettled(list.map(async (o, i) => {
          const ref = o.glb ?? o.mesh ?? o.url ?? o.file;
          if (!ref) throw new Error('no glb/mesh path');
          if (/\.obj(\?|$)/i.test(ref)) throw new Error('OBJ meshes are not supported in scenes yet; use GLB');
          const g = await parseGLB(await fetchBuf(ref), resolve(ref));
          const m = bakeObject(g.scene, o.label || o.id || `Object ${i + 1}`); if (!m) throw new Error('GLB has no mesh');
          return m;
        }));
        results.forEach((r, i) => {
          const o = list[i];
          if (r.status === 'rejected') { errors.push(`${o.id ?? i} (${o.label ?? ''}): ${r.reason?.message || r.reason}`); return; }
          applyTransform(r.value, o); loaded.push(addObject(root, r.value, { ...o, id: o.id ?? `obj_${i}` }));
        });
      }
      ctx.afterLoad(manifest, baseURL);
    } catch (e) { errors.push(e.message || String(e)); }
    for (const e of errors) console.warn('[MeshForge scene]', e);
    ctx.status(`Scene: ${loaded.length} object(s) loaded${errors.length ? `, ${errors.length} problem(s): ${errors[0]}` : ''}`);
    return { ok: loaded.length > 0, objects: loaded.map((m) => ({ id: m.userData.sceneId, label: m.userData.label })), errors };
  }
  function sniff(buf) {
    const u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (u[0] === 0x67 && u[1] === 0x6c && u[2] === 0x54 && u[3] === 0x46) return ['glb', buf];   // 'glTF'
    const txt = new TextDecoder().decode(buf), j = JSON.parse(txt);
    if (j.asset && (j.meshes || j.nodes)) return ['glb', buf];                                     // .gltf JSON
    return ['json', j];
  }

  function exportScene() {
    const base = manifest ? JSON.parse(JSON.stringify(manifest)) : { version: 1 };
    const src = new Map((manifest?.objects || []).map((o) => [String(o.id), o]));
    base.version = 1; base.up = base.up || 'Y'; base.units = base.units || 'm'; base.generator = 'MeshForge 7.0';
    base.objects = objects().map((m) => {
      const o = { ...(src.get(m.userData.sceneId) || {}) };
      delete o.rotationDeg; delete o.quaternion; delete o.mesh;
      Object.assign(o, { id: m.userData.sceneId, label: m.userData.label, source: m.userData.source || o.source || '', glb: m.userData.ref || o.glb || null,
        position: m.position.toArray().map((x) => +x.toFixed(5)), rotation: [m.rotation.x, m.rotation.y, m.rotation.z].map((x) => +x.toFixed(5)),
        scale: m.scale.toArray().map((x) => +x.toFixed(5)), visible: m.visible, node: m.name });
      if (m.userData.note != null) o.note = m.userData.note;
      if (Array.isArray(m.userData.behaviours) && m.userData.behaviours.length) {
        o.behaviours = m.userData.behaviours.filter((b) => b && b.type).map((b) => ({ type: b.type, enabled: b.enabled !== false, params: b.params || {} }));
      }
      return o;
    });
    return base;
  }
  return { loadScene, exportScene, objects, addObject, ensureRoot, get manifest() { return manifest; }, get baseURL() { return baseURL; }, resolve };
}
