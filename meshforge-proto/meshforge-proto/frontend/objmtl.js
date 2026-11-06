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
