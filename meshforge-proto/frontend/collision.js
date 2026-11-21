// Per-actor collision. Original MeshForge code. Shapes are fitted bounds, not a copied physics engine.
import * as THREE from 'three';

export const COLLISION_PRESETS = ['BlockAll', 'OverlapAll', 'NoCollision', 'Pawn', 'Water'];
export const COLLISION_TYPES = ['none', 'box', 'sphere', 'capsule', 'convex', 'complex'];

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export function emptyCollision(preset = 'BlockAll', type = 'box') {
  return {
    enabled: preset !== 'NoCollision',
    type: preset === 'NoCollision' ? 'none' : type,
    preset,
    center: [0, 0, 0],
    size: [0.5, 0.5, 0.5],
    shapes: [],
    override: false,
    assetId: null,
  };
}

function guess(obj) {
  const name = String(obj?.name || '').toLowerCase();
  if (name.includes('water') || obj?.userData?.isWater) return emptyCollision('Water', 'box');
  if (name === 'terrain' || obj?.userData?.source === 'landscape' && name === 'terrain') return emptyCollision('BlockAll', 'complex');
  if (obj?.userData?.isMannequin || (obj?.userData?.behaviours || []).some((b) => b.type === 'character')) return emptyCollision('Pawn', 'capsule');
  return emptyCollision('BlockAll', 'box');
}

export function fitCollision(obj, type) {
  const col = ensureCollision(obj);
  const geo = obj.geometry;
  if (!geo) return col;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return col;
  const center = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  col.center = [center.x, center.y, center.z];
  const kind = type || col.type;
  if (kind === 'sphere') {
    const r = 0.5 * Math.max(size.x, size.y, size.z);
    col.size = [r, r, r];
  } else if (kind === 'capsule') {
    const r = 0.5 * Math.max(size.x, size.z);
    col.size = [r, size.y * 0.5, r];
  } else {
    col.size = [size.x * 0.5, size.y * 0.5, size.z * 0.5];
  }
  if (type) col.type = type;
  if (!col.shapes?.length && kind !== 'convex' && kind !== 'complex' && kind !== 'none') {
    col.shapes = [{ type: kind === 'sphere' || kind === 'capsule' ? kind : 'box', center: col.center.slice(), size: col.size.slice() }];
  }
  return col;
}

export function ensureCollision(obj) {
  if (!obj?.isMesh || obj.userData?.isOverlay || obj.userData?.isBoneViz || obj.userData?.isCollisionDebug) return null;
  if (!obj.userData.collision) {
    obj.userData.collision = guess(obj);
    fitCollision(obj);
  }
  const col = obj.userData.collision;
  if (!Array.isArray(col.shapes)) col.shapes = [];
  if (!col.center) col.center = [0, 0, 0];
  if (!col.size) col.size = [0.5, 0.5, 0.5];
  return col;
}

export function ensureAll(root) {
  root?.traverse?.((o) => { if (o.isMesh) ensureCollision(o); });
}

function activeShapes(col) {
  if (col.shapes?.length) return col.shapes;
  if (col.type === 'none' || col.type === 'convex' || col.type === 'complex') return [];
  return [{ type: col.type || 'box', center: col.center, size: col.size }];
}

function worldBoxFor(obj, shape) {
  obj.updateWorldMatrix(true, false);
  const c = shape.center || [0, 0, 0];
  const s = shape.size || [0.5, 0.5, 0.5];
  const type = shape.type || 'box';
  const box = new THREE.Box3();
  if (type === 'sphere') {
    const center = new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(obj.matrixWorld);
    const sc = obj.getWorldScale(_v).x || 1;
    const r = Math.abs(s[0] * sc);
    box.setFromCenterAndSize(center, new THREE.Vector3(r * 2, r * 2, r * 2));
    return box;
  }
  const hx = Math.abs(s[0]), hy = Math.abs(s[1]), hz = Math.abs(type === 'capsule' ? s[0] : s[2]);
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) {
    box.expandByPoint(new THREE.Vector3(c[0] + x, c[1] + y, c[2] + z).applyMatrix4(obj.matrixWorld));
  }
  return box;
}

function overlapsXZ(feet, radius, box) {
  if (feet.y > box.max.y + 0.05 || feet.y + 1.4 < box.min.y) return null;
  const cx = Math.max(box.min.x, Math.min(feet.x, box.max.x));
  const cz = Math.max(box.min.z, Math.min(feet.z, box.max.z));
  const dx = feet.x - cx;
  const dz = feet.z - cz;
  const dist = Math.hypot(dx, dz);
  if (dist >= radius) return null;
  if (feet.y >= box.max.y - 0.25) return { stand: box.max.y };
  if (dist < 1e-4) return { pushX: radius, pushZ: 0 };
  const scale = (radius - dist) / dist;
  return { pushX: dx * scale, pushZ: dz * scale };
}

function surfacePush(feet, radius, mesh, delta) {
  const origin = feet.clone();
  origin.y += 0.7;
  const dir = new THREE.Vector3(delta.x, 0, delta.z);
  if (dir.lengthSq() < 1e-8) return null;
  dir.normalize();
  _ray.set(origin.clone().addScaledVector(dir, -0.05), dir);
  _ray.far = radius + 0.15;
  const hit = _ray.intersectObject(mesh, false)[0];
  if (!hit || hit.distance > radius) return null;
  const depth = radius - hit.distance;
  const n = hit.face?.normal?.clone() || dir.clone().negate();
  n.transformDirection(mesh.matrixWorld);
  n.y = 0;
  if (n.lengthSq() < 1e-6) n.copy(dir).negate();
  n.normalize();
  return { pushX: n.x * depth, pushZ: n.z * depth };
}

function groundHit(feet, mesh) {
  const origin = feet.clone();
  origin.y += 3;
  _ray.set(origin, new THREE.Vector3(0, -1, 0));
  _ray.far = 8;
  const hit = _ray.intersectObject(mesh, false)[0];
  if (!hit) return null;
  if (Math.hypot(hit.point.x - feet.x, hit.point.z - feet.z) > 0.6) return null;
  return hit.point.y;
}

function isDescendant(mesh, actor) {
  let p = mesh;
  while (p) { if (p === actor) return true; p = p.parent; }
  return false;
}

export function moveActor(actor, feet, delta, meshes) {
  const pos = feet.clone().add(delta);
  let inWater = false;
  for (const mesh of meshes) {
    if (!mesh?.isMesh || mesh === actor || isDescendant(mesh, actor)) continue;
    const col = mesh.userData.collision;
    if (!col?.enabled || col.preset === 'NoCollision' || col.preset === 'Pawn') continue;
    const shapes = activeShapes(col);
    const waterish = col.preset === 'Water' || col.preset === 'OverlapAll';
    if (waterish) {
      const box = shapes.length ? worldBoxFor(mesh, shapes[0]) : new THREE.Box3().setFromObject(mesh);
      if (pos.x >= box.min.x && pos.x <= box.max.x && pos.z >= box.min.z && pos.z <= box.max.z && Math.abs(pos.y - (box.min.y + box.max.y) * 0.5) < 1.2) {
        if (col.preset === 'Water') inWater = true;
      }
      continue;
    }
    if (col.type === 'complex' || col.type === 'convex') {
      const y = groundHit(pos, mesh);
      if (y != null && pos.y < y) pos.y = y;
      const push = surfacePush(pos, 0.3, mesh, delta);
      if (push) { pos.x += push.pushX; pos.z += push.pushZ; }
      continue;
    }
    for (const shape of shapes) {
      const hit = overlapsXZ(pos, 0.28, worldBoxFor(mesh, shape));
      if (!hit) continue;
      if (hit.stand != null && pos.y <= hit.stand + 0.08) pos.y = hit.stand;
      else { pos.x += hit.pushX || 0; pos.z += hit.pushZ || 0; }
    }
  }
  return { position: pos, inWater };
}

export function setCollision(obj, patch = {}) {
  const col = ensureCollision(obj);
  if (!col) return null;
  if (patch.enabled != null) col.enabled = !!patch.enabled;
  if (patch.preset && COLLISION_PRESETS.includes(patch.preset)) {
    col.preset = patch.preset;
    col.enabled = patch.preset !== 'NoCollision';
    if (patch.preset === 'NoCollision') col.type = 'none';
    if (patch.preset === 'Water' && !patch.type) col.type = 'box';
    if (patch.preset === 'Pawn' && !patch.type) col.type = 'capsule';
  }
  if (patch.type && COLLISION_TYPES.includes(patch.type)) {
    col.type = patch.type;
    if (patch.type === 'none') col.enabled = false;
    if (patch.type === 'convex' || patch.type === 'complex' || patch.type === 'box' || patch.type === 'sphere' || patch.type === 'capsule') {
      col.shapes = [];
      fitCollision(obj, patch.type);
    }
  }
  if (patch.center) col.center = patch.center.slice(0, 3);
  if (patch.size) col.size = patch.size.slice(0, 3);
  if (patch.shapes) col.shapes = JSON.parse(JSON.stringify(patch.shapes));
  if (patch.override != null) col.override = !!patch.override;
  if (patch.assetId) col.assetId = patch.assetId;
  return publicCollision(col);
}

export function publicCollision(col) {
  if (!col) return null;
  return {
    enabled: col.enabled !== false,
    type: col.type || 'box',
    preset: col.preset || 'BlockAll',
    center: (col.center || [0, 0, 0]).slice(),
    size: (col.size || [0.5, 0.5, 0.5]).slice(),
    shapes: JSON.parse(JSON.stringify(col.shapes || [])),
    override: !!col.override,
    assetId: col.assetId || null,
  };
}

export function createCollisionDebug(scene) {
  const group = new THREE.Group();
  group.name = 'Collision debug';
  group.userData.isCollisionDebug = true;
  group.visible = false;
  scene.add(group);
  let on = false;
  function rebuild(root) {
    while (group.children.length) group.remove(group.children[0]);
    if (!on || !root) return;
    root.traverse((obj) => {
      const col = obj.userData?.collision;
      if (!obj.isMesh || !col?.enabled || col.preset === 'NoCollision') return;
      const color = col.preset === 'Water' ? 0x3a78d0 : col.preset === 'OverlapAll' ? 0xd0c14a : col.preset === 'Pawn' ? 0x6bbf59 : 0xe07050;
      if (col.type === 'complex' || col.type === 'convex') {
        const wire = new THREE.Mesh(obj.geometry, new THREE.MeshBasicMaterial({ color, wireframe: true }));
        wire.applyMatrix4(obj.matrixWorld);
        wire.userData.isCollisionDebug = true;
        wire.raycast = () => {};
        group.add(wire);
        return;
      }
      const shapes = activeShapes(col);
      const list = shapes.length ? shapes : [{ type: 'box', center: col.center, size: col.size }];
      for (const shape of list) {
        const box = worldBoxFor(obj, shape);
        const helper = new THREE.Box3Helper(box, color);
        helper.userData.isCollisionDebug = true;
        helper.raycast = () => {};
        group.add(helper);
      }
    });
  }
  return {
    set(v, root) { on = !!v; group.visible = on; rebuild(root); },
    rebuild,
    visible: () => on,
    group,
  };
}
