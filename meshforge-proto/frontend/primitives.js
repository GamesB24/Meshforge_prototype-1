// Add-menu primitives. Original MeshForge geometry, moderate resolution.
// A character stand-in is a block mannequin, not a copied mascot head.
import * as THREE from 'three';

export const ADD_ITEMS = [
  { id: 'plane', label: 'Plane', group: 'Mesh' },
  { id: 'cube', label: 'Cube', group: 'Mesh' },
  { id: 'uvsphere', label: 'UV sphere', group: 'Mesh' },
  { id: 'icosphere', label: 'Icosphere', group: 'Mesh' },
  { id: 'cylinder', label: 'Cylinder', group: 'Mesh' },
  { id: 'cone', label: 'Cone', group: 'Mesh' },
  { id: 'torus', label: 'Torus', group: 'Mesh' },
  { id: 'circle', label: 'Circle', group: 'Mesh' },
  { id: 'grid', label: 'Grid', group: 'Mesh' },
  { id: 'capsule', label: 'Capsule', group: 'Mesh' },
  { id: 'mannequin', label: 'Mannequin', group: 'Mesh' },
  { id: 'stairs', label: 'Stairs', group: 'Mesh' },
  { id: 'arch', label: 'Arch', group: 'Mesh' },
  { id: 'empty', label: 'Empty', group: 'Other' },
  { id: 'point', label: 'Point light', group: 'Light' },
  { id: 'directional', label: 'Directional light', group: 'Light' },
  { id: 'camera', label: 'Camera', group: 'Other' },
  { id: 'sky', label: 'Sky dome', group: 'Environment' },
  { id: 'water', label: 'Water', group: 'Environment' },
];

function mat(color, wire) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.02, side: THREE.DoubleSide, wireframe: !!wire });
}
function meshFrom(geos, name, color) {
  const positions = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    positions.push(ng.attributes.position.array);
  }
  let n = 0;
  for (const a of positions) n += a.length;
  const all = new Float32Array(n);
  let o = 0;
  for (const a of positions) { all.set(a, o); o += a.length; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(all, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat(color));
  mesh.name = name;
  return mesh;
}
function solid(geo, name, color) {
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat(color));
  mesh.name = name;
  return mesh;
}
function ground(geo) {
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);
  return geo;
}

export function createPrimitive(id) {
  switch (id) {
    case 'plane': return solid(ground(new THREE.PlaneGeometry(2, 2, 1, 1).rotateX(-Math.PI / 2)), 'Plane', 0xc8c8c8);
    case 'cube': return solid(ground(new THREE.BoxGeometry(1, 1, 1)), 'Cube', 0xcfcfcf);
    case 'uvsphere': return solid(ground(new THREE.SphereGeometry(0.6, 24, 16)), 'UV sphere', 0xd0d4dc);
    case 'icosphere': return solid(ground(new THREE.IcosahedronGeometry(0.65, 2)), 'Icosphere', 0xd7dbe3);
    case 'cylinder': return solid(ground(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 20)), 'Cylinder', 0xc9c3b8);
    case 'cone': return solid(ground(new THREE.ConeGeometry(0.55, 1.2, 20)), 'Cone', 0xd2b48c);
    case 'torus': return solid(ground(new THREE.TorusGeometry(0.55, 0.18, 12, 24)), 'Torus', 0xc5b4d8);
    case 'circle': return solid(ground(new THREE.CircleGeometry(0.8, 28).rotateX(-Math.PI / 2)), 'Circle', 0xcfd3c4);
    case 'grid': return solid(ground(new THREE.PlaneGeometry(2, 2, 8, 8).rotateX(-Math.PI / 2)), 'Grid', 0xb7c4c0);
    case 'capsule': return solid(ground(new THREE.CapsuleGeometry(0.32, 0.7, 6, 12)), 'Capsule', 0xd8c7b0);
    case 'mannequin': return mannequin();
    case 'stairs': return stairs();
    case 'arch': return arch();
    case 'empty': {
      const m = solid(new THREE.OctahedronGeometry(0.18), 'Empty', 0xf0d080);
      m.material.wireframe = true;
      m.userData.isEmpty = true;
      m.position.y = 0.4;
      return m;
    }
    case 'point': return lightMarker('point');
    case 'directional': return lightMarker('directional');
    case 'camera': return cameraObject();
    default: return null;
  }
}

function mannequin() {
  const parts = [];
  const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push(g); };
  box(0.42, 0.22, 0.24, 0, 0.95, 0);
  box(0.46, 0.55, 0.26, 0, 1.28, 0);
  const head = new THREE.SphereGeometry(0.16, 12, 10); head.translate(0, 1.72, 0); parts.push(head);
  box(0.14, 0.36, 0.14, -0.34, 1.38, 0);
  box(0.12, 0.32, 0.12, -0.34, 1.04, 0);
  box(0.14, 0.36, 0.14, 0.34, 1.38, 0);
  box(0.12, 0.32, 0.12, 0.34, 1.04, 0);
  box(0.16, 0.46, 0.16, -0.12, 0.62, 0);
  box(0.14, 0.42, 0.14, -0.12, 0.22, 0);
  box(0.16, 0.46, 0.16, 0.12, 0.62, 0);
  box(0.14, 0.42, 0.14, 0.12, 0.22, 0);
  const mesh = meshFrom(parts, 'Mannequin', 0xd2c4b0);
  mesh.userData.isMannequin = true;
  return mesh;
}
function stairs() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(1.2, 0.16, 0.3);
    g.translate(0, 0.08 + i * 0.16, -0.55 + i * 0.3);
    parts.push(g);
  }
  return meshFrom(parts, 'Stairs', 0xb7b1a8);
}
function arch() {
  const ring = new THREE.TorusGeometry(0.75, 0.1, 8, 18, Math.PI);
  ring.rotateZ(Math.PI);
  ring.translate(0, 0.85, 0);
  const left = new THREE.BoxGeometry(0.2, 0.85, 0.2); left.translate(-0.75, 0.42, 0);
  const right = new THREE.BoxGeometry(0.2, 0.85, 0.2); right.translate(0.75, 0.42, 0);
  return meshFrom([ring, left, right], 'Arch', 0xc4bfb4);
}
function lightMarker(kind) {
  const marker = solid(new THREE.SphereGeometry(0.08, 10, 8), kind === 'point' ? 'Point light' : 'Directional light', 0xffe29a);
  marker.position.y = kind === 'point' ? 1.6 : 2.2;
  const light = kind === 'point' ? new THREE.PointLight(0xfff1d0, 8, 12) : new THREE.DirectionalLight(0xfff6e4, 1.2);
  light.name = marker.name + ' source';
  marker.add(light);
  marker.userData.isLightMarker = kind;
  return marker;
}
function cameraObject() {
  const body = solid(new THREE.ConeGeometry(0.12, 0.28, 4).rotateX(Math.PI / 2), 'Camera', 0x9bb4d6);
  body.position.set(0, 1.5, 3);
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  cam.name = 'Camera lens';
  body.add(cam);
  body.userData.isCameraMarker = true;
  return body;
}

export function triangleCount(obj) {
  let n = 0;
  obj?.traverse?.((o) => {
    if (!o.isMesh || o.userData.isOverlay) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}
