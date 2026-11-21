// Dedicated view for one mesh asset or actor. Edits collision without changing the open scene.
import * as THREE from 'three';
import { COLLISION_PRESETS, COLLISION_TYPES, ensureCollision, fitCollision, publicCollision, setCollision } from './collision.js';

export function createAssetEditor(ctx) {
  const root = document.createElement('div');
  root.id = 'assetEditor';
  root.hidden = true;
  root.innerHTML = `
    <div class="ae-bar"><b id="aeTitle">Asset</b><span class="grow"></span><button type="button" id="aeClose">Close</button></div>
    <div class="ae-body">
      <canvas id="aeView" width="640" height="420"></canvas>
      <div class="ae-side">
        <label>Preset <select id="aePreset"></select></label>
        <label>Type <select id="aeType"></select></label>
        <label class="chk"><input id="aeOn" type="checkbox" checked> Collision enabled</label>
        <div class="row"><button type="button" id="aeFit" class="btn">Auto-fit</button><button type="button" id="aeConvex" class="btn">Convex hull</button></div>
        <div class="row"><button type="button" id="aeAddBox" class="btn">Add box</button><button type="button" id="aeAddSphere" class="btn">Add sphere</button><button type="button" id="aeAddCap" class="btn">Add capsule</button></div>
        <div id="aeShapes"></div>
        <label>Override on this actor <input id="aeOverride" type="checkbox"></label>
        <div class="row"><button type="button" id="aeSave" class="btn">Save</button></div>
        <p class="hint0" id="aeHint">Saved collision is the default for new instances. An actor can keep its own override.</p>
      </div>
    </div>`;
  document.body.appendChild(root);
  const canvas = root.querySelector('#aeView');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x2a2e36);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445, 1.3));
  const cam = new THREE.PerspectiveCamera(40, 640 / 420, 0.01, 100);
  cam.position.set(1.6, 1.2, 2);
  const holder = new THREE.Group();
  scene.add(holder);
  const helpers = new THREE.Group();
  scene.add(helpers);
  let target = null;
  let asset = null;
  let drag = null;

  root.querySelector('#aePreset').innerHTML = COLLISION_PRESETS.map((p) => `<option>${p}</option>`).join('');
  root.querySelector('#aeType').innerHTML = COLLISION_TYPES.map((p) => `<option>${p}</option>`).join('');

  function currentCol() {
    if (target?.isMesh) return ensureCollision(target);
    return asset?.payload?.collision || null;
  }
  function drawHelpers() {
    while (helpers.children.length) helpers.remove(helpers.children[0]);
    const col = currentCol();
    if (!col) return;
    const shapes = col.shapes?.length ? col.shapes : [{ type: col.type === 'sphere' || col.type === 'capsule' ? col.type : 'box', center: col.center, size: col.size }];
    for (const shape of shapes) {
      const c = shape.center || [0, 0, 0];
      const s = shape.size || [0.5, 0.5, 0.5];
      let geo;
      if (shape.type === 'sphere') geo = new THREE.SphereGeometry(Math.max(0.05, s[0]), 16, 12);
      else if (shape.type === 'capsule') geo = new THREE.CapsuleGeometry(Math.max(0.05, s[0]), Math.max(0.05, s[1]), 4, 8);
      else geo = new THREE.BoxGeometry(Math.max(0.05, s[0] * 2), Math.max(0.05, s[1] * 2), Math.max(0.05, s[2] * 2));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe07050, wireframe: true }));
      mesh.position.set(c[0], c[1], c[2]);
      helpers.add(mesh);
    }
  }
  function paintShapes() {
    const col = currentCol();
    const host = root.querySelector('#aeShapes');
    const shapes = col?.shapes || [];
    host.innerHTML = shapes.map((s, i) => `<div class="ae-shape"><b>${s.type}</b>
      <label>move <input data-i="${i}" data-k="cx" type="number" step="0.05" value="${s.center?.[0] || 0}"></label>
      <label><input data-i="${i}" data-k="cy" type="number" step="0.05" value="${s.center?.[1] || 0}"></label>
      <label><input data-i="${i}" data-k="cz" type="number" step="0.05" value="${s.center?.[2] || 0}"></label>
      <label>size <input data-i="${i}" data-k="sx" type="number" step="0.05" value="${s.size?.[0] || 0.5}"></label>
      <label><input data-i="${i}" data-k="sy" type="number" step="0.05" value="${s.size?.[1] || 0.5}"></label>
      <label><input data-i="${i}" data-k="sz" type="number" step="0.05" value="${s.size?.[2] || 0.5}"></label>
      <button type="button" data-rm="${i}">Remove</button></div>`).join('') || '<div class="hint0">No simple shapes. Auto-fit adds one, or use the convex hull.</div>';
    host.querySelectorAll('input').forEach((inp) => {
      inp.onchange = () => {
        const shape = currentCol().shapes[+inp.dataset.i];
        if (!shape) return;
        shape.center = shape.center || [0, 0, 0];
        shape.size = shape.size || [0.5, 0.5, 0.5];
        const v = +inp.value || 0;
        if (inp.dataset.k === 'cx') shape.center[0] = v;
        if (inp.dataset.k === 'cy') shape.center[1] = v;
        if (inp.dataset.k === 'cz') shape.center[2] = v;
        if (inp.dataset.k === 'sx') shape.size[0] = Math.max(0.02, v);
        if (inp.dataset.k === 'sy') shape.size[1] = Math.max(0.02, v);
        if (inp.dataset.k === 'sz') shape.size[2] = Math.max(0.02, v);
        drawHelpers();
      };
    });
    host.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = () => { currentCol().shapes.splice(+b.dataset.rm, 1); paintShapes(); drawHelpers(); };
    });
  }
  function showMesh(mesh) {
    while (holder.children.length) holder.remove(holder.children[0]);
    if (!mesh) return;
    const clone = new THREE.Mesh(mesh.geometry, mesh.material);
    holder.add(clone);
    if (!clone.geometry.boundingSphere) clone.geometry.computeBoundingSphere();
    const r = clone.geometry.boundingSphere?.radius || 1;
    cam.position.set(r * 1.8, r * 1.2, r * 2.2);
    cam.lookAt(0, r * 0.3, 0);
    drawHelpers();
    renderer.render(scene, cam);
  }
  function syncForm() {
    const col = currentCol();
    if (!col) return;
    root.querySelector('#aePreset').value = col.preset || 'BlockAll';
    root.querySelector('#aeType').value = col.type || 'box';
    root.querySelector('#aeOn').checked = col.enabled !== false;
    root.querySelector('#aeOverride').checked = !!col.override;
    paintShapes();
    drawHelpers();
    renderer.render(scene, cam);
  }
  function addShape(type) {
    const col = currentCol();
    if (!col) return;
    col.shapes = col.shapes || [];
    col.shapes.push({ type, center: [0, 0.5, 0], size: type === 'sphere' ? [0.3, 0.3, 0.3] : [0.3, 0.4, 0.3] });
    col.type = type;
    paintShapes();
    drawHelpers();
    renderer.render(scene, cam);
  }
  root.querySelector('#aeClose').onclick = () => { root.hidden = true; };
  root.querySelector('#aePreset').onchange = (e) => { const col = currentCol(); if (col) { col.preset = e.target.value; col.enabled = e.target.value !== 'NoCollision'; } };
  root.querySelector('#aeType').onchange = (e) => {
    const col = currentCol();
    if (!col) return;
    col.type = e.target.value;
    if (target?.isMesh && (e.target.value === 'box' || e.target.value === 'sphere' || e.target.value === 'capsule')) {
      col.shapes = [];
      fitCollision(target, e.target.value);
    }
    syncForm();
  };
  root.querySelector('#aeOn').onchange = (e) => { const col = currentCol(); if (col) col.enabled = e.target.checked; };
  root.querySelector('#aeOverride').onchange = (e) => { const col = currentCol(); if (col) col.override = e.target.checked; };
  root.querySelector('#aeFit').onclick = () => { if (target?.isMesh) { fitCollision(target, 'box'); syncForm(); } };
  root.querySelector('#aeConvex').onclick = () => {
    const col = currentCol();
    if (!col) return;
    col.type = 'convex';
    col.shapes = [];
    if (target?.isMesh) fitCollision(target, 'convex');
    root.querySelector('#aeHint').textContent = 'Convex hull blocks on the mesh surface inside the fitted bounds. New instances use this default.';
    syncForm();
  };
  root.querySelector('#aeAddBox').onclick = () => addShape('box');
  root.querySelector('#aeAddSphere').onclick = () => addShape('sphere');
  root.querySelector('#aeAddCap').onclick = () => addShape('capsule');
  root.querySelector('#aeSave').onclick = () => {
    const col = publicCollision(currentCol());
    if (asset) {
      asset.payload = asset.payload || {};
      asset.payload.collision = col;
      ctx.onAssetSaved?.(asset);
    }
    if (target?.isMesh) {
      setCollision(target, { ...col, override: root.querySelector('#aeOverride').checked || !asset });
      if (asset && !target.userData.collision.override) target.userData.collision = JSON.parse(JSON.stringify(col));
    }
    ctx.status?.('Collision saved. New instances use this default unless an actor overrides it.');
    ctx.refresh?.();
  };
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag || root.hidden) return;
    holder.rotation.y += (e.clientX - drag.x) * 0.01;
    holder.rotation.x += (e.clientY - drag.y) * 0.01;
    drag.x = e.clientX;
    drag.y = e.clientY;
    renderer.render(scene, cam);
  });
  window.addEventListener('pointerup', () => { drag = null; });

  function open({ mesh = null, asset: next = null, title = 'Collision' } = {}) {
    target = mesh;
    asset = next;
    if (asset && !asset.payload.collision) {
      asset.payload.collision = mesh ? publicCollision(ensureCollision(mesh)) : { enabled: true, type: 'box', preset: 'BlockAll', center: [0, 0.5, 0], size: [0.5, 0.5, 0.5], shapes: [], override: false };
    }
    if (mesh) ensureCollision(mesh);
    root.hidden = false;
    root.querySelector('#aeTitle').textContent = title;
    showMesh(mesh);
    syncForm();
  }
  return { open, close: () => { root.hidden = true; }, isOpen: () => !root.hidden };
}
