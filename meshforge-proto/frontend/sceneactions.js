// Group, ungroup, join and select-similar. Original MIT code.
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export function groupNodes(nodes, THREE) {
  const parent = nodes[0].parent;
  if (!parent || nodes.some((n) => n.parent !== parent)) return null;
  const group = new THREE.Group();
  group.name = 'Group';
  parent.add(group);
  const before = nodes.map((n) => ({ node: n, pos: n.position.clone(), quat: n.quaternion.clone(), scl: n.scale.clone() }));
  // Keep world transforms: parent the nodes, then restore world matrix.
  nodes.forEach((n) => {
    const world = n.matrixWorld.clone();
    group.attach(n);
    n.matrixWorld.copy(world);
  });
  return { group, before, parent };
}

export function ungroupNode(group) {
  const parent = group.parent;
  if (!parent) return null;
  const kids = group.children.filter((c) => !c.userData?.isOverlay);
  const records = kids.map((n) => ({ node: n, world: n.matrixWorld.clone() }));
  records.forEach((r) => { parent.attach(r.node); });
  parent.remove(group);
  return { group, parent, records };
}

export function joinMeshes(meshes, THREE) {
  const list = meshes.filter((m) => m.isMesh);
  if (list.length < 2) return null;
  const parent = list[0].parent;
  parent.updateMatrixWorld(true);
  const inv = parent.matrixWorld.clone().invert();
  const geos = [];
  const mats = [];
  for (const m of list) {
    let g = m.geometry.clone();
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(rel);
    if (g.index) g = g.toNonIndexed();
    const stored = m.userData?.orig || m.material;
    const src = Array.isArray(stored) ? stored : [stored];
    if (src.length > 1 && g.groups?.length) {
      src.forEach((mat, i) => { mats.push(mat); });
      geos.push(g);
    } else {
      geos.push(g);
      mats.push(src[0]);
    }
  }
  const keys = geos.map((g) => new Set(Object.keys(g.attributes)));
  const common = [...keys[0]].filter((k) => keys.every((s) => s.has(k)) && k !== 'color');
  geos.forEach((g) => { for (const k of Object.keys(g.attributes)) if (!common.includes(k) && k !== 'position') g.deleteAttribute(k); if (!common.includes('uv')) g.deleteAttribute('uv'); });
  const merged = mergeGeometries(geos, true);
  if (!merged) return null;
  const uniq = [];
  const indexOf = (m) => { let i = uniq.indexOf(m); if (i < 0) { i = uniq.length; uniq.push(m); } return i; };
  if (merged.groups && merged.groups.length === mats.length) merged.groups.forEach((gr, i) => { gr.materialIndex = indexOf(mats[i]); });
  const material = uniq.length > 1 ? uniq.map((m) => m.clone()) : uniq[0].clone();
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = list[0].name + ' joined';
  parent.add(mesh);
  return { mesh, removed: list, parent };
}

export function similarMeshes(seed, all) {
  const matKey = (m) => {
    const mat = m.userData?.orig || m.material;
    const one = Array.isArray(mat) ? mat[0] : mat;
    return one?.name || one?.uuid || '';
  };
  const size = (m) => {
    if (m.geometry && !m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry?.boundingBox;
    if (!b) return { x: 1, y: 1, z: 1 };
    return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
  };
  const verts = (m) => m.geometry?.attributes?.position?.count || 0;
  const seedMat = matKey(seed);
  const seedRef = seed.userData?.assetId || seed.userData?.ref || seed.userData?.mfType || '';
  const sv = verts(seed);
  const ss = size(seed);
  return all.filter((m) => {
    if (m === seed || !m.isMesh) return false;
    if (seedRef && (m.userData?.assetId === seedRef || m.userData?.ref === seedRef || m.userData?.mfType === seedRef)) return true;
    if (seedMat && matKey(m) === seedMat) return true;
    const v = verts(m);
    if (!sv || !v) return false;
    if (Math.abs(v - sv) / sv > 0.05) return false;
    const s = size(m);
    const aspect = (a) => a.y / Math.max(a.x, a.z, 1e-6);
    return Math.abs(aspect(s) - aspect(ss)) < 0.15;
  });
}
