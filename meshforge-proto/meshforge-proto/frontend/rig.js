// MeshForge v7 rigging (original MIT code): keeps glTF skins (made in any DCC, e.g. a Blender rig exported as GLB),
// shows bones, plays / scrubs clips, lets you pose bones, shows a weight heat map and exports GLB with skeleton + clips.
// Skinned meshes are view / pose / material only: Edit Mode and Sculpt Mode are blocked on them (see docs/rigging.md).
import * as THREE from 'three';
import { copyData } from './mfdata.js';

export function glbHasSkins(buf) { // quick look at the GLB JSON chunk (or a .gltf text) without parsing the whole file
  try {
    const u8 = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
    if (u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46) { const dv = new DataView(u8.buffer, u8.byteOffset), len = dv.getUint32(12, true); const j = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + len))); return !!(j.skins && j.skins.length); }
    const j = JSON.parse(new TextDecoder().decode(u8)); return !!(j.skins && j.skins.length);
  } catch { return false; }
}

// clone a hierarchy and re-bind every skinned mesh to the cloned bones (own implementation)
export function cloneRig(root) {
  const c = root.clone(true), map = new Map(), a = [], b = [];
  root.traverse((o) => a.push(o)); c.traverse((o) => b.push(o)); a.forEach((o, i) => map.set(o, b[i]));
  for (let i = 0; i < a.length; i++) { const s = a[i], d = b[i]; if (!s.isSkinnedMesh) continue;
    const bones = s.skeleton.bones.map((bn) => map.get(bn) || bn); d.bind(new THREE.Skeleton(bones, s.skeleton.boneInverses.map((m) => m.clone())), s.bindMatrix.clone()); d.bindMode = s.bindMode; }
  return { clone: c, map };
}

const HEAT = [[0.12, 0.1, 0.42], [0.1, 0.55, 0.62], [0.35, 0.82, 0.48], [0.99, 0.86, 0.3], [1.0, 0.42, 0.32]]; // own scale: indigo -> teal -> green -> yellow -> coral
const heat = (w) => { const x = THREE.MathUtils.clamp(w, 0, 1) * (HEAT.length - 1), i = Math.min(HEAT.length - 2, Math.floor(x)), f = x - i; return HEAT[i].map((c, j) => c + (HEAT[i + 1][j] - c) * f); };

export function createRig(ctx) {
  // ctx: { scene, editor, getModel(), status(m), exportMaterial(m, geo), camera() }
  const $ = (id) => document.getElementById(id), { editor } = ctx, status = (m) => ctx.status(m);
  const R = { model: null, skinned: [], bones: [], clips: [], mixer: null, action: null, clip: -1, playing: false, speed: 1, loop: true, showBones: true, weights: false, bone: -1 };
  const clock = new THREE.Clock();

  // ---------- panel
  const panel = document.createElement('details'); panel.id = 'rigPanel'; panel.open = true; panel.hidden = true;
  panel.innerHTML = `<summary>Rig &amp; animation</summary>
    <div class="hint0" id="rigInfo">—</div>
    <label class="row chk"><input type="checkbox" id="rigBones" checked> Show bones</label>
    <label class="row chk"><input type="checkbox" id="rigWeights"> Weight heat map (selected bone)</label>
    <div class="row"><span>Clip</span><select id="rigClip"></select></div>
    <div class="row"><button class="btn" id="rigPlay">▶ Play</button><button class="btn" id="rigStop">■ Stop</button><label class="chk"><input type="checkbox" id="rigLoop" checked> Loop</label></div>
    <div class="row"><span>Time</span><input type="range" id="rigTime" min="0" max="1" step="0.001" value="0"><b id="rigTimeV">0.00 s</b></div>
    <div class="row"><span>Speed</span><input type="range" id="rigSpeed" min="0.1" max="2" step="0.05" value="1"><b id="rigSpeedV">1.00×</b></div>
    <div class="row"><span>Bone</span><select id="rigBone"></select></div>
    <div class="row"><span>Rot X</span><input type="range" id="rigRX" min="-180" max="180" step="1" value="0"><b id="rigRXV">0°</b></div>
    <div class="row"><span>Rot Y</span><input type="range" id="rigRY" min="-180" max="180" step="1" value="0"><b id="rigRYV">0°</b></div>
    <div class="row"><span>Rot Z</span><input type="range" id="rigRZ" min="-180" max="180" step="1" value="0"><b id="rigRZV">0°</b></div>
    <div class="row"><button class="btn" id="rigResetBone">Reset bone</button><button class="btn" id="rigResetAll">Rest pose</button></div>
    <div class="hint0">Rigs come from GLB / glTF files (for example a Blender export with "Skinning" and "Animation" on). Export GLB keeps the skeleton, weights and clips. Edit Mode and Sculpt are off for skinned meshes. FBX is not supported: use GLB.</div>`;
  document.querySelector('.props').appendChild(panel);
  $('rigBones').onchange = (e) => { R.showBones = e.target.checked; rebuildBones(); };
  $('rigWeights').onchange = (e) => { R.weights = e.target.checked; weightView(); };
  $('rigClip').onchange = (e) => setClip(+e.target.value);
  $('rigPlay').onclick = () => (R.playing ? pause() : play()); $('rigStop').onclick = () => stop();
  $('rigLoop').onchange = (e) => { R.loop = e.target.checked; if (R.action) R.action.setLoop(R.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); };
  $('rigTime').oninput = (e) => scrub(+e.target.value * (R.clips[R.clip]?.duration || 0));
  $('rigSpeed').oninput = (e) => { R.speed = +e.target.value; $('rigSpeedV').textContent = R.speed.toFixed(2) + '×'; };
  $('rigBone').onchange = (e) => selectBone(+e.target.value);
  ['X', 'Y', 'Z'].forEach((ax) => { const el = $('rigR' + ax); el.oninput = () => poseFromSliders(false); el.onchange = () => poseFromSliders(true); });
  $('rigResetBone').onclick = () => resetBone(); $('rigResetAll').onclick = () => restPose();

  // ---------- scan
  const rest = new Map(); // bone -> {p,q,s} rest transform
  function attach(model) {
    detach(); if (!model) return 0; const sk = [], bones = new Set();
    model.traverse((o) => { if (o.isSkinnedMesh && !o.userData.isOverlay) { sk.push(o); o.skeleton.bones.forEach((b) => bones.add(b)); } });
    if (!sk.length) { panel.hidden = true; return 0; }
    R.model = model; R.skinned = sk; R.bones = [...bones]; R.clips = (model.animations || []).slice();
    for (const b of R.bones) rest.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
    R.mixer = new THREE.AnimationMixer(model); R.clip = -1; R.bone = -1;
    $('rigClip').innerHTML = R.clips.length ? R.clips.map((c, i) => `<option value="${i}">${esc(c.name || 'clip ' + (i + 1))} (${c.duration.toFixed(2)} s)</option>`).join('') : '<option value="-1">(no clips in file)</option>';
    $('rigBone').innerHTML = '<option value="-1">(none)</option>' + R.bones.map((b, i) => `<option value="${i}">${'· '.repeat(depth(b))}${esc(b.name || 'bone ' + i)}</option>`).join('');
    const verts = sk.reduce((a, m) => a + m.geometry.attributes.position.count, 0);
    $('rigInfo').textContent = `${sk.length} skinned mesh${sk.length > 1 ? 'es' : ''} · ${R.bones.length} bones · ${R.clips.length} clip${R.clips.length === 1 ? '' : 's'} · ${verts.toLocaleString()} verts`;
    panel.hidden = false; if (R.clips.length) setClip(0); rebuildBones(); syncSliders(); return sk.length;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const depth = (b) => { let d = 0, p = b.parent; while (p && p.isBone) { d++; p = p.parent; } return Math.min(d, 8); };
  function detach() { stop(); R.mixer?.stopAllAction(); R.mixer = null; R.action = null; clearBones(); clearWeights(); R.model = null; R.skinned = []; R.bones = []; R.clips = []; rest.clear(); panel.hidden = true; }

  // ---------- clips
  function setClip(i) { if (!R.mixer) return; R.mixer.stopAllAction(); R.clip = i; const c = R.clips[i]; if (!c) { R.action = null; return; }
    R.action = R.mixer.clipAction(c); R.action.setLoop(R.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); R.action.clampWhenFinished = true; R.action.play(); R.action.paused = !R.playing; R.mixer.setTime(0); R.mixer.update(0); updTime(); }
  function play() { if (!R.action) { status('This rig has no animation clips'); return false; } R.playing = true; R.action.paused = false; if (!R.action.isRunning() && !R.loop) R.action.reset().play(); clock.getDelta(); $('rigPlay').textContent = '❚❚ Pause'; return true; }
  function pause() { R.playing = false; if (R.action) R.action.paused = true; $('rigPlay').textContent = '▶ Play'; }
  function stop() { pause(); if (R.action) { R.action.time = 0; R.mixer.update(0); } updTime(); }
  function scrub(t) { if (!R.action) return; pause(); R.action.time = THREE.MathUtils.clamp(t, 0, R.clips[R.clip].duration); R.action.paused = false; R.mixer.update(0); R.action.paused = true; updTime(); syncSliders(); }
  function updTime() { const d = R.clips[R.clip]?.duration || 0, t = R.action ? R.action.time : 0; $('rigTimeV').textContent = t.toFixed(2) + ' s'; if (document.activeElement !== $('rigTime')) $('rigTime').value = d ? t / d : 0; }

  // ---------- pose
  function selectBone(i) { R.bone = i; $('rigBone').value = String(i); syncSliders(); rebuildBones(); if (R.weights) weightView(); return R.bones[i]?.name || null; }
  function syncSliders() { const b = R.bones[R.bone]; const e = b ? new THREE.Euler().setFromQuaternion(b.quaternion) : new THREE.Euler();
    ['x', 'y', 'z'].forEach((a) => { const v = Math.round(THREE.MathUtils.radToDeg(e[a])); $('rigR' + a.toUpperCase()).value = v; $('rigR' + a.toUpperCase() + 'V').textContent = v + '°'; }); }
  let poseBefore = null;
  function poseFromSliders(final) {
    const b = R.bones[R.bone]; if (!b) return; if (R.playing) pause(); if (R.action) R.action.enabled = false;
    if (!poseBefore) poseBefore = b.quaternion.clone();
    const e = new THREE.Euler(...['X', 'Y', 'Z'].map((a) => THREE.MathUtils.degToRad(+$('rigR' + a).value))); b.quaternion.setFromEuler(e);
    ['X', 'Y', 'Z'].forEach((a) => ($('rigR' + a + 'V').textContent = $('rigR' + a).value + '°'));
    if (final) { const q0 = poseBefore, q1 = b.quaternion.clone(); poseBefore = null; editor.pushHistory({ label: `Pose ${b.name}`, undo: () => { b.quaternion.copy(q0); syncSliders(); }, redo: () => { b.quaternion.copy(q1); syncSliders(); } }); status(`Posed ${b.name} · Ctrl+Z to undo · Play a clip to go back to the animation`); }
  }
  function poseBone(name, euler) { const i = R.bones.findIndex((b) => b.name === name); if (i < 0) return false; selectBone(i); ['X', 'Y', 'Z'].forEach((a, k) => ($('rigR' + a).value = euler[k] || 0)); poseFromSliders(true); return true; }
  function resetBone() { const b = R.bones[R.bone], r = b && rest.get(b); if (!r) return; const q0 = b.quaternion.clone(); b.quaternion.copy(r.q); const q1 = r.q.clone(); editor.pushHistory({ label: 'Reset bone', undo: () => { b.quaternion.copy(q0); syncSliders(); }, redo: () => { b.quaternion.copy(q1); syncSliders(); } }); syncSliders(); }
  function restPose() { pause(); if (R.action) R.action.enabled = false; for (const [b, r] of rest) { b.position.copy(r.p); b.quaternion.copy(r.q); b.scale.copy(r.s); } syncSliders(); status('Rest pose'); }
  const reenable = () => { if (R.action && !R.action.enabled) { R.action.enabled = true; R.action.play(); } };

  // ---------- bones overlay (own look: teal sticks with coral joints, the picked bone in yellow)
  let boneLines = null, joints = null;
  const lineMat = new THREE.LineBasicMaterial({ color: 0x2ec4b6, depthTest: false, transparent: true }), selMat = new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true });
  const jointMat = new THREE.PointsMaterial({ color: 0xff6f61, size: 7, sizeAttenuation: false, depthTest: false, transparent: true });
  function clearBones() { for (const o of [boneLines, joints]) if (o) { o.parent?.remove(o); o.geometry.dispose(); } boneLines = joints = null; }
  function rebuildBones() { clearBones(); if (!R.showBones || !R.bones.length) return;
    const n = R.bones.length, lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    boneLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true })); boneLines.renderOrder = 20; boneLines.frustumCulled = false; boneLines.userData.isOverlay = true; boneLines.raycast = () => {};
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); joints = new THREE.Points(pg, jointMat); joints.renderOrder = 21; joints.frustumCulled = false; joints.userData.isOverlay = true; joints.raycast = () => {};
    ctx.scene.add(boneLines, joints); updateBones(); }
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  function updateBones() { if (!boneLines) return; const P = boneLines.geometry.attributes.position, C = boneLines.geometry.attributes.color, J = joints.geometry.attributes.position, vis = R.model?.visible !== false;
    boneLines.visible = joints.visible = vis;
    R.bones.forEach((b, i) => { b.getWorldPosition(v1); const par = b.parent?.isBone ? b.parent : null; if (par) par.getWorldPosition(v2); else v2.copy(v1);
      P.setXYZ(i * 2, v2.x, v2.y, v2.z); P.setXYZ(i * 2 + 1, v1.x, v1.y, v1.z); J.setXYZ(i, v1.x, v1.y, v1.z);
      const c = i === R.bone || (par && R.bones.indexOf(par) === R.bone) ? [1, 0.82, 0.25] : [0.18, 0.77, 0.71]; C.setXYZ(i * 2, ...c); C.setXYZ(i * 2 + 1, ...c); });
    P.needsUpdate = C.needsUpdate = J.needsUpdate = true; }
  void lineMat; void selMat;

  // ---------- weight heat map: a skinned copy of each mesh with vertex colours from the picked bone's weights
  let wMeshes = [];
  function clearWeights() { for (const w of wMeshes) { w.parent?.remove(w); w.geometry.dispose(); w.material.dispose(); } wMeshes = []; for (const m of R.skinned) m.material && (m.visible = true); }
  function weightView() { clearWeights(); if (!R.weights) return 0; const b = R.bones[R.bone]; let maxW = 0;
    for (const m of R.skinned) { const bi = m.skeleton.bones.indexOf(b), g = new THREE.BufferGeometry(), src = m.geometry; for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) if (src.attributes[k]) g.setAttribute(k, src.attributes[k]); if (src.index) g.setIndex(src.index);
      const n = src.attributes.position.count, col = new Float32Array(n * 3), SI = src.attributes.skinIndex, SW = src.attributes.skinWeight;
      for (let i = 0; i < n; i++) { let w = 0; if (bi >= 0) for (let k = 0; k < 4; k++) if (SI.getComponent(i, k) === bi) w += SW.getComponent(i, k); maxW = Math.max(maxW, w); col.set(heat(w), i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const w = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); w.bind(m.skeleton, m.bindMatrix); w.bindMode = m.bindMode; w.frustumCulled = false; w.userData.isOverlay = true; w.raycast = () => {}; m.add(w); wMeshes.push(w); }
    status(b ? `Weights of ${b.name} (max ${maxW.toFixed(2)}) · indigo 0 → coral 1` : 'Pick a bone to see its weights'); return maxW; }

  // ---------- export: rig roots are cloned whole (skeleton, weights, attachments); clips go to the GLB
  const rootOf = (m) => { let o = m; while (o.parent && o.parent !== R.model) o = o.parent; return o; };
  function rigRoots() {
    const s = new Set(); for (const m of R.skinned) s.add(rootOf(m)); for (const b of R.bones) s.add(rootOf(b));
    const roots = [...s]; const contains = (r, o) => { while (o) { if (o === r) return true; o = o.parent; } return false; };
    // every skinned mesh must live in the same top node as all of its bones; otherwise export the whole model as one rig
    const ok = R.skinned.every((m) => { const r = rootOf(m); return m.skeleton.bones.every((b) => contains(r, b)); });
    return ok && !roots.includes(R.model) ? roots : [R.model];
  }
  function inRig(m) { if (!R.model || !R.skinned.length) return false; if (m.isSkinnedMesh) return true; const roots = rigRoots(); let o = m; while (o) { if (roots.includes(o)) return true; o = o.parent; } return false; }
  function extendExport(g, { only, Ninv }) {
    if (!R.model || !R.skinned.length) return; if (only && !inRig(only)) return;
    R.model.updateMatrixWorld(true);
    for (const root of rigRoots()) {
      const { clone } = cloneRig(root);
      clone.traverse((o) => { for (const ch of [...o.children]) if (ch.userData?.isOverlay) o.remove(ch); });
      clone.traverse((o) => { if (o.isMesh) o.userData = {}; else { delete o.userData.orig; delete o.userData.norm; } }); // runtime-only data must not go into the file
      const srcs = []; root.traverse((o) => { if (o.isMesh && !o.userData.isOverlay) srcs.push(o); }); const dsts = []; clone.traverse((o) => { if (o.isMesh) dsts.push(o); });
      srcs.forEach((s, i) => { const d = dsts[i]; if (!d) return; const geo = copyData(s.geometry, s.geometry.clone()); for (const k of ['mfMask', 'mfOutlineN']) geo.deleteAttribute?.(k); d.geometry = geo; const mat = ctx.exportMaterial?.(s, geo); if (mat) d.material = mat; });
      const mw = new THREE.Matrix4().multiplyMatrices(Ninv, root.matrixWorld); if (root === R.model) clone.animations = []; mw.decompose(clone.position, clone.quaternion, clone.scale); g.add(clone);
    }
    g.userData.animations = R.clips.slice();
  }
  function blockMode(mesh, mode) { if (mesh?.isSkinnedMesh) { status(`${mode === 'sculpt' ? 'Sculpt' : 'Edit'} Mode is off for skinned (rigged) meshes in v7: change the shape in Blender and re-import, or pose it here`); return true; } return false; }

  function tick() { if (R.model && (!R.model.parent || R.model !== ctx.getModel())) { detach(); return; } const dt = clock.getDelta(); if (R.mixer && R.playing) { reenable(); R.mixer.update(dt * R.speed); updTime(); if (R.bone >= 0 && Math.random() < 0.2) syncSliders(); } updateBones(); }
  return { attach, detach, tick, extendExport, skipExport: inRig, blockMode, play, pause, stop, scrub, setClip, selectBone, poseBone, restPose, weightView: (on) => { R.weights = on; $('rigWeights').checked = on; return weightView(); }, showBones: (on) => { R.showBones = on; $('rigBones').checked = on; rebuildBones(); },
    info: () => ({ skinned: R.skinned.length, bones: R.bones.map((b) => b.name), clips: R.clips.map((c) => ({ name: c.name, duration: c.duration, tracks: c.tracks.length })), clip: R.clip, playing: R.playing, time: R.action?.time || 0, bone: R.bones[R.bone]?.name || null }),
    get state() { return R; } };
}
