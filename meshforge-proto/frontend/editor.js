// MeshForge editing layer: object selection, Move/Rotate/Scale (gizmo + G/R/S modal keys),
// Edit Mode (vertex / edge / face), undo/redo and client-side export.
// Original three.js (MIT) code written for MeshForge. Only general DCC-tool conventions are followed.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/TransformControls.js';
import { GLTFExporter } from 'three/addons/GLTFExporter.js';
import { OBJExporter } from 'three/addons/OBJExporter.js';
import { STLExporter } from 'three/addons/STLExporter.js';
import { PLYExporter } from 'three/addons/PLYExporter.js';

const ORANGE = new THREE.Color(0xff9a2e), DARK = new THREE.Color(0x101010), EDGE = new THREE.Color(0x1a1a1a), WHITE_V = new THREE.Color(0xffd27a);
const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const MAX_EDIT_TRIS = 200000;

export function createEditor(ctx) {
  const { scene, controls, canvas } = ctx;
  const vp = canvas.parentElement;
  const cam = () => ctx.camera();
  const S = { tool: 'select', mode: 'object', sel: null, selMode: 'vert', modal: null, mouse: new THREE.Vector2(-1, -1), quadCache: {}, down: null, box: null };
  let E = null;                                   // edit-mode data (see buildEdit)
  const undoStack = [], redoStack = [];
  const rc = new THREE.Raycaster();

  // ---------- helpers ----------
  const meshes = () => { const out = []; ctx.getModel()?.traverse((o) => { if (o.isMesh && !o.userData.isOverlay) out.push(o); }); return out; };
  const rect = () => canvas.getBoundingClientRect();
  const ndc = (p) => { const r = rect(); return new THREE.Vector2(p.x / r.width * 2 - 1, -(p.y / r.height) * 2 + 1); };
  const toScreen = (w) => { const r = rect(), v = w.clone().project(cam()); return new THREE.Vector2((v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height); };
  const rayAt = (p) => { rc.setFromCamera(ndc(p), cam()); return rc.ray; };
  const hitTest = (p, objs) => { rc.setFromCamera(ndc(p), cam()); return rc.intersectObjects(objs, false)[0]; };
  const status = (m) => ctx.status(m);

  // ---------- selection outline (screen-space back-face extrusion) ----------
  const outlineMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: ORANGE }, px: { value: 2.0 }, res: { value: new THREE.Vector2(1, 1) } },
    side: THREE.BackSide,
    vertexShader: `uniform float px; uniform vec2 res;
      void main(){ vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec2 d = (projectionMatrix * vec4(normalMatrix * normal, 0.0)).xy; float l = length(d);
        if (l > 1e-6) c.xy += d / l * px * 2.0 / res * c.w; gl_Position = c; }`,
    fragmentShader: `uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }`,
  });
  let outline = null;
  function select(obj) {
    if (outline) { outline.parent?.remove(outline); outline = null; }
    S.sel = obj || null;
    if (obj && S.mode === 'object') {
      outline = new THREE.Mesh(obj.geometry, outlineMat); outline.userData.isOverlay = true; outline.raycast = () => {};
      obj.add(outline);
    }
    updateGizmo(); ctx.updateInfo();
  }

  // ---------- transform gizmo ----------
  const tc = new TransformControls(cam(), canvas); tc.setSize(0.9);
  const tcHelper = tc.getHelper(); scene.add(tcHelper);
  const pivot = new THREE.Object3D(); scene.add(pivot);
  let tcTx = null, pivotStartInv = null;
  tc.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
  tc.addEventListener('mouseDown', () => { tcTx = begin(); pivot.updateMatrixWorld(); pivotStartInv = pivot.matrixWorld.clone().invert(); });
  tc.addEventListener('objectChange', () => {
    if (!tcTx) return;
    if (tcTx.kind === 'verts') { pivot.updateMatrixWorld(); applyDelta(tcTx, pivot.matrixWorld.clone().multiply(pivotStartInv)); }
    ctx.updateInfo();
  });
  tc.addEventListener('mouseUp', () => { if (tcTx) commit(tcTx, { translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[tc.mode]); tcTx = null; });

  function updateGizmo() {
    const mode = { move: 'translate', rotate: 'rotate', scale: 'scale' }[S.tool];
    tc.detach();
    if (!mode || S.modal) return;
    tc.setMode(mode);
    if (S.mode === 'object' && S.sel) { tc.setSpace(mode === 'scale' ? 'local' : 'world'); tc.attach(S.sel); }
    else if (S.mode === 'edit' && E && selectedVerts().length) {
      pivot.position.copy(pivotWorld()); pivot.quaternion.identity(); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld();
      tc.setSpace('world'); tc.attach(pivot);
    }
  }

  // ---------- transactions / undo ----------
  function begin() {
    if (S.mode === 'object') {
      const obj = S.sel; if (!obj) return null; obj.updateMatrixWorld(true);
      return { kind: 'obj', obj, m0: obj.matrix.clone(), w0: obj.matrixWorld.clone() };
    }
    const ids = selectedVerts(); if (!E || !ids.length) return null;
    E.mesh.updateMatrixWorld(true);
    const mw = E.mesh.matrixWorld, w = new Float32Array(ids.length * 3), v = new THREE.Vector3();
    ids.forEach((id, i) => { v.fromArray(E.U, id * 3).applyMatrix4(mw).toArray(w, i * 3); });
    return { kind: 'verts', mesh: E.mesh, ids, w, P0: E.mesh.geometry.attributes.position.array.slice() };
  }
  function setLocalFromWorld(obj, world) {
    const local = obj.parent ? obj.parent.matrixWorld.clone().invert().multiply(world) : world;
    local.decompose(obj.position, obj.quaternion, obj.scale); obj.updateMatrixWorld(true);
  }
  function applyDelta(t, D, axisScale) {
    if (t.kind === 'obj') {
      if (axisScale) { t.m0.decompose(t.obj.position, t.obj.quaternion, t.obj.scale); t.obj.scale.multiply(axisScale.s); t.obj.updateMatrixWorld(true);
        // keep the pivot (bbox centre) in place
        const c0 = axisScale.P, c1 = new THREE.Box3().setFromObject(t.obj).getCenter(new THREE.Vector3());
        t.obj.position.add(t.obj.parent ? t.obj.parent.worldToLocal(c0.clone()).sub(t.obj.parent.worldToLocal(c1.clone())) : c0.clone().sub(c1)); t.obj.updateMatrixWorld(true);
        return; }
      setLocalFromWorld(t.obj, D.clone().multiply(t.w0)); return;
    }
    const inv = t.mesh.matrixWorld.clone().invert(), v = new THREE.Vector3();
    t.ids.forEach((id, i) => { v.fromArray(t.w, i * 3).applyMatrix4(D).applyMatrix4(inv).toArray(E.U, id * 3); });
    syncGeometry(t.ids);
  }
  function cancel(t) {
    if (t.kind === 'obj') { t.m0.decompose(t.obj.position, t.obj.quaternion, t.obj.scale); t.obj.updateMatrixWorld(true); }
    else restorePositions(t.mesh, t.P0);
  }
  function commit(t, label) {
    if (t.kind === 'obj') {
      const m0 = t.m0, m1 = t.obj.matrix.clone(), obj = t.obj; if (m0.equals(m1)) return;
      const set = (m) => { m.decompose(obj.position, obj.quaternion, obj.scale); obj.updateMatrixWorld(true); };
      push({ label: label + ' object', undo: () => set(m0), redo: () => set(m1) });
    } else {
      const P0 = t.P0, P1 = t.mesh.geometry.attributes.position.array.slice(), mesh = t.mesh;
      push({ label: label + ' vertices', undo: () => restorePositions(mesh, P0), redo: () => restorePositions(mesh, P1) });
    }
    status(`${label} done · Ctrl+Z to undo`);
  }
  function push(e) { undoStack.push(e); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; }
  function undo() { const e = undoStack.pop(); if (!e) return status('Nothing to undo'); e.undo(); redoStack.push(e); afterHistory(); status('Undo: ' + e.label); }
  function redo() { const e = redoStack.pop(); if (!e) return status('Nothing to redo'); e.redo(); undoStack.push(e); afterHistory(); status('Redo: ' + e.label); }
  function afterHistory() { updateGizmo(); ctx.updateInfo(); }
  function restorePositions(mesh, P) {
    const geo = mesh.geometry; geo.attributes.position.array.set(P); finishGeometry(geo);
    if (E && E.mesh === mesh) { // pull welded positions back from the buffer
      for (let w = 0; w < E.nv; w++) { const b = E.gList[E.gStart[w]]; E.U[w * 3] = P[b * 3]; E.U[w * 3 + 1] = P[b * 3 + 1]; E.U[w * 3 + 2] = P[b * 3 + 2]; }
      refreshOverlay(true);
    }
  }
  function finishGeometry(geo) {
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
    geo.computeBoundingBox(); geo.computeBoundingSphere();
  }

  // ---------- edit mode data ----------
  const pkey = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  async function quadKeysFor(jobId) {
    if (!jobId) return null;
    if (jobId in S.quadCache) return S.quadCache[jobId];
    let set = null;
    try {
      const r = await fetch(`/api/jobs/${jobId}/mesh.obj`);
      if (r.ok) {
        const txt = await r.text(), V = [];
        for (const line of txt.split('\n')) {
          if (line.startsWith('v ')) { const p = line.split(/\s+/); V.push(pkey(+p[1], +p[2], +p[3])); }
          else if (line.startsWith('f ')) {
            const f = line.trim().split(/\s+/).slice(1).map((s) => V[parseInt(s, 10) - 1]);
            if (f.length !== 4) continue; set ??= new Set();
            for (let k = 0; k < 4; k++) { const a = f[k], b = f[(k + 1) % 4]; set.add(a < b ? a + '|' + b : b + '|' + a); }
          }
        }
      }
    } catch { /* fall back to triangle edges */ }
    return (S.quadCache[jobId] = set);
  }
  function buildEdit(mesh, quadSet) {
    const geo = mesh.geometry, pos = geo.attributes.position, n = pos.count;
    const map = new Map(), vid = new Int32Array(n), Ux = [], keys = [];
    for (let i = 0; i < n; i++) {
      const k = pkey(pos.getX(i), pos.getY(i), pos.getZ(i)); let w = map.get(k);
      if (w === undefined) { w = keys.length; map.set(k, w); keys.push(k); Ux.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
      vid[i] = w;
    }
    const nv = keys.length, U = new Float32Array(Ux);
    const gStart = new Int32Array(nv + 1); for (let i = 0; i < n; i++) gStart[vid[i] + 1]++;
    for (let w = 0; w < nv; w++) gStart[w + 1] += gStart[w];
    const fill = gStart.slice(0, nv), gList = new Int32Array(n); for (let i = 0; i < n; i++) gList[fill[vid[i]]++] = i;
    const idx = geo.index, nt = (idx ? idx.count : n) / 3 | 0, tris = new Int32Array(nt * 3);
    for (let i = 0; i < nt * 3; i++) tris[i] = vid[idx ? idx.getX(i) : i];
    // edges: hide triangle diagonals when the server produced real quads
    const ekey = new Map(), edges = [], triEdges = new Int32Array(nt * 3).fill(-1), diag = new Map();
    let quadHits = 0;
    const isQuadEdge = (a, b) => { const ka = keys[a], kb = keys[b]; return quadSet.has(ka < kb ? ka + '|' + kb : kb + '|' + ka); };
    if (quadSet) for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) if (isQuadEdge(tris[t * 3 + k], tris[t * 3 + (k + 1) % 3])) quadHits++;
    const useQuads = !!quadSet && quadHits > nt * 3 * 0.5;
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      let a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3]; if (a === b) continue; if (a > b) [a, b] = [b, a];
      const key = a * nv + b;
      if (useQuads && !isQuadEdge(a, b)) { const l = diag.get(key); if (l) l.push(t); else diag.set(key, [t]); continue; }
      let e = ekey.get(key); if (e === undefined) { e = edges.length / 2; ekey.set(key, e); edges.push(a, b); }
      triEdges[t * 3 + k] = e;
    }
    const partner = new Int32Array(nt).fill(-1);
    for (const l of diag.values()) if (l.length === 2) { partner[l[0]] = l[1]; partner[l[1]] = l[0]; }
    const ne = edges.length / 2;
    const E2 = { mesh, geo, vid, U, nv, gStart, gList, tris, nt, edges: new Int32Array(edges), ne, triEdges, partner, useQuads,
      selV: new Uint8Array(nv), selE: new Uint8Array(ne), selF: new Uint8Array(nt) };
    // overlays (children of the mesh so they follow the object transform)
    const posAttr = new THREE.BufferAttribute(U, 3); posAttr.setUsage(THREE.DynamicDrawUsage);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', posAttr); pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    E2.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true }));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ne * 6), 3)); lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ne * 6), 3));
    E2.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true }));
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', posAttr); fg.setIndex([]);
    E2.faces = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    for (const o of [E2.points, E2.lines, E2.faces]) { o.userData.isOverlay = true; o.raycast = () => {}; o.frustumCulled = false; o.renderOrder = 2; mesh.add(o); }
    return E2;
  }
  function destroyEdit() {
    if (!E) return;
    for (const o of [E.points, E.lines, E.faces]) { E.mesh.remove(o); o.geometry.dispose(); o.material.dispose(); }
    E = null;
  }
  function syncGeometry(ids) {
    const P = E.geo.attributes.position.array;
    for (const w of ids) for (let j = E.gStart[w]; j < E.gStart[w + 1]; j++) { const b = E.gList[j]; P[b * 3] = E.U[w * 3]; P[b * 3 + 1] = E.U[w * 3 + 1]; P[b * 3 + 2] = E.U[w * 3 + 2]; }
    finishGeometry(E.geo); refreshOverlay(true);
  }
  function selectedVerts() {
    if (!E) return [];
    const s = new Uint8Array(E.nv);
    if (S.selMode === 'vert') s.set(E.selV);
    else if (S.selMode === 'edge') { for (let e = 0; e < E.ne; e++) if (E.selE[e]) { s[E.edges[e * 2]] = 1; s[E.edges[e * 2 + 1]] = 1; } }
    else for (let t = 0; t < E.nt; t++) if (E.selF[t]) { s[E.tris[t * 3]] = 1; s[E.tris[t * 3 + 1]] = 1; s[E.tris[t * 3 + 2]] = 1; }
    const out = []; for (let w = 0; w < E.nv; w++) if (s[w]) out.push(w); return out;
  }
  function refreshOverlay(posChanged) {
    if (!E) return;
    const lp = E.lines.geometry.attributes.position, lc = E.lines.geometry.attributes.color, pc = E.points.geometry.attributes.color;
    if (posChanged) {
      for (let e = 0; e < E.ne; e++) { const a = E.edges[e * 2] * 3, b = E.edges[e * 2 + 1] * 3;
        lp.array.set(E.U.subarray(a, a + 3), e * 6); lp.array.set(E.U.subarray(b, b + 3), e * 6 + 3); }
      lp.needsUpdate = true; E.points.geometry.attributes.position.needsUpdate = true;
      E.lines.geometry.computeBoundingSphere(); E.points.geometry.computeBoundingSphere();
    }
    const sv = new Uint8Array(E.nv); for (const w of selectedVerts()) sv[w] = 1;
    for (let w = 0; w < E.nv; w++) (sv[w] ? ORANGE : DARK).toArray(pc.array, w * 3);
    const fsel = S.selMode === 'face';
    const faceEdge = fsel ? new Uint8Array(E.ne) : null;
    if (fsel) for (let t = 0; t < E.nt; t++) if (E.selF[t]) for (let k = 0; k < 3; k++) { const e = E.triEdges[t * 3 + k]; if (e >= 0) faceEdge[e] = 1; }
    for (let e = 0; e < E.ne; e++) {
      const on = S.selMode === 'edge' ? E.selE[e] : fsel ? faceEdge[e] : (sv[E.edges[e * 2]] && sv[E.edges[e * 2 + 1]]);
      const c = on ? ORANGE : EDGE; c.toArray(lc.array, e * 6); c.toArray(lc.array, e * 6 + 3);
    }
    pc.needsUpdate = lc.needsUpdate = true;
    E.points.visible = S.selMode === 'vert';
    const fi = []; if (fsel) for (let t = 0; t < E.nt; t++) if (E.selF[t]) fi.push(E.tris[t * 3], E.tris[t * 3 + 1], E.tris[t * 3 + 2]);
    E.faces.geometry.setIndex(fi);
    ctx.updateInfo();
  }
  function setSelMode(m) {
    if (!E || m === S.selMode) { S.selMode = m; ctx.setSelModeUI(m); refreshOverlay(false); return; }
    const sv = new Uint8Array(E.nv); for (const w of selectedVerts()) sv[w] = 1;   // convert the selection
    S.selMode = m; E.selV.fill(0); E.selE.fill(0); E.selF.fill(0);
    if (m === 'vert') E.selV.set(sv);
    else if (m === 'edge') { for (let e = 0; e < E.ne; e++) E.selE[e] = sv[E.edges[e * 2]] & sv[E.edges[e * 2 + 1]]; }
    else for (let t = 0; t < E.nt; t++) E.selF[t] = sv[E.tris[t * 3]] & sv[E.tris[t * 3 + 1]] & sv[E.tris[t * 3 + 2]];
    ctx.setSelModeUI(m); refreshOverlay(false); updateGizmo();
  }
  function selectAll(on) {
    if (S.mode === 'object') { select(on ? (S.sel || meshes()[0]) : null); return; }
    if (!E) return; const arr = { vert: E.selV, edge: E.selE, face: E.selF }[S.selMode];
    const any = arr.some((x) => x); arr.fill(on === undefined ? (any ? 0 : 1) : on ? 1 : 0);
    refreshOverlay(false); updateGizmo();
  }

  async function setMode(m) {
    if (m === S.mode || S.modal) { ctx.setModeUI(S.mode); return; }
    if (m === 'edit') {
      const mesh = S.sel || meshes()[0];
      if (!mesh) { status('Load or generate a model first'); ctx.setModeUI('object'); return; }
      const nt = (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;
      if (nt > MAX_EDIT_TRIS) { status(`Edit Mode is limited to ${MAX_EDIT_TRIS.toLocaleString()} triangles (this part has ${nt.toLocaleString()})`); ctx.setModeUI('object'); return; }
      select(mesh); if (outline) { outline.parent?.remove(outline); outline = null; }
      const quad = await quadKeysFor(ctx.jobId());
      E = buildEdit(mesh, quad); S.mode = 'edit'; refreshOverlay(true);
      status(`Edit Mode · ${E.nv.toLocaleString()} verts · ${E.ne.toLocaleString()} ${E.useQuads ? 'quad ' : ''}edges · 1/2/3 select mode · G/R/S transform · A select all · Tab to leave`);
    } else {
      destroyEdit(); S.mode = 'object'; select(S.sel); status('Object Mode');
    }
    ctx.setModeUI(S.mode); updateGizmo(); ctx.updateInfo();
  }

  // ---------- picking ----------
  function pickObject(p, extend) {
    const hit = hitTest(p, meshes());
    select(hit ? hit.object : (extend ? S.sel : null));
  }
  function pickElement(p, extend) {
    const hit = hitTest(p, [E.mesh]);
    const arr = { vert: E.selV, edge: E.selE, face: E.selF }[S.selMode];
    if (!hit) { if (!extend) { arr.fill(0); refreshOverlay(false); updateGizmo(); } return; }
    const t = hit.faceIndex, mw = E.mesh.matrixWorld, tris = [t]; if (E.partner[t] >= 0) tris.push(E.partner[t]);
    const scr = (w) => toScreen(new THREE.Vector3().fromArray(E.U, w * 3).applyMatrix4(mw));
    let ids = [];
    if (S.selMode === 'vert') {
      let best = -1, bd = Infinity; for (const tt of tris) for (let k = 0; k < 3; k++) { const w = E.tris[tt * 3 + k], d = scr(w).distanceTo(p); if (d < bd) { bd = d; best = w; } }
      ids = [best];
    } else if (S.selMode === 'edge') {
      let best = -1, bd = Infinity;
      for (const tt of tris) for (let k = 0; k < 3; k++) {
        const e = E.triEdges[tt * 3 + k]; if (e < 0) continue;
        const a = scr(E.edges[e * 2]), b = scr(E.edges[e * 2 + 1]), ab = b.clone().sub(a);
        const u = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
        const d = a.clone().addScaledVector(ab, u).distanceTo(p); if (d < bd) { bd = d; best = e; }
      }
      ids = best >= 0 ? [best] : [];
    } else ids = tris;
    if (!extend) arr.fill(0);
    const on = extend ? !arr[ids[0]] : 1; for (const i of ids) arr[i] = on;
    refreshOverlay(false); updateGizmo();
  }
  function boxSelect(a, b, extend) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const mw = E.mesh.matrixWorld, inv = mw.clone().invert(), c = cam();
    // front-facing test in mesh space (no x-ray): a vertex counts if any adjacent triangle faces the camera
    const camL = c.isOrthographicCamera ? null : c.position.clone().applyMatrix4(inv);
    const viewDirL = c.getWorldDirection(new THREE.Vector3()).transformDirection(inv);
    const front = new Uint8Array(E.nt), fv = new Uint8Array(E.nv), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), Q = new THREE.Vector3();
    for (let t = 0; t < E.nt; t++) {
      A.fromArray(E.U, E.tris[t * 3] * 3); B.fromArray(E.U, E.tris[t * 3 + 1] * 3); C.fromArray(E.U, E.tris[t * 3 + 2] * 3);
      N.subVectors(B, A).cross(Q.subVectors(C, A));
      const toCam = camL ? Q.copy(camL).sub(A) : Q.copy(viewDirL).negate();
      if (N.dot(toCam) > 0) { front[t] = 1; fv[E.tris[t * 3]] = fv[E.tris[t * 3 + 1]] = fv[E.tris[t * 3 + 2]] = 1; }
    }
    const inR = new Uint8Array(E.nv), v = new THREE.Vector3(), r = rect();
    for (let w = 0; w < E.nv; w++) {
      v.fromArray(E.U, w * 3).applyMatrix4(mw).project(c);
      const sx = (v.x + 1) / 2 * r.width, sy = (1 - v.y) / 2 * r.height;
      inR[w] = sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && v.z < 1 ? 1 : 0;
    }
    const arr = { vert: E.selV, edge: E.selE, face: E.selF }[S.selMode]; if (!extend) arr.fill(0);
    if (S.selMode === 'vert') { for (let w = 0; w < E.nv; w++) if (inR[w] && fv[w]) arr[w] = 1; }
    else if (S.selMode === 'edge') { for (let e = 0; e < E.ne; e++) { const p = E.edges[e * 2], q = E.edges[e * 2 + 1]; if (inR[p] && inR[q] && (fv[p] || fv[q])) arr[e] = 1; } }
    else for (let t = 0; t < E.nt; t++) if (front[t] && inR[E.tris[t * 3]] && inR[E.tris[t * 3 + 1]] && inR[E.tris[t * 3 + 2]]) arr[t] = 1;
    refreshOverlay(false); updateGizmo();
  }

  // ---------- modal G / R / S ----------
  function pivotWorld() {
    if (S.mode === 'object') return S.sel ? new THREE.Box3().setFromObject(S.sel).getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const ids = selectedVerts(), c = new THREE.Vector3(), v = new THREE.Vector3(); E.mesh.updateMatrixWorld(true);
    for (const w of ids) c.add(v.fromArray(E.U, w * 3).applyMatrix4(E.mesh.matrixWorld));
    return ids.length ? c.divideScalar(ids.length) : c;
  }
  function planePoint(p, P) {
    const ray = rayAt(p), n = cam().getWorldDirection(new THREE.Vector3());
    return ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, P), new THREE.Vector3()) || P.clone();
  }
  function axisParam(p, P, a) { // closest point on the axis line (P + s*a) to the mouse ray
    const ray = rayAt(p), w0 = P.clone().sub(ray.origin), b = a.dot(ray.direction), d = a.dot(w0), e = ray.direction.dot(w0);
    const den = 1 - b * b; return den < 1e-6 ? 0 : (b * e - d) / den;
  }
  function mouseOrCenter() { const r = rect(); return (S.mouse.x < 0 || S.mouse.x > r.width || S.mouse.y < 0 || S.mouse.y > r.height) ? new THREE.Vector2(r.width / 2, r.height / 2) : S.mouse.clone(); }
  function startModal(kind) {
    if (S.modal) return;
    const t = begin(); if (!t) return status(S.mode === 'edit' ? 'Select some vertices, edges or faces first' : 'Click an object to select it first');
    const P = pivotWorld(), m0 = mouseOrCenter(), pc = toScreen(P);
    if (kind !== 'G' && m0.distanceTo(pc) < 20) m0.set(pc.x + 80, pc.y);
    S.modal = { kind, t, P, axis: null, m0, pc, w0: planePoint(m0, P), snap: false };
    tc.detach(); controls.enabled = false; updateModal();
  }
  function updateModal() {
    const M = S.modal; if (!M) return;
    const m = S.mouse.x < 0 ? M.m0 : S.mouse, ax = M.axis ? AXIS[M.axis] : null;
    let D = new THREE.Matrix4(), txt = '', axisScale = null;
    if (M.kind === 'G') {
      const d = ax ? ax.clone().multiplyScalar(axisParam(m, M.P, ax) - axisParam(M.m0, M.P, ax)) : planePoint(m, M.P).sub(M.w0);
      if (M.snap) d.set(Math.round(d.x * 10) / 10, Math.round(d.y * 10) / 10, Math.round(d.z * 10) / 10);
      D.makeTranslation(d.x, d.y, d.z); txt = `Move  Δ ${d.x.toFixed(3)}, ${d.y.toFixed(3)}, ${d.z.toFixed(3)}`;
    } else if (M.kind === 'R') {
      const a0 = Math.atan2(-(M.m0.y - M.pc.y), M.m0.x - M.pc.x), a1 = Math.atan2(-(m.y - M.pc.y), m.x - M.pc.x);
      let ang = a1 - a0; if (M.snap) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      const toCam = cam().getWorldDirection(new THREE.Vector3()).negate();
      let axis = toCam; if (ax) { axis = ax.clone(); if (ax.dot(toCam) < 0) ang = -ang; }
      D = new THREE.Matrix4().makeTranslation(M.P.x, M.P.y, M.P.z).multiply(new THREE.Matrix4().makeRotationAxis(axis, ang)).multiply(new THREE.Matrix4().makeTranslation(-M.P.x, -M.P.y, -M.P.z));
      txt = `Rotate  ${THREE.MathUtils.radToDeg(ang).toFixed(1)}°`;
    } else {
      let f = m.distanceTo(M.pc) / Math.max(M.m0.distanceTo(M.pc), 1); if (M.snap) f = Math.round(f * 10) / 10;
      const s = ax ? new THREE.Vector3(1, 1, 1).add(ax.clone().multiplyScalar(f - 1)) : new THREE.Vector3(f, f, f);
      D = new THREE.Matrix4().makeTranslation(M.P.x, M.P.y, M.P.z).multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z)).multiply(new THREE.Matrix4().makeTranslation(-M.P.x, -M.P.y, -M.P.z));
      if (ax && M.t.kind === 'obj') axisScale = { s, P: M.P };
      txt = `Scale  ${f.toFixed(3)}`;
    }
    applyDelta(M.t, D, axisScale);
    status(`${txt}${M.axis ? `  along ${M.axis.toUpperCase()}` : ''}${M.snap ? '  (snap)' : ''}  ·  click/Enter confirm · Esc/right-click cancel · X/Y/Z axis · hold Ctrl to snap`);
  }
  function endModal(ok) {
    const M = S.modal; if (!M) return; S.modal = null; controls.enabled = true;
    if (ok) commit(M.t, { G: 'Move', R: 'Rotate', S: 'Scale' }[M.kind]); else { cancel(M.t); status('Cancelled'); }
    updateGizmo(); ctx.updateInfo();
  }

  // ---------- input ----------
  const boxDiv = document.createElement('div'); boxDiv.className = 'boxsel'; boxDiv.hidden = true; vp.appendChild(boxDiv);
  const local = (e) => { const r = rect(); return new THREE.Vector2(e.clientX - r.left, e.clientY - r.top); };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  vp.addEventListener('pointerdown', (e) => {
    if (S.modal) { e.preventDefault(); e.stopPropagation(); endModal(e.button === 0); return; }
    if (e.target !== canvas) return;
    S.down = e.button === 0 ? { p: local(e), onGizmo: !!tc.object && tc.axis !== null } : null;
  }, true);
  addEventListener('pointermove', (e) => {
    S.mouse.copy(local(e));
    if (S.modal) { S.modal.snap = e.ctrlKey; updateModal(); return; }
    if (S.down && !S.down.onGizmo && S.mode === 'edit' && S.tool === 'select' && S.down.p.distanceTo(S.mouse) > 4) {
      S.box = true; const a = S.down.p, b = S.mouse;
      Object.assign(boxDiv.style, { left: Math.min(a.x, b.x) + 'px', top: Math.min(a.y, b.y) + 'px', width: Math.abs(a.x - b.x) + 'px', height: Math.abs(a.y - b.y) + 'px' }); boxDiv.hidden = false;
    }
  });
  addEventListener('pointerup', (e) => {
    const d = S.down; S.down = null; boxDiv.hidden = true;
    if (!d || e.button !== 0 || d.onGizmo || tc.dragging) { S.box = false; return; }
    const p = local(e);
    if (S.box) { S.box = false; boxSelect(d.p, p, e.shiftKey); return; }
    if (d.p.distanceTo(p) > 4) return;                  // it was an orbit drag
    if (S.mode === 'edit') pickElement(p, e.shiftKey); else pickObject(p, e.shiftKey);
  });

  function handleKey(e) {
    const k = e.key.toLowerCase();
    if (S.modal) {
      if (k === 'escape') endModal(false);
      else if (k === 'enter' || k === ' ') endModal(true);
      else if (k === 'x' || k === 'y' || k === 'z') { S.modal.axis = S.modal.axis === k ? null : k; updateModal(); }
      else if (k === 'control') { S.modal.snap = true; updateModal(); }
      else if (k === 'g' || k === 'r' || k === 's') { const kind = k.toUpperCase(); if (kind !== S.modal.kind) { cancel(S.modal.t); S.modal.kind = kind; updateModal(); } }
      e.preventDefault(); return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return true; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey && k !== 'a') return false;
    if (e.key === 'Tab') { e.preventDefault(); setMode(S.mode === 'edit' ? 'object' : 'edit'); return true; }
    if (k === 'g' || k === 'r' || k === 's') { e.preventDefault(); startModal(k.toUpperCase()); return true; }
    if (k === 'a') { e.preventDefault(); selectAll(e.altKey ? false : undefined); return true; }
    if (k === 'escape' && S.mode === 'object' && S.sel) { select(null); return true; }
    if (S.mode === 'edit' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { setSelMode({ Digit1: 'vert', Digit2: 'edge', Digit3: 'face' }[e.code]); return true; }
    return false;
  }
  addEventListener('keyup', (e) => { if (S.modal && e.key === 'Control') { S.modal.snap = false; updateModal(); } });

  function setTool(t) { S.tool = t; updateGizmo(); }

  // ---------- export ----------
  function exportGroup() {
    const model = ctx.getModel(); if (!model) return null;
    model.updateMatrixWorld(true);
    const Ninv = (model.userData.norm || new THREE.Matrix4()).clone().invert(); // undo the viewer's fit-to-view scale only
    const g = new THREE.Group(); g.name = 'MeshForge';
    for (const m of meshes()) {
      const geo = m.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(Ninv, m.matrixWorld));
      const src = m.userData.orig || m.material, mat = new THREE.MeshStandardMaterial({ color: src.color ? src.color.clone() : 0xffffff, vertexColors: !!geo.attributes.color, roughness: 0.6 });
      const o = new THREE.Mesh(geo, mat); o.name = m.name || 'mesh'; g.add(o);
    }
    g.updateMatrixWorld(true); return g;
  }
  async function encode(fmt) {
    const g = exportGroup(); if (!g) throw new Error('No model loaded');
    if (fmt === 'glb') return new Blob([await new GLTFExporter().parseAsync(g, { binary: true })], { type: 'model/gltf-binary' });
    if (fmt === 'obj') return new Blob([new OBJExporter().parse(g)], { type: 'text/plain' });
    if (fmt === 'stl') return new Blob([new STLExporter().parse(g, { binary: true })], { type: 'model/stl' });
    if (fmt === 'ply') return new Blob([await new Promise((res) => new PLYExporter().parse(g, res, { binary: true }))], { type: 'application/octet-stream' });
    throw new Error('Unknown format ' + fmt);
  }
  function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  const baseName = () => `meshforge_${ctx.jobId() || 'model'}`;
  async function exportAs(fmt) {
    try { const b = await encode(fmt); save(b, `${baseName()}.${fmt}`); status(`Exported ${fmt.toUpperCase()} (${(b.size / 1024).toFixed(0)} KB) with your edits and transforms`); }
    catch (err) { status('Export failed: ' + err.message); console.error(err); }
  }
  async function previewPNG() {
    const hide = [tcHelper, outline].filter(Boolean), vis = hide.map((o) => o.visible); hide.forEach((o) => (o.visible = false));
    ctx.renderer.render(scene, cam());
    const blob = await new Promise((r) => ctx.renderer.domElement.toBlob(r, 'image/png'));
    hide.forEach((o, i) => (o.visible = vis[i])); return blob;
  }
  async function exportZip() {
    try {
      const files = [];
      for (const f of ['glb', 'obj']) files.push({ name: `mesh.${f}`, data: new Uint8Array(await (await encode(f)).arrayBuffer()) });
      files.push({ name: 'preview.png', data: new Uint8Array(await (await previewPNG()).arrayBuffer()) });
      const zip = makeZip(files); save(zip, `${baseName()}.zip`); status(`Downloaded ${baseName()}.zip (mesh.glb, mesh.obj, preview.png)`);
    } catch (err) { status('Zip failed: ' + err.message); console.error(err); }
  }

  function reset() { endModal(false); destroyEdit(); S.mode = 'object'; ctx.setModeUI('object'); select(null); undoStack.length = redoStack.length = 0; }
  function tick() {
    tc.camera = cam();
    const sz = ctx.renderer.getDrawingBufferSize(new THREE.Vector2()); outlineMat.uniforms.res.value.copy(sz); outlineMat.uniforms.px.value = 1.6 * ctx.renderer.getPixelRatio();
  }
  function infoLine() {
    if (S.mode === 'edit' && E) { const n = { vert: E.nv, edge: E.ne, face: E.nt }[S.selMode], s = { vert: E.selV, edge: E.selE, face: E.selF }[S.selMode].reduce((a, b) => a + b, 0);
      return `Edit Mode · ${s.toLocaleString()}/${n.toLocaleString()} ${{ vert: 'verts', edge: 'edges', face: 'tris' }[S.selMode]}`; }
    return S.sel ? `Selected: ${S.sel.name || 'mesh'}` : '';
  }
  // test hook
  const debug = { get S() { return S; }, get E() { return E; }, undoStack, redoStack, startModal, endModal, updateModal, pickObject, pickElement, boxSelect, encode, toScreen, meshes };
  return { handleKey, setTool, setMode, setSelMode, selectAll, undo, redo, exportAs, exportZip, encode, reset, tick, infoLine, select, debug, get mode() { return S.mode; } };
}

// Minimal store-only ZIP writer (no compression) so the download works fully offline.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
    parts.push(h, name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c, name); off += 30 + name.length + f.data.length;
  }
  const csize = central.reduce((a, b) => a + b.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
