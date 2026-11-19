// MeshForge OBJ + MTL writer (v7, original MIT code): keeps UVs, normals, material groups and textures.
import * as THREE from 'three';
export async function writeOBJBundle(group, base = 'meshforge') {
  const lines = [`# MeshForge 7.0 OBJ export`, `mtllib ${base}.mtl`], mtl = [`# MeshForge 7.0 materials`], images = [], seenMat = new Map();
  let vOff = 1, tOff = 1, nOff = 1; const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  const safe = (s) => String(s || 'material').replace(/[^\w.-]+/g, '_');
  async function matName(m) {
    if (seenMat.has(m)) return seenMat.get(m);
    let name = safe(m.name || 'material'), k = 1; while ([...seenMat.values()].includes(name)) name = `${safe(m.name)}_${k++}`;
    seenMat.set(m, name);
    const c = m.color || new THREE.Color(1, 1, 1);
    mtl.push('', `newmtl ${name}`, `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`, 'Ka 0 0 0', 'Ks 0 0 0', 'Ns 10', `d ${(m.opacity ?? 1).toFixed(3)}`, 'illum 1');
    if (m.map?.image) {
      const img = m.map.image, cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0);
      const file = `${safe(m.map.name || name)}.png`; const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      images.push({ name: file, data: new Uint8Array(await blob.arrayBuffer()) }); mtl.push(`map_Kd ${file}`);
    }
    return name;
  }
  group.updateMatrixWorld(true);
  const meshes = []; group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, idx = g.index;
    nm.getNormalMatrix(o.matrixWorld); lines.push(`o ${safe(o.name)}`);
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`); }
    if (UV) for (let i = 0; i < UV.count; i++) lines.push(`vt ${UV.getX(i).toFixed(6)} ${UV.getY(i).toFixed(6)}`);
    if (N) for (let i = 0; i < N.count; i++) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); lines.push(`vn ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`); }
    const mats = Array.isArray(o.material) ? o.material : [o.material], count = idx ? idx.count : P.count;
    const groups = g.groups.length && Array.isArray(o.material) ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    const ref = (i) => { const a = i + vOff; return UV && N ? `${a}/${i + tOff}/${i + nOff}` : UV ? `${a}/${i + tOff}` : N ? `${a}//${i + nOff}` : `${a}`; };
    for (const gr of groups) {
      const m = mats[gr.materialIndex] || mats[0]; lines.push(`usemtl ${await matName(m)}`);
      const end = Math.min(gr.start + gr.count, count);
      for (let k = gr.start; k + 2 < end; k += 3) {
        const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2; lines.push(`f ${ref(a)} ${ref(b)} ${ref(c)}`);
      }
    }
    vOff += P.count; if (UV) tOff += UV.count; if (N) nOff += N.count;
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') + '\n', images };
}

function parseMTL(text) {
  const out = new Map(); let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const [k, ...rest] = t.split(/\s+/);
    if (k === 'newmtl') { cur = { name: rest.join(' '), color: [1, 1, 1], map: null }; out.set(cur.name, cur); }
    else if (cur && k === 'Kd') cur.color = rest.slice(0, 3).map(Number);
    else if (cur && k === 'map_Kd') cur.map = rest.join(' ').trim();
  }
  return out;
}

// OBJ + MTL reader that keeps UVs and material slots. Faces are triangles or fans.
export async function meshesFromOBJ(objText, mtlText = '', fetchFile) {
  const lib = parseMTL(mtlText);
  const images = new Map();
  async function mapFor(name) {
    if (!name || !fetchFile || images.has(name)) return images.get(name) || null;
    try {
      const buf = await fetchFile(name);
      const blob = new Blob([buf]);
      const url = URL.createObjectURL(blob);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const tex = new THREE.Texture(img); tex.needsUpdate = true; tex.name = name; tex.colorSpace = THREE.SRGBColorSpace;
      images.set(name, tex); return tex;
    } catch { images.set(name, null); return null; }
  }
  const V = [null], VT = [null], VN = [null];
  const groups = []; let cur = { name: 'object', mat: null, faces: [] };
  const use = (name) => {
    if (cur.faces.length) groups.push(cur);
    if (cur.faces.length) cur = { name: cur.name, mat: name, faces: [] };
    else cur.mat = name;
  };
  for (const line of String(objText).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const bits = t.split(/\s+/);
    if (bits[0] === 'o' || bits[0] === 'g') {
      if (cur.faces.length) groups.push(cur);
      cur = { name: bits.slice(1).join(' ') || 'object', mat: cur.mat, faces: [] };
    } else if (bits[0] === 'usemtl') use(bits.slice(1).join(' '));
    else if (bits[0] === 'v') V.push(bits.slice(1, 4).map(Number));
    else if (bits[0] === 'vt') VT.push(bits.slice(1, 3).map(Number));
    else if (bits[0] === 'vn') VN.push(bits.slice(1, 4).map(Number));
    else if (bits[0] === 'f') cur.faces.push(bits.slice(1).map((c) => c.split('/').map((n) => (n ? +n : 0))));
  }
  if (cur.faces.length) groups.push(cur);
  const meshes = [];
  for (const g of groups) {
    const pos = [], uv = [], nor = []; let hasUV = false, hasN = false;
    const push = (corner) => {
      const vi = corner[0] < 0 ? V.length + corner[0] : corner[0];
      const ti = corner[1] < 0 ? VT.length + corner[1] : corner[1];
      const ni = corner[2] < 0 ? VN.length + corner[2] : corner[2];
      const p = V[vi] || [0, 0, 0]; pos.push(p[0], p[1], p[2]);
      if (ti) { const t = VT[ti] || [0, 0]; uv.push(t[0], t[1]); hasUV = true; } else uv.push(0, 0);
      if (ni) { const n = VN[ni] || [0, 1, 0]; nor.push(n[0], n[1], n[2]); hasN = true; }
    };
    for (const f of g.faces) {
      for (let i = 1; i < f.length - 1; i++) { push(f[0]); push(f[i]); push(f[i + 1]); }
    }
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (hasUV) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (hasN) geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); else geo.computeVertexNormals();
    const def = lib.get(g.mat) || { color: [0.8, 0.8, 0.8], map: null };
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(def.color[0], def.color[1], def.color[2]), roughness: 0.6, side: THREE.DoubleSide, name: g.mat || 'material' });
    if (def.map) { const tex = await mapFor(def.map); if (tex) { mat.map = tex; mat.color.setRGB(1, 1, 1); } }
    const mesh = new THREE.Mesh(geo, mat); mesh.name = g.name || g.mat || 'object';
    meshes.push(mesh);
  }
  return meshes;
}
