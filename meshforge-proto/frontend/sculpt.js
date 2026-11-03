// MeshForge Sculpt mode (v5): ten brushes, stroke engine (spacing, lazy mouse, symmetry) and
// "Sculptron 3D" adaptive-detail (dynamic topology) sculpting.
// Original MIT code written for MeshForge with three.js. The workflow is inspired by common
// digital-sculpting conventions; no code, names or assets from other sculpting programs are used.
import * as THREE from 'three';

const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const BRUSHES = [
  { id: 'standard', name: 'Standard', key: '1', falloff: 'soft', tip: 'Raise the surface along its average normal (Alt: dig in)', icon: svg('<path d="M3 18h3c3 0 3-10 6-10s3 10 6 10h3"/>') },
  { id: 'clay', name: 'Clay', key: '2', falloff: 'soft', tip: 'Fills dips up to a raised plane; each stroke adds one even layer', icon: svg('<path d="M3 17h4l2-4h6l2 4h4"/><path d="M9 13h6" opacity=".5"/>') },
  { id: 'buildup', name: 'Clay Buildup', key: '3', falloff: 'flat', tip: 'Square-edged clay that keeps building up with every pass', icon: svg('<path d="M4 19h16M6 15h12M8 11h8M10 7h4"/>') },
  { id: 'move', name: 'Move', key: '4', falloff: 'soft', tip: 'Grab an area and drag it in the view plane', icon: svg('<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>') },
  { id: 'smooth', name: 'Smooth', key: '5', falloff: 'soft', tip: 'Relax bumps (hold Shift with any brush)', icon: svg('<path d="M3 9c2-3 4 3 6 0s4 3 6 0 4 3 6 0"/><path d="M3 16c6-1 12-1 18 0"/>') },
  { id: 'chisel', name: 'Chisel', key: '6', falloff: 'hard', tip: 'Cut high points flat with a hard edge (Alt: fill low points)', icon: svg('<path d="M4 20l9-9"/><path d="M13 5l6 6-3 3-6-6z"/>') },
  { id: 'carve', name: 'Carve', key: '7', falloff: 'sharp', tip: 'Cut a crease / V-groove (Alt: raise a ridge)', icon: svg('<path d="M3 8h6l3 9 3-9h6"/>') },
  { id: 'pen', name: 'Pen', key: '8', falloff: 'sharp', tip: 'Fine detail line at a third of the brush size (Alt: raised line)', icon: svg('<path d="M4 20l3-1 11-11-2-2L5 17z"/><path d="M14 6l2 2"/>') },
  { id: 'inflate', name: 'Inflate', key: '9', falloff: 'soft', tip: 'Swell along each vertex normal (Alt: deflate)', icon: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>') },
  { id: 'pinch', name: 'Pinch', key: '0', falloff: 'soft', tip: 'Pull the surface towards the brush centre to tighten edges', icon: svg('<path d="M3 12h6M21 12h-6M6 9l3 3-3 3M18 9l-3 3 3 3"/>') },
];
const FALLOFF = {
  soft: (t) => { const x = 1 - t; return x * x * (3 - 2 * x); },
  sharp: (t) => { const x = 1 - t; return x * x * x; },
  flat: (t) => (t < 0.55 ? 1 : FALLOFF.soft((t - 0.55) / 0.45)),
  hard: (t) => (t < 0.85 ? 1 : (1 - t) / 0.15),
  constant: (t) => (t < 0.97 ? 1 : (1 - t) / 0.03),
};

// ---------------------------------------------------------------- mesh state
function weldGeometry(geo) {
  const pos = geo.attributes.position, n = pos.count, idx = geo.index;
  geo.computeBoundingBox(); const diag = geo.boundingBox.getSize(new THREE.Vector3()).length() || 1, q = 1e6 / diag;
  const map = new Map(), remap = new Int32Array(n), P = [];
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let w = map.get(k); if (w === undefined) { w = P.length / 3; map.set(k, w); P.push(x, y, z); } remap[i] = w;
  }
  const m = idx ? idx.count : n, T = [];
  for (let i = 0; i + 2 < m; i += 3) {
    const a = remap[idx ? idx.getX(i) : i], b = remap[idx ? idx.getX(i + 1) : i + 1], c = remap[idx ? idx.getX(i + 2) : i + 2];
    if (a !== b && b !== c && a !== c) T.push(a, b, c);
  }
  return { P: new Float32Array(P), T: new Uint32Array(T), changed: !idx || P.length / 3 !== n };
}

class SculptMesh {
  constructor(mesh, P, T) { this.mesh = mesh; this.load(P, T); }
  load(P, T) {
    this.nv = P.length / 3; this.nt = T.length / 3;
    this.capV = this.nv + 4096; this.capT = this.nt + 8192;
    this.P = new Float32Array(this.capV * 3); this.P.set(P);
    this.N = new Float32Array(this.capV * 3);
    this.T = new Uint32Array(this.capT * 3); this.T.set(T);
    this.vcell = new Int32Array(this.capV); this.stampV = new Uint32Array(this.capV); this.stampT = new Uint32Array(this.capT);
    this.mark = new Uint32Array(this.capV); this.disp = new Float32Array(this.capV); this.tmp = new Float32Array(this.capV * 3);
    this.stamp = 1;
    this.vt = new Array(this.nv); for (let i = 0; i < this.nv; i++) this.vt[i] = [];
    for (let t = 0; t < this.nt; t++) for (let k = 0; k < 3; k++) this.vt[this.T[t * 3 + k]].push(t);
    this.allNormals(); this.buildGrid(); this.makeGeometry();
  }
  bump() { if (++this.stamp > 4e9) { this.stampV.fill(0); this.stampT.fill(0); this.stamp = 1; } return this.stamp; }
  makeGeometry() {
    const old = this.geo; if (old) old.dispose();
    const g = old || new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.P, 3), na = new THREE.BufferAttribute(this.N, 3), ia = new THREE.BufferAttribute(this.T, 1);
    pa.setUsage(THREE.DynamicDrawUsage); na.setUsage(THREE.DynamicDrawUsage); ia.setUsage(THREE.DynamicDrawUsage);
    for (const k of Object.keys(g.attributes)) g.deleteAttribute(k);
    g.setAttribute('position', pa); g.setAttribute('normal', na); g.setIndex(ia);
    g.setDrawRange(0, this.nt * 3); this.updateBounds(g); this.geo = g; this.dirty = { v0: Infinity, v1: -1, t0: Infinity, t1: -1 };
    return g;
  }
  updateBounds(g = this.geo) {
    const b = new THREE.Box3(), v = new THREE.Vector3(); for (let i = 0; i < this.nv; i++) b.expandByPoint(v.fromArray(this.P, i * 3));
    this.box = b; g.boundingBox = b.clone(); g.boundingSphere = b.getBoundingSphere(new THREE.Sphere()); g.boundingSphere.radius *= 2;
  }
  growV(need) {
    if (need <= this.capV) return; const cap = Math.ceil(need * 1.5) + 4096;
    const g = (A, n) => { const B = new A.constructor(n); B.set(A); return B; };
    this.P = g(this.P, cap * 3); this.N = g(this.N, cap * 3); this.vcell = g(this.vcell, cap); this.stampV = g(this.stampV, cap);
    this.mark = g(this.mark, cap); this.disp = g(this.disp, cap); this.tmp = new Float32Array(cap * 3); this.capV = cap; this.realloc = true;
  }
  growT(need) {
    if (need <= this.capT) return; const cap = Math.ceil(need * 1.5) + 8192;
    const T = new Uint32Array(cap * 3); T.set(this.T); this.T = T; const s = new Uint32Array(cap); s.set(this.stampT); this.stampT = s; this.capT = cap; this.realloc = true;
  }
  faceN(t, out) { // un-normalised (area-weighted) face normal
    const T = this.T, P = this.P, a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
  }
  vertNormal(v) {
    const f = this._f || (this._f = new Float64Array(3)); let x = 0, y = 0, z = 0;
    for (const t of this.vt[v]) { this.faceN(t, f); x += f[0]; y += f[1]; z += f[2]; }
    const l = Math.hypot(x, y, z) || 1; this.N[v * 3] = x / l; this.N[v * 3 + 1] = y / l; this.N[v * 3 + 2] = z / l;
  }
  allNormals() { for (let v = 0; v < this.nv; v++) this.vertNormal(v); }
  // normals of every vertex sharing a triangle with the moved vertices
  updateNormals(ids, n) {
    const s = this.bump(), list = this._nl || (this._nl = []); list.length = 0;
    for (let i = 0; i < n; i++) for (const t of this.vt[ids[i]]) for (let k = 0; k < 3; k++) { const u = this.T[t * 3 + k]; if (this.stampV[u] !== s) { this.stampV[u] = s; list.push(u); } }
    for (const u of list) { this.vertNormal(u); this.touchV(u); }
  }
  touchV(v) { const d = this.dirty; if (v < d.v0) d.v0 = v; if (v > d.v1) d.v1 = v; }
  touchT(t) { const d = this.dirty; if (t < d.t0) d.t0 = t; if (t > d.t1) d.t1 = t; }
  // ---- uniform hash grid over vertices
  edgeStats() { let mx = 0, sum = 0; const P = this.P, T = this.T, step = Math.max(1, (this.nt / 20000) | 0); let n = 0;
    for (let t = 0; t < this.nt; t += 1) for (let k = 0; k < 3; k++) { const a = T[t * 3 + k] * 3, b = T[t * 3 + (k + 1) % 3] * 3;
      const l = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); if (l > mx) mx = l; if (t % step === 0) { sum += l; n++; } }
    return { max: mx, avg: sum / Math.max(n, 1) }; }
  buildGrid() {
    this.updateBounds(this.geo || new THREE.BufferGeometry());
    const diag = this.box.getSize(new THREE.Vector3()).length() || 1, es = this.edgeStats();
    this.cs = THREE.MathUtils.clamp(es.max * 1.4, diag / 256, diag / 24); this.inv = 1 / this.cs; this.diag = diag; this.avgEdge = es.avg;
    this.cells = new Map();
    for (let v = 0; v < this.nv; v++) this.gridAdd(v);
  }
  key(x, y, z) { const i = this.inv; return ((Math.floor(x * i) + 512) & 1023) | (((Math.floor(y * i) + 512) & 1023) << 10) | (((Math.floor(z * i) + 512) & 1023) << 20); }
  gridAdd(v) { const P = this.P, k = this.key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); this.vcell[v] = k; let c = this.cells.get(k); if (!c) this.cells.set(k, (c = [])); c.push(v); }
  gridMove(v) {
    const P = this.P, k = this.key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), o = this.vcell[v]; if (k === o) return;
    const c = this.cells.get(o); if (c) { const i = c.indexOf(v); if (i >= 0) { c[i] = c[c.length - 1]; c.pop(); } }
    this.vcell[v] = k; let d = this.cells.get(k); if (!d) this.cells.set(k, (d = [])); d.push(v);
    const b = this.box; b.min.x = Math.min(b.min.x, P[v * 3]); b.min.y = Math.min(b.min.y, P[v * 3 + 1]); b.min.z = Math.min(b.min.z, P[v * 3 + 2]);
    b.max.x = Math.max(b.max.x, P[v * 3]); b.max.y = Math.max(b.max.y, P[v * 3 + 1]); b.max.z = Math.max(b.max.z, P[v * 3 + 2]);
  }
  // vertices within r of (cx,cy,cz) -> ids / t (normalised distance)
  query(cx, cy, cz, r, out) {
    out.n = 0; const P = this.P, r2 = r * r, i = this.inv;
    const x0 = Math.floor((cx - r) * i), x1 = Math.floor((cx + r) * i), y0 = Math.floor((cy - r) * i), y1 = Math.floor((cy + r) * i), z0 = Math.floor((cz - r) * i), z1 = Math.floor((cz + r) * i);
    const visit = (c) => { for (const v of c) { const dx = P[v * 3] - cx, dy = P[v * 3 + 1] - cy, dz = P[v * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2) { if (out.n >= out.ids.length) { const a = new Int32Array(out.ids.length * 2); a.set(out.ids); out.ids = a; const b = new Float32Array(a.length); b.set(out.t); out.t = b; }
        out.ids[out.n] = v; out.t[out.n++] = Math.sqrt(d2) / r; } } };
    const span = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (span > this.cells.size || x1 - x0 > 1000) { for (const c of this.cells.values()) visit(c); return out; }   // huge brush: scan all
    const seen = span > 1 && (x1 - x0 >= 1023 || y1 - y0 >= 1023) ? new Set() : null;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = ((x + 512) & 1023) | (((y + 512) & 1023) << 10) | (((z + 512) & 1023) << 20); const c = this.cells.get(k);
      if (c && (!seen || !seen.has(k))) { seen?.add(k); visit(c); }
    }
    return out;
  }
  // ray (local space, normalised dir) -> nearest hit {t, tri, x,y,z} using the vertex grid
  raycast(o, d) {
    const b = this.box, cs = this.cs; let t0 = 0, t1 = Infinity;
    for (const ax of ['x', 'y', 'z']) { const inv = 1 / d[ax]; let ta = (b.min[ax] - cs - o[ax]) * inv, tb = (b.max[ax] + cs - o[ax]) * inv; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
    if (t0 > t1) return null;
    const s = this.bump(), doneCells = new Set(), step = cs * 0.25, P = this.P, T = this.T; let best = null, lastKey = -1;
    for (let t = t0; t <= t1; t += step) {
      if (best && t > best.t + cs) break;
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t, k = this.key(px, py, pz); if (k === lastKey) continue; lastKey = k;
      const ix = Math.floor(px * this.inv), iy = Math.floor(py * this.inv), iz = Math.floor(pz * this.inv);
      for (let x = ix - 1; x <= ix + 1; x++) for (let y = iy - 1; y <= iy + 1; y++) for (let z = iz - 1; z <= iz + 1; z++) {
        const kk = ((x + 512) & 1023) | (((y + 512) & 1023) << 10) | (((z + 512) & 1023) << 20); if (doneCells.has(kk)) continue; doneCells.add(kk);
        const c = this.cells.get(kk); if (!c) continue;
        for (const v of c) for (const tri of this.vt[v]) {
          if (this.stampT[tri] === s) continue; this.stampT[tri] = s;
          const a = T[tri * 3] * 3, bb = T[tri * 3 + 1] * 3, cc = T[tri * 3 + 2] * 3;
          const e1x = P[bb] - P[a], e1y = P[bb + 1] - P[a + 1], e1z = P[bb + 2] - P[a + 2], e2x = P[cc] - P[a], e2y = P[cc + 1] - P[a + 1], e2z = P[cc + 2] - P[a + 2];
          const px2 = d.y * e2z - d.z * e2y, py2 = d.z * e2x - d.x * e2z, pz2 = d.x * e2y - d.y * e2x, det = e1x * px2 + e1y * py2 + e1z * pz2;
          if (Math.abs(det) < 1e-14) continue; const id = 1 / det;
          const sx = o.x - P[a], sy = o.y - P[a + 1], sz = o.z - P[a + 2], u = (sx * px2 + sy * py2 + sz * pz2) * id; if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, w = (d.x * qx + d.y * qy + d.z * qz) * id; if (w < 0 || u + w > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * id; if (tt > 1e-9 && (!best || tt < best.t)) best = { t: tt, tri };
        }
      }
    }
    if (best) { best.x = o.x + d.x * best.t; best.y = o.y + d.y * best.t; best.z = o.z + d.z * best.t; }
    return best;
  }
  // ---- dynamic topology: split edge a-b (both adjacent triangles, so no T-junctions)
  splitEdge(a, b) {
    const T = this.T, tris = [];
    for (const t of this.vt[a]) if (T[t * 3] === b || T[t * 3 + 1] === b || T[t * 3 + 2] === b) tris.push(t);
    if (!tris.length || tris.length > 2) return -1;
    this.growV(this.nv + 1); this.growT(this.nt + 2);
    const P = this.P, N = this.N, m = this.nv++;
    for (let k = 0; k < 3; k++) { P[m * 3 + k] = (P[a * 3 + k] + P[b * 3 + k]) / 2; N[m * 3 + k] = N[a * 3 + k] + N[b * 3 + k]; }
    const l = Math.hypot(N[m * 3], N[m * 3 + 1], N[m * 3 + 2]) || 1; N[m * 3] /= l; N[m * 3 + 1] /= l; N[m * 3 + 2] /= l;
    this.vt[m] = []; this.mark[m] = 0; this.disp[m] = 0; this.stampV[m] = 0;
    const T2 = this.T;
    for (const t of tris) {
      let k = 0; for (; k < 3; k++) { const x = T2[t * 3 + k], y = T2[t * 3 + (k + 1) % 3]; if ((x === a && y === b) || (x === b && y === a)) break; }
      const x = T2[t * 3 + k], y = T2[t * 3 + (k + 1) % 3], z = T2[t * 3 + (k + 2) % 3], nt = this.nt++;
      T2[t * 3] = x; T2[t * 3 + 1] = m; T2[t * 3 + 2] = z;
      T2[nt * 3] = m; T2[nt * 3 + 1] = y; T2[nt * 3 + 2] = z; this.stampT[nt] = 0;
      const vy = this.vt[y]; vy[vy.indexOf(t)] = nt; this.vt[z].push(nt); this.vt[m].push(t, nt);
      this.touchT(t); this.touchT(nt);
    }
    this.gridAdd(m); this.touchV(m); return m;
  }
  // split every edge longer than L whose midpoint lies inside the brush sphere
  refine(cx, cy, cz, r, L, cap, out) {
    const P = this.P, L2 = L * L, r2 = r * r; let splits = 0;
    for (let round = 0; round < 10; round++) {
      this.query(cx, cy, cz, r + L, out);
      const s = this.bump(), edges = [];
      for (let i = 0; i < out.n; i++) for (const t of this.vt[out.ids[i]]) {
        if (this.stampT[t] === s) continue; this.stampT[t] = s;
        for (let k = 0; k < 3; k++) {
          const a = this.T[t * 3 + k], b = this.T[t * 3 + (k + 1) % 3]; if (a > b) continue;   // each interior edge seen once (from the a<b side)
          const Pa = this.P, l2 = (Pa[a * 3] - Pa[b * 3]) ** 2 + (Pa[a * 3 + 1] - Pa[b * 3 + 1]) ** 2 + (Pa[a * 3 + 2] - Pa[b * 3 + 2]) ** 2;
          if (l2 <= L2) continue;
          const mx = (Pa[a * 3] + Pa[b * 3]) / 2 - cx, my = (Pa[a * 3 + 1] + Pa[b * 3 + 1]) / 2 - cy, mz = (Pa[a * 3 + 2] + Pa[b * 3 + 2]) / 2 - cz;
          if (mx * mx + my * my + mz * mz <= r2) edges.push(l2, a, b);
        }
      }
      if (!edges.length) break;
      const order = []; for (let i = 0; i < edges.length; i += 3) order.push(i); order.sort((i, j) => edges[j] - edges[i]);
      let did = 0;
      for (const i of order) {
        if (this.nt + 2 > cap) return { splits, capped: true };
        const a = edges[i + 1], b = edges[i + 2], Pa = this.P;
        if ((Pa[a * 3] - Pa[b * 3]) ** 2 + (Pa[a * 3 + 1] - Pa[b * 3 + 1]) ** 2 + (Pa[a * 3 + 2] - Pa[b * 3 + 2]) ** 2 <= L2) continue;
        if (this.splitEdge(a, b) >= 0) { splits++; did++; }
        if (splits > 6000) return { splits };
      }
      if (!did) break;
    }
    return { splits };
  }
  snapshot() { return { P: this.P.slice(0, this.nv * 3), T: this.T.slice(0, this.nt * 3) }; }
  compactGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, this.nv * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.T.slice(0, this.nt * 3), 1)); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  flush() {
    const g = this.geo, d = this.dirty;
    if (this.realloc) { this.realloc = false; this.makeGeometry(); return; }
    if (d.v1 >= 0) for (const a of [g.attributes.position, g.attributes.normal]) { a.clearUpdateRanges(); a.addUpdateRange(d.v0 * 3, (d.v1 - d.v0 + 1) * 3); a.needsUpdate = true; }
    if (d.t1 >= 0) { const a = g.index; a.clearUpdateRanges(); a.addUpdateRange(d.t0 * 3, (d.t1 - d.t0 + 1) * 3); a.needsUpdate = true; }
    g.setDrawRange(0, this.nt * 3); this.dirty = { v0: Infinity, v1: -1, t0: Infinity, t1: -1 };
  }
}

function compactFrom(P, T) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P.slice(), 3)); g.setIndex(new THREE.BufferAttribute(T.slice(), 1));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}

// ---------------------------------------------------------------- UI + strokes
export function createSculpt(ctx) {
  const { scene, canvas, controls } = ctx;
  const vp = canvas.parentElement, cam = () => ctx.camera();
  const $ = (id) => document.getElementById(id);
  const opt = { brush: 'standard', radius: 60, strength: 0.5, falloff: 'auto', spacing: 0.12, lazy: false, rope: 25, sym: { x: true, y: false, z: false },
    dyn: false, detail: 0.35, detailMode: 'brush', constDetail: 1.0, softCap: 500000, hardCap: 1000000, smoothBias: 1 };
  let st = null, active = false, stroke = null, hover = null, adjust = null, warned = false;
  const buf = { ids: new Int32Array(4096), t: new Float32Array(4096), n: 0 };
  const rc = new THREE.Raycaster();
  const status = (m) => ctx.status(m);

  // cursor: ring that lies on the surface, oriented by the area normal
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
  const ring = new THREE.Group(); ring.add(new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 72), ringMat));
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.03, 16), ringMat); ring.add(inner);
  const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.515, 64), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.6, depthTest: false, side: THREE.DoubleSide })); ring.add(innerRing);
  ring.renderOrder = 10; ring.children.forEach((c) => { c.renderOrder = 10; c.raycast = () => {}; }); ring.visible = false; scene.add(ring);
  const lazyDot = document.createElement('div'); lazyDot.className = 'lazydot'; lazyDot.hidden = true; vp.appendChild(lazyDot);

  // ---------- panel / palette ----------
  const pal = document.createElement('div'); pal.id = 'brushPalette'; pal.hidden = true;
  pal.innerHTML = `<div class="ptitle">Brushes</div>` + BRUSHES.map((b) => `<button data-b="${b.id}" title="${b.name} (${b.key}): ${b.tip}">${b.icon}<span>${b.name}</span><kbd>${b.key}</kbd></button>`).join('');
  vp.appendChild(pal);
  pal.querySelectorAll('button').forEach((b) => b.onclick = () => setBrush(b.dataset.b));
  const panel = document.createElement('div'); panel.id = 'sculptPanel'; panel.hidden = true;
  panel.innerHTML = `
  <details open><summary>Brush</summary>
    <div class="row"><span>Brush</span><b id="scBrushName" style="grid-column:2/4;text-align:left">Standard</b></div>
    <div class="row"><span>Radius (px)</span><input id="scRad" type="range" min="4" max="400" value="60"><b id="scRadV">60</b></div>
    <div class="row"><span>Strength</span><input id="scStr" type="range" min="0.01" max="1" step="0.01" value="0.5"><b id="scStrV">0.50</b></div>
    <div class="row"><span>Falloff</span><select id="scFall"><option value="auto">Brush default</option><option value="soft">Soft</option><option value="sharp">Sharp</option><option value="constant">Constant</option></select></div>
    <div class="row"><span>Spacing</span><input id="scSpace" type="range" min="0.03" max="0.5" step="0.01" value="0.12"><b id="scSpaceV">12%</b></div>
    <label class="row chk"><input id="scLazy" type="checkbox"> Lazy mouse (rope) <input id="scRope" type="range" min="5" max="120" value="25" style="flex:1"><b id="scRopeV">25px</b></label>
    <div class="row"><span>Symmetry</span><div class="seg" id="scSym"><button data-a="x" class="on">X</button><button data-a="y">Y</button><button data-a="z">Z</button></div></div>
    <div class="hint0">Shift = smooth while held · Alt = invert · S + move mouse = size · U + move = strength</div>
  </details>
  <details open><summary>Sculptron 3D (adaptive detail)</summary>
    <label class="row chk"><input id="scDyn" type="checkbox"> Enabled <span class="grow"></span><b id="scTris">0 tris</b></label>
    <div class="row"><span>Detail by</span><div class="seg" id="scDMode"><button data-v="brush" class="on">Brush size</button><button data-v="constant">Constant</button></div></div>
    <div class="row" id="scDetRow"><span>Detail</span><input id="scDet" type="range" min="0.05" max="1" step="0.01" value="0.35"><b id="scDetV"></b></div>
    <div class="row"><span>Hard cap</span><input id="scCap" class="txt" type="number" min="50000" step="50000" value="1000000"></div>
    <div class="hint0">Edges under the brush longer than the detail size are split, so you can add local detail without stretching. Soft warning at 500k triangles.</div>
  </details>
  <details open><summary>Mesh</summary>
    <div class="row"><button class="btn" id="scSmoothAll">Smooth all (light)</button><button class="btn" id="scHelpBtn">Shortcuts…</button></div>
    <div class="row"><button class="btn" data-sph="2">New sphere 20k</button><button class="btn" data-sph="3">80k</button><button class="btn" data-sph="4">320k</button></div>
    <div class="hint0">Tab or the mode menu returns to Object Mode. Export (File menu) includes your sculpting.</div>
  </details>`;
  document.querySelector('.props').appendChild(panel);
  const help = document.createElement('div'); help.id = 'sculptHelp'; help.className = 'help'; help.hidden = true;
  help.innerHTML = `<b>Sculpt mode shortcuts</b> <small>(click to close)</small><table>
    <tr><td>Left drag on the model</td><td>Sculpt with the current brush</td></tr><tr><td>Left drag off the model / MMB</td><td>Orbit (Shift+MMB pan, wheel zoom)</td></tr>
    <tr><td>1 … 9, 0</td><td>${BRUSHES.map((b) => b.name).join(', ')}</td></tr>
    <tr><td>Shift (hold)</td><td>Smooth while held</td></tr><tr><td>Alt (hold)</td><td>Invert the brush (dig instead of raise)</td></tr>
    <tr><td>S + move mouse / [ ]</td><td>Brush size</td></tr><tr><td>U + move mouse / Shift+[ ]</td><td>Strength</td></tr>
    <tr><td>X</td><td>X symmetry on/off</td></tr><tr><td>L</td><td>Lazy mouse on/off</td></tr><tr><td>F</td><td>Cycle falloff</td></tr>
    <tr><td>D</td><td>Sculptron 3D (adaptive detail) on/off</td></tr><tr><td>Ctrl+Z / Ctrl+Shift+Z</td><td>Undo / redo a stroke</td></tr><tr><td>Tab</td><td>Back to Object Mode</td></tr><tr><td>H</td><td>This panel</td></tr></table>`;
  vp.appendChild(help); help.onclick = () => (help.hidden = true);

  const bindRange = (id, key, fmt, scale = 1) => { const el = $(id); el.oninput = () => { opt[key] = +el.value * scale; $(id + 'V').textContent = fmt(+el.value); }; };
  bindRange('scRad', 'radius', (v) => v); bindRange('scStr', 'strength', (v) => v.toFixed(2)); bindRange('scSpace', 'spacing', (v) => Math.round(v * 100) + '%'); bindRange('scRope', 'rope', (v) => v + 'px');
  $('scDet').oninput = () => { if (opt.detailMode === 'brush') opt.detail = +$('scDet').value; else opt.constDetail = +$('scDet').value; detLabel(); };
  const detLabel = () => { $('scDetV').textContent = opt.detailMode === 'brush' ? `${Math.round(opt.detail * 100)}% of radius` : `${(opt.constDetail).toFixed(2)}% of size`; };
  $('scFall').onchange = (e) => (opt.falloff = e.target.value);
  $('scLazy').onchange = (e) => (opt.lazy = e.target.checked);
  $('scCap').onchange = (e) => (opt.hardCap = Math.max(50000, +e.target.value || 1000000));
  $('scSym').querySelectorAll('button').forEach((b) => b.onclick = () => { opt.sym[b.dataset.a] = !opt.sym[b.dataset.a]; syncUI(); });
  $('scDMode').querySelectorAll('button').forEach((b) => b.onclick = () => { opt.detailMode = b.dataset.v; syncUI(); });
  $('scDyn').onchange = (e) => setDyn(e.target.checked);
  $('scSmoothAll').onclick = () => smoothAll();
  $('scHelpBtn').onclick = () => (help.hidden = !help.hidden);
  panel.querySelectorAll('[data-sph]').forEach((b) => b.onclick = () => ctx.newSphere(+b.dataset.sph));

  function syncUI() {
    pal.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.b === opt.brush));
    const B = BRUSHES.find((b) => b.id === opt.brush); $('scBrushName').textContent = B.name;
    $('scRad').value = opt.radius; $('scRadV').textContent = Math.round(opt.radius); $('scStr').value = opt.strength; $('scStrV').textContent = opt.strength.toFixed(2);
    $('scFall').value = opt.falloff; $('scLazy').checked = opt.lazy; $('scDyn').checked = opt.dyn;
    $('scSym').querySelectorAll('button').forEach((b) => b.classList.toggle('on', opt.sym[b.dataset.a]));
    $('scDMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === opt.detailMode));
    $('scDet').min = opt.detailMode === 'brush' ? 0.05 : 0.1; $('scDet').max = opt.detailMode === 'brush' ? 1 : 5; $('scDet').step = opt.detailMode === 'brush' ? 0.01 : 0.05;
    $('scDet').value = opt.detailMode === 'brush' ? opt.detail : opt.constDetail; detLabel();
    ctx.onDyn?.(opt.dyn); updateTris();
  }
  function updateTris() {
    const n = st ? st.nt : 0, t = `${n.toLocaleString()} tris`;
    $('scTris').textContent = t; ctx.onTris?.(n, n > opt.softCap, active);
  }
  function setBrush(id) { opt.brush = id; syncUI(); status(`Brush: ${BRUSHES.find((b) => b.id === id).name}`); }
  function setDyn(on) { opt.dyn = on; syncUI(); status(on ? `Sculptron 3D on: triangles under the brush are subdivided to ${opt.detailMode === 'brush' ? 'the brush detail size' : 'a constant detail size'}` : 'Sculptron 3D off: brushes move vertices only'); }

  // ---------- enter / exit ----------
  function enter(mesh) {
    let u = mesh.userData.mfSculpt;
    if (!u || u.geo !== mesh.geometry) {
      const w = weldGeometry(mesh.geometry);
      if (w.changed) ctx.clearHistory?.('Sculpt mode welded the mesh (shared vertices), so older Edit Mode steps were cleared');
      const sm = new SculptMesh(mesh, w.P, w.T); u = { sm };
    } else u.sm.load(new Float32Array(mesh.geometry.attributes.position.array), new Uint32Array(mesh.geometry.index.array));
    st = u.sm; st.mesh = mesh;
    setMeshGeometry(mesh, st.geo); mesh.frustumCulled = false; mesh.userData.mfSculpt = u;
    active = true; document.body.classList.add('sculpt'); pal.hidden = panel.hidden = false;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    syncUI(); status(`Sculpt Mode · ${st.nv.toLocaleString()} verts · ${st.nt.toLocaleString()} tris · drag on the model to sculpt, drag off it to orbit · H for shortcuts`);
    return true;
  }
  function exit() {
    if (!active) return; endStroke();
    const mesh = st.mesh, g = st.compactGeometry(); setMeshGeometry(mesh, g); mesh.frustumCulled = true;
    mesh.userData.mfSculpt = { sm: st, geo: g };
    active = false; ring.visible = false; lazyDot.hidden = true; document.body.classList.remove('sculpt'); pal.hidden = panel.hidden = help.hidden = true;
    ctx.onTris?.(st.nt, false, false); ctx.restoreControls?.();
  }
  function setMeshGeometry(mesh, g) {
    const old = mesh.geometry; mesh.geometry = g;
    mesh.traverse((c) => { if (c !== mesh && c.geometry === old) c.geometry = g; });
    if (old !== g && !(st && old === st.geo && active)) { /* keep: old may be referenced by undo snapshots only as arrays */ }
  }

  // ---------- geometry helpers ----------
  const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4();
  function localRay(p) {
    const r = canvas.getBoundingClientRect(); rc.setFromCamera(new THREE.Vector2(p.x / r.width * 2 - 1, -(p.y / r.height) * 2 + 1), cam());
    st.mesh.updateMatrixWorld(true); tmpM.copy(st.mesh.matrixWorld).invert();
    const ray = rc.ray.clone().applyMatrix4(tmpM); ray.direction.normalize(); return ray;
  }
  function pick(p) {
    const ray = localRay(p); let h = st.raycast(ray.origin, ray.direction);
    if (!h) { // fallback: three.js brute-force raycast (covers unusually long triangles)
      const hits = rc.intersectObject(st.mesh, false); if (hits[0]) { const q = st.mesh.worldToLocal(hits[0].point.clone()); h = { x: q.x, y: q.y, z: q.z, tri: hits[0].faceIndex, t: 0 }; }
    }
    if (h) h.ray = ray; return h;
  }
  function pxToLocal(h) { // brush radius in mesh-local units at the hit point
    const c = cam(), r = canvas.getBoundingClientRect(), w = st.mesh.localToWorld(tmpV.set(h.x, h.y, h.z));
    let wpp; if (c.isOrthographicCamera) wpp = (c.top - c.bottom) / c.zoom / r.height;
    else { const d = w.clone().sub(c.position).dot(c.getWorldDirection(new THREE.Vector3())); wpp = 2 * d * Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) / r.height; }
    return opt.radius * wpp / st.mesh.matrixWorld.getMaxScaleOnAxis();
  }
  function areaFrame(cx, cy, cz, r) { // falloff-weighted average normal + centre of the vertices under the brush
    st.query(cx, cy, cz, r, buf); const P = st.P, N = st.N; let nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0, ws = 0;
    for (let i = 0; i < buf.n; i++) { const v = buf.ids[i], w = FALLOFF.soft(buf.t[i]); nx += N[v * 3] * w; ny += N[v * 3 + 1] * w; nz += N[v * 3 + 2] * w; px += P[v * 3] * w; py += P[v * 3 + 1] * w; pz += P[v * 3 + 2] * w; ws += w; }
    const l = Math.hypot(nx, ny, nz); if (!ws || l < 1e-12) return null;
    return { n: [nx / l, ny / l, nz / l], c: [px / ws, py / ws, pz / ws] };
  }
  function remember(v) { // first touch in this stroke: keep the old position for undo
    if (st.mark[v] === stroke.id) return; st.mark[v] = stroke.id; st.disp[v] = 0;
    const S = stroke; if (S.nOrig * 3 + 3 > S.orig.length) { const a = new Float32Array(S.orig.length * 2); a.set(S.orig); S.orig = a; const b = new Int32Array(S.ids.length * 2); b.set(S.ids); S.ids = b; }
    S.ids[S.nOrig] = v; S.orig[S.nOrig * 3] = st.P[v * 3]; S.orig[S.nOrig * 3 + 1] = st.P[v * 3 + 1]; S.orig[S.nOrig * 3 + 2] = st.P[v * 3 + 2]; S.nOrig++;
  }
  function detailLen(r) { return opt.detailMode === 'brush' ? Math.max(r * opt.detail * 0.5, st.diag * 1e-4) : st.diag * opt.constDetail / 100; }

  // ---------- one dab ----------
  function dab(cx, cy, cz, rFull, brush, inv, side) {
    const r = brush === 'pen' ? rFull * 0.33 : rFull;
    if (opt.dyn && brush !== 'move') {
      const res = st.refine(cx, cy, cz, r, detailLen(r), opt.hardCap, buf);
      if (res.splits) stroke.topo = true;
      if (res.capped && !stroke.capWarn) { stroke.capWarn = true; status(`Sculptron 3D reached the hard cap of ${opt.hardCap.toLocaleString()} triangles; detail is no longer added (raise the cap in the panel if your PC copes)`); }
      if (st.nt > opt.softCap && !warned) { warned = true; status(`Heads-up: ${st.nt.toLocaleString()} triangles. Above ~500k the browser may slow down.`); }
    }
    const fr = areaFrame(cx, cy, cz, r); if (!fr) return;
    // dynamic average normal: blend with the previous dab on this symmetry side for a stable stroke
    let [nx, ny, nz] = fr.n; const prev = stroke.sideN[side];
    if (prev) { nx = prev[0] * 0.55 + nx * 0.45; ny = prev[1] * 0.55 + ny * 0.45; nz = prev[2] * 0.55 + nz * 0.45; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    stroke.sideN[side] = [nx, ny, nz];
    const [ax, ay, az] = fr.c;
    const fname = opt.falloff === 'auto' ? BRUSHES.find((b) => b.id === brush).falloff : opt.falloff, F = FALLOFF[fname];
    const s = opt.strength * (opt.spacing / 0.12), sign = inv ? -1 : 1, P = st.P, N = st.N;
    st.query(cx, cy, cz, r, buf); const n = buf.n, ids = buf.ids, ts = buf.t;
    if (brush === 'smooth') { // Jacobi Laplacian towards the 1-ring average
      const T = st.T, tmp = st.tmp, k = Math.min(1, opt.strength * 0.9 + 0.1);
      for (let i = 0; i < n; i++) { const v = ids[i]; let x = 0, y = 0, z = 0, c = 0;
        for (const t of st.vt[v]) for (let j = 0; j < 3; j++) { const u = T[t * 3 + j]; if (u !== v) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; c++; } }
        tmp[i * 3] = c ? x / c : P[v * 3]; tmp[i * 3 + 1] = c ? y / c : P[v * 3 + 1]; tmp[i * 3 + 2] = c ? z / c : P[v * 3 + 2]; }
      for (let i = 0; i < n; i++) { const v = ids[i], w = F(ts[i]) * k; remember(v);
        for (let j = 0; j < 3; j++) P[v * 3 + j] += (tmp[i * 3 + j] - P[v * 3 + j]) * w; }
    } else {
      const amt = r * 0.045 * s;
      for (let i = 0; i < n; i++) {
        const v = ids[i], f = F(ts[i]); if (f <= 0) continue; remember(v);
        const o = v * 3, px = P[o], py = P[o + 1], pz = P[o + 2];
        const h = (px - ax) * nx + (py - ay) * ny + (pz - az) * nz;              // height above the area plane
        let dx = 0, dy = 0, dz = 0;
        const tx = cx - px - nx * ((cx - px) * nx + (cy - py) * ny + (cz - pz) * nz), ty = cy - py - ny * ((cx - px) * nx + (cy - py) * ny + (cz - pz) * nz), tz = cz - pz - nz * ((cx - px) * nx + (cy - py) * ny + (cz - pz) * nz);
        switch (brush) {
          case 'standard': dx = nx * amt * f * sign; dy = ny * amt * f * sign; dz = nz * amt * f * sign; break;
          case 'inflate': dx = N[o] * amt * f * sign; dy = N[o + 1] * amt * f * sign; dz = N[o + 2] * amt * f * sign; break;
          case 'clay': case 'buildup': { // raise towards a plane above the local surface; only fills what is below it
            const lift = r * (brush === 'clay' ? 0.30 : 0.14) * opt.strength, hs = h * sign;
            let d = Math.max(0, lift - hs) * f * (brush === 'clay' ? 0.45 : 0.5) * (opt.spacing / 0.12);
            if (brush === 'clay') { const capv = r * 0.25 * opt.strength; d = Math.min(d, Math.max(0, capv - st.disp[v])); st.disp[v] += d; }  // one even layer per stroke
            dx = nx * d * sign; dy = ny * d * sign; dz = nz * d * sign; break; }
          case 'chisel': { // trim: flatten everything above the area plane with a hard edge
            const hs = h * sign + r * 0.02 * opt.strength; if (hs > 0) { const d = -hs * f * Math.min(1, 0.6 * s + 0.15) * sign; dx = nx * d; dy = ny * d; dz = nz * d; } break; }
          case 'carve': case 'pen': { const dig = (brush === 'pen' ? 3.0 : 1.0) * amt * f * -sign, pk = (brush === 'pen' ? 0.22 : 0.12) * s * f;
            dx = nx * dig + tx * pk; dy = ny * dig + ty * pk; dz = nz * dig + tz * pk; break; }
          case 'pinch': { const pk = 0.2 * s * f * sign; dx = tx * pk; dy = ty * pk; dz = tz * pk; break; }
        }
        P[o] = px + dx; P[o + 1] = py + dy; P[o + 2] = pz + dz;
      }
    }
    for (let i = 0; i < n; i++) { st.gridMove(ids[i]); st.touchV(ids[i]); }
    st.updateNormals(ids, n);
  }
  function mirrors(x, y, z) { // symmetry copies in mesh-local space (across the object's local axes)
    let out = [[x, y, z]];
    for (const a of ['x', 'y', 'z']) if (opt.sym[a]) { const j = { x: 0, y: 1, z: 2 }[a]; out = out.concat(out.map((p) => { const q = p.slice(); q[j] = -q[j]; return q; })); }
    return out;
  }
  function dabAt(h) {
    const t0 = performance.now(), r = pxToLocal(h), brush = stroke.brush;
    mirrors(h.x, h.y, h.z).forEach((p, i) => dab(p[0], p[1], p[2], r, brush, stroke.inv, i));
    stroke.dabs++; stroke.ms += performance.now() - t0; stroke.lastR = r;
  }

  // ---------- Move brush ----------
  function moveStart(h) {
    const r = pxToLocal(h), list = [];
    mirrors(h.x, h.y, h.z).forEach((p, si) => {
      st.query(p[0], p[1], p[2], r, buf); const F = FALLOFF[opt.falloff === 'auto' ? 'soft' : opt.falloff];
      const ids = Int32Array.from(buf.ids.subarray(0, buf.n)), w = new Float32Array(buf.n), o = new Float32Array(buf.n * 3);
      for (let i = 0; i < buf.n; i++) { w[i] = F(buf.t[i]) * Math.min(1, opt.strength * 1.6); const v = ids[i]; remember(v); o.set(st.P.subarray(v * 3, v * 3 + 3), i * 3); }
      const flip = [1, 1, 1]; let k = si; ['x', 'y', 'z'].filter((a) => opt.sym[a]).forEach((a, ai) => { if ((si >> ai) & 1) flip[{ x: 0, y: 1, z: 2 }[a]] = -1; }); void k;
      list.push({ ids, w, o, flip });
    });
    const camDir = cam().getWorldDirection(new THREE.Vector3()).transformDirection(tmpM.copy(st.mesh.matrixWorld).invert());
    stroke.move = { list, h0: new THREE.Vector3(h.x, h.y, h.z), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(h.x, h.y, h.z)) };
  }
  function moveUpdate(p) {
    const M = stroke.move, ray = localRay(p), q = ray.intersectPlane(M.plane, new THREE.Vector3()); if (!q) return;
    const d = q.sub(M.h0), P = st.P;
    for (const L of M.list) { for (let i = 0; i < L.ids.length; i++) { const v = L.ids[i] * 3, w = L.w[i];
      P[v] = L.o[i * 3] + d.x * L.flip[0] * w; P[v + 1] = L.o[i * 3 + 1] + d.y * L.flip[1] * w; P[v + 2] = L.o[i * 3 + 2] + d.z * L.flip[2] * w; }
      for (const v of L.ids) { st.gridMove(v); st.touchV(v); } st.updateNormals(L.ids, L.ids.length); }
    stroke.dabs++;
  }

  // ---------- stroke engine (spacing + lazy mouse) ----------
  let strokeId = 0;
  function beginStroke(p, e) {
    const h = pick(p); if (!h) return false;
    stroke = { id: ++strokeId, brush: e.shiftKey ? 'smooth' : opt.brush, inv: e.altKey, ids: new Int32Array(1024), orig: new Float32Array(3072), nOrig: 0,
      sideN: [], last: p.clone(), lazy: p.clone(), carry: 0, dabs: 0, ms: 0, topo: false, before: opt.dyn ? st.snapshot() : null, nt0: st.nt };
    if (stroke.id >= 4e9) st.mark.fill(0);
    if (stroke.brush === 'move') moveStart(h); else dabAt(h);
    return true;
  }
  function feed(p) {
    if (!stroke) return;
    if (stroke.brush === 'move') { moveUpdate(p); return; }
    let target = p;
    if (opt.lazy) { // lazy rope: the brush only follows once the mouse pulls the rope tight
      const d = p.clone().sub(stroke.lazy), l = d.length(); if (l <= opt.rope) { showLazy(); return; }
      target = stroke.lazy.clone().add(d.multiplyScalar((l - opt.rope) / l));
    }
    const from = opt.lazy ? stroke.lazy : stroke.last, seg = target.clone().sub(from), len = seg.length();
    const spacing = Math.max(1.5, opt.spacing * opt.radius);
    let s = spacing - stroke.carry;
    while (s <= len) { const q = from.clone().addScaledVector(seg, s / len), h = pick(q); if (h) dabAt(h); s += spacing; }
    stroke.carry = len - (s - spacing);
    if (opt.lazy) stroke.lazy.copy(target); stroke.last.copy(target); showLazy();
  }
  function showLazy() { if (!opt.lazy || !stroke) { lazyDot.hidden = true; return; } lazyDot.hidden = false; lazyDot.style.left = stroke.lazy.x + 'px'; lazyDot.style.top = stroke.lazy.y + 'px'; }
  function endStroke() {
    const S = stroke; if (!S) return; stroke = null; lazyDot.hidden = true;
    const mesh = st.mesh, label = BRUSHES.find((b) => b.id === S.brush).name + ' stroke';
    if (S.topo) {
      const before = S.before, after = st.snapshot();
      pushHistory({ label: label + ' (Sculptron 3D)', topo: true, undo: () => applySnapshot(mesh, before), redo: () => applySnapshot(mesh, after) });
    } else if (S.nOrig) {
      const ids = S.ids.slice(0, S.nOrig), before = S.orig.slice(0, S.nOrig * 3), after = new Float32Array(S.nOrig * 3);
      for (let i = 0; i < ids.length; i++) after.set(st.P.subarray(ids[i] * 3, ids[i] * 3 + 3), i * 3);
      pushHistory({ label, undo: () => applyPositions(mesh, ids, before), redo: () => applyPositions(mesh, ids, after) });
    }
    // keep the raycast grid valid if a stroke stretched triangles a lot
    if (st.edgeStats().max * 1.4 > st.cs * 1.6 && st.cs < st.diag / 24) st.buildGrid();
    st.updateBounds();
    lastStats = { dabs: S.dabs, msPerDab: S.dabs ? S.ms / S.dabs : 0, tris: st.nt, verts: st.nv };
    updateTris(); ctx.updateInfo?.();
    status(`${label} · ${S.dabs} dabs · ${(S.dabs ? S.ms / S.dabs : 0).toFixed(2)} ms/dab · ${st.nt.toLocaleString()} tris · Ctrl+Z to undo`);
  }
  let lastStats = null;
  function pushHistory(e) {
    ctx.pushHistory(e);
    // snapshots of big meshes use memory: keep at most 24 topology snapshots in the history
    const stack = ctx.undoStack(); let topo = stack.filter((x) => x.topo).length;
    while (topo > 24) { const i = stack.findIndex((x) => x.topo); stack.splice(0, i + 1); topo--; }
  }
  function sculptOf(mesh) { const u = mesh.userData.mfSculpt; return active && st && st.mesh === mesh ? st : null; void u; }
  function applyPositions(mesh, ids, vals) {
    const s = sculptOf(mesh);
    if (s) { for (let i = 0; i < ids.length; i++) { s.P.set(vals.subarray(i * 3, i * 3 + 3), ids[i] * 3); s.gridMove(ids[i]); s.touchV(ids[i]); } s.updateNormals(ids, ids.length); s.updateBounds(); return; }
    const g = mesh.geometry, P = g.attributes.position.array; for (let i = 0; i < ids.length; i++) P.set(vals.subarray(i * 3, i * 3 + 3), ids[i] * 3);
    g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    if (mesh.userData.mfSculpt) mesh.userData.mfSculpt.geo = g;
  }
  function applySnapshot(mesh, snap) {
    const s = sculptOf(mesh);
    if (s) { s.load(snap.P, snap.T); setMeshGeometry(mesh, s.geo); updateTris(); return; }
    const g = compactFrom(snap.P, snap.T); setMeshGeometry(mesh, g); if (mesh.userData.mfSculpt) mesh.userData.mfSculpt.geo = g; ctx.onTris?.(snap.T.length / 3, false, false);
  }
  function smoothAll() {
    if (!st) return; const ids = new Int32Array(st.nv); for (let i = 0; i < st.nv; i++) ids[i] = i;
    const before = st.P.slice(0, st.nv * 3), T = st.T, P = st.P, tmp = st.tmp;
    for (let v = 0; v < st.nv; v++) { let x = 0, y = 0, z = 0, c = 0; for (const t of st.vt[v]) for (let j = 0; j < 3; j++) { const u = T[t * 3 + j]; if (u !== v) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; c++; } }
      if (c) { tmp[v * 3] = x / c; tmp[v * 3 + 1] = y / c; tmp[v * 3 + 2] = z / c; } else tmp.set(P.subarray(v * 3, v * 3 + 3), v * 3); }
    for (let i = 0; i < st.nv * 3; i++) P[i] += (tmp[i] - P[i]) * 0.3;
    const after = P.slice(0, st.nv * 3), mesh = st.mesh; st.allNormals(); st.buildGrid(); st.touchV(0); st.touchV(st.nv - 1);
    pushHistory({ label: 'Smooth all', undo: () => applyPositions(mesh, ids, before), redo: () => applyPositions(mesh, ids, after) });
  }

  // ---------- input ----------
  const local = (e) => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(e.clientX - r.left, e.clientY - r.top); };
  vp.addEventListener('pointerdown', (e) => {
    if (!active || e.target !== canvas || e.button !== 0) return;
    if (adjust) { adjust = null; return; }
    if (beginStroke(local(e), e)) { e.stopPropagation(); e.preventDefault(); canvas.setPointerCapture?.(e.pointerId); }
  }, true);
  addEventListener('pointermove', (e) => {
    if (!active) return; const p = local(e);
    if (adjust) { const dx = p.x - adjust.x0;
      if (adjust.k === 's') opt.radius = THREE.MathUtils.clamp(adjust.v0 + dx, 4, 400); else opt.strength = THREE.MathUtils.clamp(adjust.v0 + dx / 300, 0.01, 1);
      syncUI(); return; }
    if (stroke) { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; if (evs.length) for (const ce of evs) feed(local(ce)); else feed(p); }
    else hover = p;
  });
  addEventListener('pointerup', (e) => { if (stroke && e.button === 0) endStroke(); });
  canvas.addEventListener('pointerleave', () => { if (!stroke) hover = null; });

  function handleKey(e) {
    if (!active) return false; const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) return false;
    const B = BRUSHES.find((b) => b.key === e.key);
    if (B && !e.altKey) { setBrush(B.id); return true; }
    if ((k === 's' || k === 'u') && !e.repeat) { adjust = { k, x0: hover ? hover.x : 0, v0: k === 's' ? opt.radius : opt.strength }; if (!hover) adjust.x0 = null; status(k === 's' ? 'Move the mouse left/right to change the brush size; release S to finish' : 'Move the mouse left/right to change strength; release U to finish'); return true; }
    if (k === 's' || k === 'u') return true;
    if (e.key === '[' || e.key === '{') { if (e.shiftKey) opt.strength = Math.max(0.01, opt.strength - 0.05); else opt.radius = Math.max(4, opt.radius / 1.15); syncUI(); return true; }
    if (e.key === ']' || e.key === '}') { if (e.shiftKey) opt.strength = Math.min(1, opt.strength + 0.05); else opt.radius = Math.min(400, opt.radius * 1.15); syncUI(); return true; }
    if (k === 'x') { opt.sym.x = !opt.sym.x; syncUI(); status(`X symmetry ${opt.sym.x ? 'on' : 'off'}`); return true; }
    if (k === 'l') { opt.lazy = !opt.lazy; syncUI(); status(`Lazy mouse ${opt.lazy ? 'on' : 'off'}`); return true; }
    if (k === 'f') { const o = ['auto', 'soft', 'sharp', 'constant']; opt.falloff = o[(o.indexOf(opt.falloff) + 1) % 4]; syncUI(); status('Falloff: ' + opt.falloff); return true; }
    if (k === 'd') { setDyn(!opt.dyn); return true; }
    if (k === 'h') { help.hidden = !help.hidden; return true; }
    if (k === 'alt' || k === 'shift') { e.preventDefault(); return true; }
    return false;
  }
  addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (adjust && k === adjust.k) { adjust = null; status(`Radius ${Math.round(opt.radius)} px · strength ${opt.strength.toFixed(2)}`); } });
  addEventListener('pointermove', (e) => { if (adjust && adjust.x0 === null) { adjust.x0 = local(e).x; } }, true);

  // ---------- per frame ----------
  function tick() {
    if (!active || !st) return;
    st.flush();
    const p = stroke ? (opt.lazy ? stroke.lazy : stroke.last) : hover;
    if (!p || (adjust && !hover)) { ring.visible = false; return; }
    const h = pick(p); if (!h) { ring.visible = false; return; }
    const r = pxToLocal(h), fr = areaFrame(h.x, h.y, h.z, r * 0.5) || { n: [0, 1, 0] };
    const mw = st.mesh.matrixWorld, wp = st.mesh.localToWorld(new THREE.Vector3(h.x, h.y, h.z)), wn = new THREE.Vector3(...fr.n).transformDirection(mw);
    ring.position.copy(wp).addScaledVector(wn, r * mw.getMaxScaleOnAxis() * 0.01); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wn);
    ring.scale.setScalar(r * mw.getMaxScaleOnAxis() * (opt.brush === 'pen' ? 0.33 : 1)); ring.visible = true;
    const inv = stroke ? stroke.inv : false; ringMat.color.set(inv ? 0x7fb0ff : (stroke?.brush === 'smooth' ? 0x9fe39f : 0xffffff));
    innerRing.visible = opt.dyn; innerRing.scale.setScalar(opt.detailMode === 'brush' ? Math.max(opt.detail, 0.08) : 0.25);
  }
  function info() { return st && active ? `Sculpt Mode · ${BRUSHES.find((b) => b.id === opt.brush).name} · ${st.nt.toLocaleString()} tris${opt.dyn ? ' · Sculptron 3D' : ''}${opt.sym.x ? ' · X sym' : ''}` : ''; }
  function geometryFor(mesh) { return active && st && st.mesh === mesh ? st.compactGeometry() : null; }

  const debug = { get st() { return st; }, opt, get stroke() { return stroke; }, get lastStats() { return lastStats; }, beginStroke, feed, endStroke, pick, dabAt, setBrush, setDyn, syncUI, smoothAll,
    stroke2(points, mods = {}) { // synthetic stroke in screen pixels, used by the tests
      if (!beginStroke(new THREE.Vector2(...points[0]), { shiftKey: !!mods.shift, altKey: !!mods.alt })) return false;
      for (const q of points.slice(1)) feed(new THREE.Vector2(...q)); endStroke(); return lastStats; } };
  return { enter, exit, tick, handleKey, info, geometryFor, setDyn, setBrush, syncUI, opt, debug, get active() { return active; } };
}
