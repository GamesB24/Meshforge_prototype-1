// Armature edit, automatic weights, weight paint and pose.
// Original MeshForge tools. Bones are three.js Bone nodes parented under the mesh after binding.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _av = new THREE.Vector3();

function distToSeg(p, a, b) {
  _ab.subVectors(b, a);
  const len2 = _ab.lengthSq() || 1e-8;
  const t = Math.max(0, Math.min(1, _av.subVectors(p, a).dot(_ab) / len2));
  return _v.copy(a).addScaledVector(_ab, t).distanceTo(p);
}

export function createArmatureTools(ctx) {
  const { THREE: T = THREE, canvas, camera, editor, anim, status, addObject, getModel } = ctx;
  const state = { mode: null, bone: null, brush: 'add', strength: 0.5, radius: 0.18, mirror: true };
  let panel = null;
  let drag = null;

  function bonesOf(arm) {
    const list = [];
    arm?.traverse((o) => { if (o.isBone) list.push(o); });
    return list;
  }
  function activeArmature() {
    const sel = editor.sel;
    if (!sel) return null;
    if (sel.userData?.isArmature) return sel;
    if (sel.isBone) return sel.parent?.userData?.isArmature ? sel.parent : sel.parent;
    let found = null;
    sel.traverse?.((o) => { if (!found && o.userData?.isArmature) found = o; });
    if (found) return found;
    const id = sel.userData?.armatureId;
    let byId = null;
    getModel()?.traverse((o) => { if (!byId && o.userData?.isArmature && o.uuid === id) byId = o; });
    return byId;
  }
  function boundMesh(arm) {
    const root = getModel();
    let mesh = null;
    root?.traverse((o) => {
      if (mesh || !o.isSkinnedMesh) return;
      if (o.userData.armatureId === arm?.uuid || o.skeleton?.bones?.includes(arm?.children?.find?.((c) => c.isBone))) mesh = o;
    });
    if (mesh) return mesh;
    root?.traverse((o) => { if (!mesh && o.isSkinnedMesh && o.userData.armatureId === arm?.uuid) mesh = o; });
    // armature is parented under the mesh
    if (arm?.parent?.isSkinnedMesh) return arm.parent;
    return mesh;
  }
  function ensureArmature() {
    let arm = activeArmature();
    if (arm) return arm;
    arm = new T.Group();
    arm.name = 'Armature';
    arm.userData.isArmature = true;
    addObject(arm, { label: arm.name, source: 'rig' });
    return arm;
  }
  function stampRest(bone) {
    bone.userData.restPosition = bone.position.toArray();
    bone.userData.restQuaternion = bone.quaternion.toArray();
    bone.userData.length = bone.userData.length || bone.position.length() || 0.2;
  }
  function makeBone(name, parent, local) {
    const bone = new T.Bone();
    bone.name = name;
    bone.position.set(local[0], local[1], local[2]);
    bone.userData.length = Math.max(0.08, bone.position.length() || 0.2);
    stampRest(bone);
    (parent || ensureArmature()).add(bone);
    return bone;
  }
  function rebuildVisuals(arm) {
    const root = arm || activeArmature();
    if (!root) return;
    root.traverse((bone) => {
      if (!bone.isBone) return;
      bone.children.filter((c) => c.userData?.isBoneViz).forEach((c) => bone.remove(c));
      const child = bone.children.find((c) => c.isBone);
      const dir = child ? child.position.clone() : new T.Vector3(0, bone.userData.length || 0.15, 0);
      const len = Math.max(0.05, dir.length());
      const viz = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 5), new T.MeshStandardMaterial({ color: bone === state.bone ? 0xf0c060 : 0x7eb0e0, roughness: 0.4 }));
      viz.userData.isBoneViz = true;
      viz.scale.set(0.025, len, 0.025);
      viz.position.copy(dir).multiplyScalar(0.5);
      viz.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
      viz.raycast = viz.raycast;
      bone.add(viz);
    });
  }
  function selectBone(bone) {
    state.bone = bone;
    rebuildVisuals(activeArmature() || bone?.parent);
    fillBoneSelect();
    const rx = panel?.querySelector('#poseX');
    if (rx && bone) {
      rx.value = (bone.rotation.x * 180 / Math.PI).toFixed(1);
      panel.querySelector('#poseY').value = (bone.rotation.y * 180 / Math.PI).toFixed(1);
      panel.querySelector('#poseZ').value = (bone.rotation.z * 180 / Math.PI).toFixed(1);
      const name = panel.querySelector('#boneName');
      if (name) name.value = bone.name;
    }
    status(bone ? `${state.mode === 'pose' ? 'Pose' : 'Bone'} · ${bone.name}` : 'No bone');
  }
  function fillBoneSelect() {
    const sel = panel?.querySelector('#bonePick');
    if (!sel) return;
    const arm = activeArmature();
    const bones = bonesOf(arm);
    sel.innerHTML = bones.map((b) => `<option value="${b.name}">${b.name}</option>`).join('');
    if (state.bone) sel.value = state.bone.name;
  }
  function humanoid(mesh) {
    mesh = mesh?.isMesh ? mesh : editor.sel;
    if (!mesh?.isMesh) { status('Select the character mesh, then click Humanoid rig.'); return null; }
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const h = Math.max(0.2, bb.max.y - bb.min.y);
    const w = Math.max(0.2, bb.max.x - bb.min.x);
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const y0 = bb.min.y;
    const Y = (t) => y0 + h * t;
    const X = (t) => cx + w * t;
    const abs = [
      ['hips', null, [cx, Y(0.53), cz]],
      ['spine', 'hips', [cx, Y(0.63), cz]],
      ['chest', 'spine', [cx, Y(0.74), cz]],
      ['neck', 'chest', [cx, Y(0.84), cz]],
      ['head', 'neck', [cx, Y(0.93), cz]],
      ['shoulder.L', 'chest', [X(-0.18), Y(0.78), cz]],
      ['upper_arm.L', 'shoulder.L', [X(-0.32), Y(0.76), cz]],
      ['lower_arm.L', 'upper_arm.L', [X(-0.42), Y(0.6), cz]],
      ['hand.L', 'lower_arm.L', [X(-0.48), Y(0.48), cz]],
      ['shoulder.R', 'chest', [X(0.18), Y(0.78), cz]],
      ['upper_arm.R', 'shoulder.R', [X(0.32), Y(0.76), cz]],
      ['lower_arm.R', 'upper_arm.R', [X(0.42), Y(0.6), cz]],
      ['hand.R', 'lower_arm.R', [X(0.48), Y(0.48), cz]],
      ['upper_leg.L', 'hips', [X(-0.12), Y(0.48), cz]],
      ['lower_leg.L', 'upper_leg.L', [X(-0.12), Y(0.26), cz]],
      ['foot.L', 'lower_leg.L', [X(-0.12), Y(0.04), cz]],
      ['upper_leg.R', 'hips', [X(0.12), Y(0.48), cz]],
      ['lower_leg.R', 'upper_leg.R', [X(0.12), Y(0.26), cz]],
      ['foot.R', 'lower_leg.R', [X(0.12), Y(0.04), cz]],
    ];
    const arm = new T.Group();
    arm.name = (mesh.name || 'Character') + ' rig';
    arm.userData.isArmature = true;
    arm.position.copy(mesh.position);
    arm.quaternion.copy(mesh.quaternion);
    arm.scale.copy(mesh.scale);
    const byName = {};
    for (const [name, parent, pos] of abs) {
      const bone = new T.Bone();
      bone.name = name;
      const origin = parent ? byName[parent].userData.abs : [0, 0, 0];
      bone.position.set(pos[0] - origin[0], pos[1] - origin[1], pos[2] - origin[2]);
      bone.userData.abs = pos;
      bone.userData.length = bone.position.length() || h * 0.08;
      stampRest(bone);
      (parent ? byName[parent] : arm).add(bone);
      byName[name] = bone;
    }
    addObject(arm, { label: arm.name, source: 'rig' });
    const skinned = bindMesh(mesh, arm);
    rebuildVisuals(arm);
    selectBone(byName.hips);
    editor.select(skinned);
    status(`Humanoid rig fitted to ${skinned.name}. Use Pose to rotate bones, or Weight Paint to fix the heat map.`);
    return { armature: arm, mesh: skinned, bones: Object.keys(byName) };
  }
  function bindMesh(mesh, arm) {
    mesh.updateWorldMatrix(true, true);
    arm.updateWorldMatrix(true, true);
    const bones = bonesOf(arm);
    assignWeights(mesh, bones);
    const skinned = new T.SkinnedMesh(mesh.geometry, mesh.material);
    skinned.name = mesh.name;
    skinned.userData = { ...mesh.userData, armatureId: arm.uuid };
    skinned.position.copy(mesh.position);
    skinned.quaternion.copy(mesh.quaternion);
    skinned.scale.copy(mesh.scale);
    mesh.parent.add(skinned);
    mesh.parent.remove(mesh);
    const skeleton = new T.Skeleton(bones);
    skinned.bind(skeleton);
    skinned.attach(arm);
    arm.userData.meshId = skinned.uuid;
    arm.userData.meshName = skinned.name;
    if (editor.sel === mesh) editor.select(skinned);
    return skinned;
  }
  function assignWeights(mesh, bones) {
    const pos = mesh.geometry.attributes.position;
    const n = pos.count;
    const index = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    const segs = bones.map((bone) => {
      bone.updateWorldMatrix(true, false);
      const a = new T.Vector3().setFromMatrixPosition(bone.matrixWorld);
      const child = bone.children.find((c) => c.isBone);
      const b = child ? new T.Vector3().setFromMatrixPosition(child.matrixWorld) : a.clone().add(new T.Vector3(0, bone.userData.length || 0.1, 0).transformDirection(bone.matrixWorld));
      return { a, b };
    });
    const v = new T.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const scored = segs.map((s, bi) => ({ bi, d: distToSeg(v, s.a, s.b) }));
      scored.sort((p, q) => p.d - q.d);
      let sum = 0;
      const top = scored.slice(0, 4).map((s) => { const w = 1 / (s.d * s.d + 1e-4); sum += w; return { ...s, w }; });
      for (let k = 0; k < 4; k++) {
        index[i * 4 + k] = top[k] ? top[k].bi : 0;
        weight[i * 4 + k] = top[k] ? top[k].w / sum : 0;
      }
    }
    mesh.geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(index, 4));
    mesh.geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weight, 4));
  }
  function extrude() {
    const parent = state.bone || bonesOf(activeArmature())[0];
    if (!parent) {
      const bone = makeBone('Bone', null, [0, 0.8, 0]);
      rebuildVisuals();
      selectBone(bone);
      return bone;
    }
    const len = parent.userData.length || 0.25;
    const bone = makeBone(parent.name + '_ext', parent, [0, len, 0]);
    parent.userData.length = len;
    rebuildVisuals();
    selectBone(bone);
    status(`Extruded ${bone.name}`);
    return bone;
  }
  function parentBone(childName, parentName) {
    const arm = activeArmature();
    const bones = bonesOf(arm);
    const child = bones.find((b) => b.name === childName);
    const parent = bones.find((b) => b.name === parentName);
    if (!child || !parent) return false;
    let p = parent;
    while (p) { if (p === child) { status('That parent would make a cycle.'); return false; } p = p.parent; }
    parent.attach(child);
    stampRest(child);
    rebuildVisuals(arm);
    status(`${child.name} parented to ${parent.name}`);
    return true;
  }
  function rename(name) {
    if (!state.bone || !name?.trim()) return false;
    state.bone.name = name.trim();
    fillBoneSelect();
    status(`Renamed bone to ${state.bone.name}`);
    return true;
  }
  function paintAt(clientX, clientY) {
    const arm = activeArmature();
    const mesh = boundMesh(arm);
    const bone = state.bone || bonesOf(arm)[0];
    if (!mesh?.isSkinnedMesh || !bone) { status('Bind a mesh with automatic weights before painting.'); return false; }
    const rect = canvas.getBoundingClientRect();
    const ndc = new T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new T.Raycaster();
    ray.setFromCamera(ndc, camera());
    const hits = ray.intersectObject(mesh, false);
    if (!hits.length) return false;
    const bi = mesh.skeleton.bones.indexOf(bone);
    if (bi < 0) return false;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const skinI = geo.attributes.skinIndex;
    const skinW = geo.attributes.skinWeight;
    const center = mesh.worldToLocal(hits[0].point.clone());
    geo.computeBoundingBox();
    const midX = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2;
    const mirrorX = state.mirror ? (midX * 2 - center.x) : null;
    const v = new T.Vector3();
    const touched = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const d = v.distanceTo(center);
      const dm = mirrorX == null ? Infinity : v.distanceTo(_a.set(mirrorX, center.y, center.z));
      const reach = Math.min(d, dm);
      if (reach > state.radius) continue;
      touched.push({ i, fall: 1 - reach / state.radius });
    }
    if (state.brush === 'smooth' || state.brush === 'blur') {
      let acc = 0;
      for (const t of touched) acc += weightOf(mesh, t.i, bi);
      const avg = touched.length ? acc / touched.length : 0;
      const mix = state.brush === 'blur' ? 0.35 : 0.7;
      for (const t of touched) {
        const cur = weightOf(mesh, t.i, bi);
        setWeightAbsolute(skinI, skinW, t.i, bi, cur + (avg - cur) * mix * t.fall * state.strength);
      }
    } else {
      for (const t of touched) applyBrush(skinI, skinW, t.i, bi, t.fall * state.strength, state.brush);
    }
    skinW.needsUpdate = true;
    showHeat(mesh, bi);
    return true;
  }
  function applyBrush(skinI, skinW, i, bi, amount, brush) {
    const slots = [0, 1, 2, 3].map((k) => ({ k, b: skinI.getComponent(i, k), w: skinW.getComponent(i, k) }));
    let slot = slots.find((s) => s.b === bi);
    if (!slot) {
      slot = slots.slice().sort((a, b) => a.w - b.w)[0];
      skinI.setComponent(i, slot.k, bi);
      slot.b = bi;
      slot.w = 0;
    }
    let next = slot.w;
    if (brush === 'add') next = Math.min(1, slot.w + amount);
    else if (brush === 'subtract') next = Math.max(0, slot.w - amount);
    else {
      let acc = 0, n = 0;
      for (let k = 0; k < 4; k++) if (skinI.getComponent(i, k) === bi) { acc += skinW.getComponent(i, k); n++; }
      const avg = n ? acc / n : slot.w;
      const mix = brush === 'blur' ? 0.35 : 0.65;
      next = slot.w + (avg - slot.w) * mix * Math.min(1, amount * 2);
    }
    skinW.setComponent(i, slot.k, next);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += skinW.getComponent(i, k);
    if (sum > 1e-6) for (let k = 0; k < 4; k++) skinW.setComponent(i, k, skinW.getComponent(i, k) / sum);
  }
  function showHeat(mesh, bi) {
    const skinI = mesh.geometry.attributes.skinIndex;
    const skinW = mesh.geometry.attributes.skinWeight;
    const n = mesh.geometry.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (skinI.getComponent(i, k) === bi) w += skinW.getComponent(i, k);
      col[i * 3] = Math.min(1, w * 1.4);
      col[i * 3 + 1] = 0.15;
      col[i * 3 + 2] = Math.min(1, (1 - w) * 1.1);
    }
    mesh.geometry.setAttribute('color', new T.BufferAttribute(col, 3));
    if (!mesh.userData._preWeightMat) mesh.userData._preWeightMat = mesh.material;
    mesh.material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
    mesh.userData.heatColors = true;
  }
  function clearHeat(mesh) {
    if (!mesh?.userData?.heatColors) return;
    mesh.geometry.deleteAttribute('color');
    if (mesh.userData._preWeightMat) mesh.material = mesh.userData._preWeightMat;
    delete mesh.userData._preWeightMat;
    mesh.userData.heatColors = false;
  }
  function setWeightAbsolute(skinI, skinW, i, bi, value) {
    const slots = [0, 1, 2, 3];
    let slot = slots.find((k) => skinI.getComponent(i, k) === bi);
    if (slot == null) {
      slot = slots.slice().sort((a, b) => skinW.getComponent(i, a) - skinW.getComponent(i, b))[0];
      skinI.setComponent(i, slot, bi);
    }
    skinW.setComponent(i, slot, Math.max(0, Math.min(1, value)));
    let sum = 0;
    for (const k of slots) sum += skinW.getComponent(i, k);
    if (sum > 1e-6) for (const k of slots) skinW.setComponent(i, k, skinW.getComponent(i, k) / sum);
  }
  function setWeight(boneName, vertex, value) {
    const arm = activeArmature();
    const mesh = boundMesh(arm);
    if (!mesh) return false;
    const bi = mesh.skeleton.bones.findIndex((b) => b.name === boneName);
    if (bi < 0) return false;
    const skinI = mesh.geometry.attributes.skinIndex;
    const skinW = mesh.geometry.attributes.skinWeight;
    const slots = [0, 1, 2, 3];
    let slot = slots.find((k) => skinI.getComponent(vertex, k) === bi);
    if (slot == null) {
      slot = slots.slice().sort((a, b) => skinW.getComponent(vertex, a) - skinW.getComponent(vertex, b))[0];
      skinI.setComponent(vertex, slot, bi);
    }
    const v = Math.max(0, Math.min(1, value));
    const others = slots.filter((k) => k !== slot);
    let otherSum = 0;
    for (const k of others) otherSum += skinW.getComponent(vertex, k);
    skinW.setComponent(vertex, slot, v);
    const remain = 1 - v;
    if (otherSum > 1e-6) for (const k of others) skinW.setComponent(vertex, k, skinW.getComponent(vertex, k) / otherSum * remain);
    else skinW.setComponent(vertex, others[0], remain);
    skinW.needsUpdate = true;
    return weightOf(mesh, vertex, bi);
  }
  function weightOf(mesh, vertex, bi) {
    const skinI = mesh.geometry.attributes.skinIndex;
    const skinW = mesh.geometry.attributes.skinWeight;
    let w = 0;
    for (let k = 0; k < 4; k++) if (skinI.getComponent(vertex, k) === bi) w += skinW.getComponent(vertex, k);
    return w;
  }
  function normalizeAll() {
    const mesh = boundMesh(activeArmature());
    if (!mesh) return false;
    mesh.normalizeSkinWeights();
    status('Weights normalised.');
    return true;
  }
  function poseBone(name, deg) {
    const arm = activeArmature();
    const bone = bonesOf(arm).find((b) => b.name === name) || state.bone;
    if (!bone) return false;
    if (!bone.userData.restQuaternion) stampRest(bone);
    bone.rotation.set(deg[0] * Math.PI / 180, deg[1] * Math.PI / 180, deg[2] * Math.PI / 180);
    selectBone(bone);
    if (anim?.isAutoKey?.()) anim.insertKeyframe(bone, 'rot');
    return true;
  }
  function resetPose() {
    const arm = activeArmature();
    if (!arm) return false;
    arm.traverse((b) => {
      if (!b.isBone) return;
      if (b.userData.restPosition) b.position.fromArray(b.userData.restPosition);
      if (b.userData.restQuaternion) b.quaternion.fromArray(b.userData.restQuaternion);
    });
    status('Pose reset to the rest pose.');
    return true;
  }
  function keyPose() {
    const bone = state.bone;
    if (!bone) { status('Select a bone to keyframe.'); return false; }
    return !!anim?.insertKeyframe?.(bone, 'rot');
  }
  function enter(mode) {
    if (editor.mode && editor.mode !== 'object') editor.setMode('object');
    state.mode = mode;
    document.body.dataset.side = mode;
    const modeEl = document.getElementById('mode');
    if (modeEl) modeEl.value = mode;
    document.querySelectorAll('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.side === mode));
    if (!state.bone) state.bone = bonesOf(activeArmature())[0] || null;
    if (mode === 'weight') {
      const mesh = boundMesh(activeArmature());
      const bone = state.bone;
      const bi = mesh?.skeleton?.bones?.indexOf(bone) ?? 0;
      if (mesh && bi >= 0) showHeat(mesh, bi);
    } else clearHeat(boundMesh(activeArmature()));
    fillBoneSelect();
    panel?.querySelectorAll('[data-rig]').forEach((el) => { el.hidden = el.dataset.rig !== mode && el.dataset.rig !== 'all'; });
    status(mode === 'armature' ? 'Armature edit · Extrude adds a child bone' : mode === 'pose' ? 'Pose · Drag to rotate, Shift-drag to move, Keyframe writes the timeline' : 'Weight paint · Drag on the mesh. Red is this bone.');
  }
  function leave() {
    if (!state.mode) return;
    clearHeat(boundMesh(activeArmature()));
    state.mode = null;
  }
  function pickBone(e) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new T.Raycaster();
    ray.setFromCamera(ndc, camera());
    const arm = activeArmature();
    const viz = [];
    arm?.traverse((o) => { if (o.userData?.isBoneViz) viz.push(o); });
    const hit = ray.intersectObjects(viz, false)[0];
    return hit?.object?.parent?.isBone ? hit.object.parent : null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.mode || e.button !== 0) return;
    if (state.mode === 'weight') { drag = { paint: true }; paintAt(e.clientX, e.clientY); return; }
    const bone = pickBone(e);
    if (bone) selectBone(bone);
    if (state.bone) drag = { x: e.clientX, y: e.clientY, move: e.shiftKey };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.paint) { paintAt(e.clientX, e.clientY); return; }
    if (!state.bone) return;
    const dx = (e.clientX - drag.x) * 0.01;
    const dy = (e.clientY - drag.y) * 0.01;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.move || state.mode === 'armature') state.bone.position.x += dx, state.bone.position.y -= dy;
    else { state.bone.rotation.y += dx; state.bone.rotation.x += dy; }
    rebuildVisuals();
  });
  window.addEventListener('pointerup', () => { drag = null; });
  window.__mfBlockPointer = (e) => !!(state.mode && e.button === 0);

  function mountPanel() {
    const props = document.querySelector('.props');
    panel = document.createElement('div');
    panel.id = 'rigPanel';
    panel.innerHTML = `
      <details open data-rig="all"><summary>Rig</summary>
        <div class="row"><button class="btn" id="rigHuman" type="button">Humanoid rig</button></div>
        <div class="hint0">Select a character mesh first. The rig fits its bounds and parents it with automatic weights.</div>
        <div class="row"><select id="bonePick"></select></div>
        <div class="row"><input id="boneName" placeholder="Bone name"><button class="btn" id="boneRename" type="button">Rename</button></div>
      </details>
      <details open data-rig="armature"><summary>Armature edit</summary>
        <div class="row"><button class="btn" id="boneExtrude" type="button">Extrude</button><button class="btn" id="boneRoot" type="button">Add root</button></div>
        <div class="row"><select id="boneParent"></select><button class="btn" id="boneReparent" type="button">Parent</button></div>
      </details>
      <details open data-rig="pose"><summary>Pose</summary>
        <div class="row">X <input id="poseX" type="number" step="1" style="width:54px"> Y <input id="poseY" type="number" step="1" style="width:54px"> Z <input id="poseZ" type="number" step="1" style="width:54px"></div>
        <div class="row"><button class="btn" id="poseApply" type="button">Apply</button><button class="btn" id="poseKey" type="button">Keyframe</button><button class="btn" id="poseReset" type="button">Reset pose</button></div>
        <div class="hint0">Drag rotates. Shift-drag moves. Keyframe stores the bone on the timeline. Play evaluates it and Stop restores it.</div>
      </details>
      <details open data-rig="weight"><summary>Weight paint</summary>
        <div class="row"><select id="brushMode"><option value="add">Add</option><option value="subtract">Subtract</option><option value="smooth">Smooth</option><option value="blur">Blur</option></select></div>
        <div class="row">Strength <input id="brushStr" type="range" min="0.05" max="1" step="0.05" value="0.5"></div>
        <div class="row">Radius <input id="brushRad" type="range" min="0.02" max="0.8" step="0.02" value="0.18"></div>
        <label class="row chk"><input id="brushMirror" type="checkbox" checked> Mirror X</label>
        <div class="row"><button class="btn" id="brushNorm" type="button">Normalise</button></div>
      </details>`;
    props.appendChild(panel);
    panel.querySelector('#rigHuman').onclick = () => humanoid();
    panel.querySelector('#boneExtrude').onclick = () => extrude();
    panel.querySelector('#boneRoot').onclick = () => { const b = makeBone('root', null, [0, 0.2, 0]); rebuildVisuals(); selectBone(b); };
    panel.querySelector('#boneRename').onclick = () => rename(panel.querySelector('#boneName').value);
    panel.querySelector('#bonePick').onchange = (e) => { const b = bonesOf(activeArmature()).find((x) => x.name === e.target.value); if (b) selectBone(b); };
    panel.querySelector('#boneReparent').onclick = () => parentBone(state.bone?.name, panel.querySelector('#boneParent').value);
    panel.querySelector('#poseApply').onclick = () => poseBone(state.bone?.name, [+panel.querySelector('#poseX').value, +panel.querySelector('#poseY').value, +panel.querySelector('#poseZ').value]);
    panel.querySelector('#poseKey').onclick = () => keyPose();
    panel.querySelector('#poseReset').onclick = () => resetPose();
    panel.querySelector('#brushMode').onchange = (e) => { state.brush = e.target.value; };
    panel.querySelector('#brushStr').oninput = (e) => { state.strength = +e.target.value; };
    panel.querySelector('#brushRad').oninput = (e) => { state.radius = +e.target.value; };
    panel.querySelector('#brushMirror').onchange = (e) => { state.mirror = e.target.checked; };
    panel.querySelector('#brushNorm').onclick = () => normalizeAll();
    const parentSel = panel.querySelector('#boneParent');
    const src = panel.querySelector('#bonePick');
    const syncParent = () => { parentSel.innerHTML = src.innerHTML; };
    new MutationObserver(syncParent).observe(src, { childList: true });
  }
  mountPanel();

  function rebuildAll() {
    getModel()?.traverse((o) => { if (o.userData?.isArmature) rebuildVisuals(o); });
  }

  return {
    enter, leave, humanoid, extrude, parentBone, rename, poseBone, resetPose, keyPose, setWeight, normalizeAll, rebuildAll,
    mode: () => state.mode,
    boneNames: () => bonesOf(activeArmature()).map((b) => b.name),
    weightOf(boneName, vertex) {
      const mesh = boundMesh(activeArmature());
      if (!mesh) return 0;
      const bi = mesh.skeleton.bones.findIndex((b) => b.name === boneName);
      return bi < 0 ? 0 : weightOf(mesh, vertex, bi);
    },
  };
}
