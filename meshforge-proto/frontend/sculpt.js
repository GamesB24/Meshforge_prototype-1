// MeshForge Sculpt mode (v5): ten brushes, stroke engine (spacing, lazy mouse, symmetry) and
// "Sculptron 3D" adaptive-detail (dynamic topology) sculpting.
// Original MIT code written for MeshForge with three.js. The workflow is inspired by common
// digital-sculpting conventions; no code, names or assets from other sculpting programs are used.
import * as THREE from 'three';
import { getSlots, setSlots, applyGroups, triCount } from './mfdata.js';

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
  // v7
  { id: 'flatten', name: 'Flatten', key: '⇧1', falloff: 'soft', tip: 'Pull the surface onto the average plane under the brush (highs down and lows up)', icon: svg('<path d="M3 15h18"/><path d="M6 10l2 3M12 9v4M18 10l-2 3" opacity=".6"/>') },
  { id: 'crease', name: 'Crease', key: '⇧2', falloff: 'sharp', tip: 'Sharp crease: digs and pinches the sides together hard (Alt: sharp ridge)', icon: svg('<path d="M3 7l9 11 9-11"/><path d="M8 7l4 5 4-5" opacity=".5"/>') },
  { id: 'scrape', name: 'Scrape', key: '⇧3', falloff: 'soft', tip: 'Shave off peaks above the plane with a soft edge (Alt: fill dips)', icon: svg('<path d="M4 14c3-4 5 2 8-2s5 2 8-2"/><path d="M3 18h18"/>') },
  { id: 'mask', name: 'Mask', key: 'M', falloff: 'soft', tip: 'Paint a mask: masked areas are protected from all brushes (Alt: erase mask, Ctrl+I invert)', icon: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>') },
];
// v7 procedural alphas (brush tip textures), u,v in [-1,1] on the tangent plane
export const ALPHAS = {
  none: null,
  noise: (u, v) => { const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const f = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1), sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
    return 0.25 + 0.75 * (0.6 * f(u * 4 + 9, v * 4 + 3) + 0.4 * f(u * 9, v * 9)); },
  dots: (u, v) => { const x = (u * 3 + 10) % 1 - 0.5, y = (v * 3 + 10) % 1 - 0.5; return Math.max(0, 1 - Math.hypot(x, y) * 2.6); },
  stripes: (u) => 0.5 + 0.5 * Math.cos(u * Math.PI * 4),
  square: (u, v) => (Math.max(Math.abs(u), Math.abs(v)) < 0.72 ? 1 : 0),
  ring: (u, v) => { const r = Math.hypot(u, v); return Math.max(0, 1 - Math.abs(r - 0.6) * 5); },
};
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
  const m = Math.min(idx ? idx.count : n, triCount(geo) * 3), T = [], uv = geo.attributes.uv, col = geo.attributes.color, TU = uv ? [] : null, FSl = [];
  const slots = getSlots(geo, false);
  for (let i = 0; i + 2 < m; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    const a = remap[ia], b = remap[ib], c = remap[ic];
    if (a !== b && b !== c && a !== c) { T.push(a, b, c); FSl.push(slots ? slots[i / 3] || 0 : 0); if (TU) TU.push(uv.getX(ia), uv.getY(ia), uv.getX(ib), uv.getY(ib), uv.getX(ic), uv.getY(ic)); }
  }
  let C = null;
  if (col) { C = new Float32Array(P.length); for (let i = 0; i < n; i++) { const w = remap[i]; C[w * 3] = col.getX(i); C[w * 3 + 1] = col.getY(i); C[w * 3 + 2] = col.getZ(i); } }
  return { P: new Float32Array(P), T: new Uint32Array(T), extra: { C, TU: TU && new Float32Array(TU), FS: new Uint16Array(FSl) }, changed: !idx || P.length / 3 !== n };
}

class SculptMesh {
  constructor(mesh, P, T, extra) { this.mesh = mesh; this.load(P, T, extra); }
  load(P, T, extra = {}) {
    this.nv = P.length / 3; this.nt = T.length / 3;
    this.capV = this.nv + 4096; this.capT = this.nt + 8192;
    this.P = new Float32Array(this.capV * 3); this.P.set(P);
    this.N = new Float32Array(this.capV * 3);
    this.T = new Uint32Array(this.capT * 3); this.T.set(T);
    // v7 attributes: vertex colour (C), mask (M), per-corner UVs (TU), material slot (FS) and hidden flag (HT) per triangle
    this.C = extra.C ? new Float32Array(this.capV * 3) : null; if (this.C) this.C.set(extra.C.subarray(0, this.nv * 3));
    this.M = new Float32Array(this.capV); if (extra.M) this.M.set(extra.M.subarray(0, this.nv));
    this.TU = extra.TU ? new Float32Array(this.capT * 6) : null; if (this.TU) this.TU.set(extra.TU.subarray(0, this.nt * 6));
    this.FS = new Uint16Array(this.capT); if (extra.FS) this.FS.set(extra.FS.subarray(0, this.nt));
    this.HT = new Uint8Array(this.capT); if (extra.HT) this.HT.set(extra.HT.subarray(0, this.nt)); this.nHidden = extra.HT ? extra.HT.reduce((a, b) => a + b, 0) : 0; this.Tdraw = null;
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
    g.setAttribute('position', pa); g.setAttribute('normal', na);
    if (this.nHidden) { this.Tdraw = new Uint32Array(this.capT * 3); this.fillDraw(0, this.nt); const da = new THREE.BufferAttribute(this.Tdraw, 1); da.setUsage(THREE.DynamicDrawUsage); g.setIndex(da); } else { this.Tdraw = null; g.setIndex(ia); }
    if (this.C) { const ca = new THREE.BufferAttribute(this.C, 3); ca.setUsage(THREE.DynamicDrawUsage); g.setAttribute('color', ca); }
    const ma = new THREE.BufferAttribute(this.M, 1); ma.setUsage(THREE.DynamicDrawUsage); g.setAttribute('mfMask', ma);
    setSlots(g, this.FS); g.userData.mfGK = null;
    g.setDrawRange(0, this.nt * 3); this.updateBounds(g); this.geo = g; this.dirty = { v0: Infinity, v1: -1, t0: Infinity, t1: -1 };
    return g;
  }
  fillDraw(t0, t1) { const T = this.T, D = this.Tdraw; for (let t = t0; t < t1; t++) { if (this.HT[t]) { D[t * 3] = D[t * 3 + 1] = D[t * 3 + 2] = T[t * 3]; } else { D[t * 3] = T[t * 3]; D[t * 3 + 1] = T[t * 3 + 1]; D[t * 3 + 2] = T[t * 3 + 2]; } } }
  updateBounds(g = this.geo) {
    const b = new THREE.Box3(), v = new THREE.Vector3(); for (let i = 0; i < this.nv; i++) b.expandByPoint(v.fromArray(this.P, i * 3));
    this.box = b; g.boundingBox = b.clone(); g.boundingSphere = b.getBoundingSphere(new THREE.Sphere()); g.boundingSphere.radius *= 2;
  }
  growV(need) {
    if (need <= this.capV) return; const cap = Math.ceil(need * 1.5) + 4096;
    const g = (A, n) => { const B = new A.constructor(n); B.set(A); return B; };
    this.P = g(this.P, cap * 3); this.N = g(this.N, cap * 3); this.vcell = g(this.vcell, cap); this.stampV = g(this.stampV, cap);
    this.mark = g(this.mark, cap); this.disp = g(this.disp, cap); this.tmp = new Float32Array(cap * 3); this.M = g(this.M, cap); if (this.C) this.C = g(this.C, cap * 3); this.capV = cap; this.realloc = true;
  }
  growT(need) {
    if (need <= this.capT) return; const cap = Math.ceil(need * 1.5) + 8192;
    const T = new Uint32Array(cap * 3); T.set(this.T); this.T = T; const s = new Uint32Array(cap); s.set(this.stampT); this.stampT = s;
    const F = new Uint16Array(cap); F.set(this.FS); this.FS = F; const H = new Uint8Array(cap); H.set(this.HT); this.HT = H; if (this.TU) { const U = new Float32Array(cap * 6); U.set(this.TU); this.TU = U; }
    this.capT = cap; this.realloc = true;
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
          if (this.stampT[tri] === s) continue; this.stampT[tri] = s; if (this.HT[tri]) continue;
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
    this.vt[m] = []; this.mark[m] = 0; this.disp[m] = 0; this.stampV[m] = 0; this.M[m] = (this.M[a] + this.M[b]) / 2;
    if (this.C) for (let k = 0; k < 3; k++) this.C[m * 3 + k] = (this.C[a * 3 + k] + this.C[b * 3 + k]) / 2;
    const T2 = this.T, U = this.TU;
    for (const t of tris) {
      let k = 0; for (; k < 3; k++) { const x = T2[t * 3 + k], y = T2[t * 3 + (k + 1) % 3]; if ((x === a && y === b) || (x === b && y === a)) break; }
      const x = T2[t * 3 + k], y = T2[t * 3 + (k + 1) % 3], z = T2[t * 3 + (k + 2) % 3], nt = this.nt++;
      T2[t * 3] = x; T2[t * 3 + 1] = m; T2[t * 3 + 2] = z;
      T2[nt * 3] = m; T2[nt * 3 + 1] = y; T2[nt * 3 + 2] = z; this.stampT[nt] = 0; this.FS[nt] = this.FS[t]; this.HT[nt] = this.HT[t];
      if (U) { const o = t * 6, i0 = o + k * 2, i1 = o + ((k + 1) % 3) * 2, i2 = o + ((k + 2) % 3) * 2;
        const ux = U[i0], vx = U[i0 + 1], uy = U[i1], vy = U[i1 + 1], uz = U[i2], vz = U[i2 + 1], um = (ux + uy) / 2, vm = (vx + vy) / 2, q = nt * 6;
        U[o] = ux; U[o + 1] = vx; U[o + 2] = um; U[o + 3] = vm; U[o + 4] = uz; U[o + 5] = vz;
        U[q] = um; U[q + 1] = vm; U[q + 2] = uy; U[q + 3] = vy; U[q + 4] = uz; U[q + 5] = vz; }
      const vy = this.vt[y]; vy[vy.indexOf(t)] = nt; this.vt[z].push(nt); this.vt[m].push(t, nt);
      this.touchT(t); this.touchT(nt);
    }
    this.gridAdd(m); this.touchV(m); return m;
  }
  // split every edge longer than L whose midpoint lies inside the brush sphere
  refine(cx, cy, cz, r, L, cap, out, rounds = 10) {
    const P = this.P, L2 = L * L, r2 = r * r; let splits = 0;
    for (let round = 0; round < rounds; round++) {
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
        if (splits > (rounds === 10 ? 6000 : 4e6)) return { splits };
      }
      if (!did) break;
    }
    return { splits };
  }
  snapshot() { return { P: this.P.slice(0, this.nv * 3), T: this.T.slice(0, this.nt * 3), C: this.C && this.C.slice(0, this.nv * 3), M: this.M.slice(0, this.nv), TU: this.TU && this.TU.slice(0, this.nt * 6), FS: this.FS.slice(0, this.nt), HT: this.nHidden ? this.HT.slice(0, this.nt) : null }; }
  compactGeometry() { return compactArrays(this.snapshot(), this.N.subarray(0, this.nv * 3), this.mesh); }
  // v7 edge collapse: merge b into a when the edge is shorter than L (link condition, no flips, UV-chart aware)
  collapseEdge(a, b) {
    const T = this.T, P = this.P, U = this.TU, shared = [], other = [];
    for (const t of this.vt[b]) { if (T[t * 3] === a || T[t * 3 + 1] === a || T[t * 3 + 2] === a) shared.push(t); else other.push(t); }
    if (shared.length !== 2) return false; // boundary or non-manifold edge: keep
    const ring = (v) => { const r = new Set(); for (const t of this.vt[v]) for (let k = 0; k < 3; k++) r.add(T[t * 3 + k]); r.delete(v); return r; };
    const ra = ring(a), rb = ring(b); let common = 0; for (const v of rb) if (ra.has(v)) common++;
    if (common !== 2) return false;
    if (this.vt[a].length + other.length > 24) return false;
    const mx = (P[a * 3] + P[b * 3]) / 2, my = (P[a * 3 + 1] + P[b * 3 + 1]) / 2, mz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
    const f0 = new Float64Array(3), f1 = new Float64Array(3);
    const flips = (t, moved) => { this.faceN(t, f0); const sv = []; for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; if (v === moved) { sv.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); P[v * 3] = mx; P[v * 3 + 1] = my; P[v * 3 + 2] = mz; } }
      this.faceN(t, f1); for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; if (v === moved) { const q = sv.shift(); P[v * 3] = q[0]; P[v * 3 + 1] = q[1]; P[v * 3 + 2] = q[2]; } }
      return f0[0] * f1[0] + f0[1] * f1[1] + f0[2] * f1[2] <= 0; };
    for (const t of other) if (flips(t, b)) return false;
    for (const t of this.vt[a]) if (!shared.includes(t) && flips(t, a)) return false;
    // UVs: b's corners in the other triangles must sit in the same chart as the shared ones
    let du = 0, dv = 0, ua = 0, va = 0;
    if (U) { const t = shared[0], ka = [0, 1, 2].find((k) => T[t * 3 + k] === a), kb = [0, 1, 2].find((k) => T[t * 3 + k] === b);
      const t2 = shared[1], ka2 = [0, 1, 2].find((k) => T[t2 * 3 + k] === a), kb2 = [0, 1, 2].find((k) => T[t2 * 3 + k] === b);
      const ub = U[t * 6 + kb * 2], vb = U[t * 6 + kb * 2 + 1]; ua = U[t * 6 + ka * 2]; va = U[t * 6 + ka * 2 + 1];
      if (Math.abs(U[t2 * 6 + ka2 * 2] - ua) + Math.abs(U[t2 * 6 + ka2 * 2 + 1] - va) + Math.abs(U[t2 * 6 + kb2 * 2] - ub) + Math.abs(U[t2 * 6 + kb2 * 2 + 1] - vb) > 1e-5) return false; // seam edge
      for (const t3 of [...other, ...this.vt[a]]) { if (shared.includes(t3)) continue; const v = t3 * 6; for (let k = 0; k < 3; k++) { const w = T[t3 * 3 + k]; if (w !== a && w !== b) continue;
        const ru = w === a ? ua : ub, rv = w === a ? va : vb; if (Math.abs(U[v + k * 2] - ru) + Math.abs(U[v + k * 2 + 1] - rv) > 1e-5) return false; } }
      du = (ua + ub) / 2; dv = (va + vb) / 2; }
    // apply: a moves to the midpoint, b's triangles are re-pointed to a, the two shared ones are removed
    P[a * 3] = mx; P[a * 3 + 1] = my; P[a * 3 + 2] = mz; this.M[a] = Math.max(this.M[a], this.M[b]);
    if (this.C) for (let k = 0; k < 3; k++) this.C[a * 3 + k] = (this.C[a * 3 + k] + this.C[b * 3 + k]) / 2;
    for (const t of other) { for (let k = 0; k < 3; k++) if (T[t * 3 + k] === b) { T[t * 3 + k] = a; if (U) { U[t * 6 + k * 2] = du; U[t * 6 + k * 2 + 1] = dv; } } this.vt[a].push(t); this.touchT(t); }
    if (U) for (const t of this.vt[a]) for (let k = 0; k < 3; k++) if (T[t * 3 + k] === a && !shared.includes(t)) { U[t * 6 + k * 2] = du; U[t * 6 + k * 2 + 1] = dv; }
    this.vt[b] = []; const c = this.cells.get(this.vcell[b]); if (c) { const i = c.indexOf(b); if (i >= 0) { c[i] = c[c.length - 1]; c.pop(); } } this.vcell[b] = -1;
    shared.sort((x, y) => y - x).forEach((t) => this.removeTri(t));
    this.gridMove(a); this.touchV(a); this.vertNormal(a); return true;
  }
  removeTri(t) { // swap-remove triangle t with the last one
    const T = this.T, last = --this.nt;
    for (let k = 0; k < 3; k++) { const l = this.vt[T[t * 3 + k]]; const i = l.indexOf(t); if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); } }
    if (t !== last) {
      for (let k = 0; k < 3; k++) { const l = this.vt[T[last * 3 + k]]; const i = l.indexOf(last); if (i >= 0) l[i] = t; T[t * 3 + k] = T[last * 3 + k]; }
      this.FS[t] = this.FS[last]; this.HT[t] = this.HT[last]; if (this.TU) this.TU.copyWithin(t * 6, last * 6, last * 6 + 6);
    }
    this.touchT(t); this.touchT(last);
  }
  // collapse edges shorter than Lmin inside the sphere (or everywhere when r is Infinity)
  coarsen(cx, cy, cz, r, Lmin, budget = 4000) {
    const P = this.P, T = this.T, L2 = Lmin * Lmin; let done = 0;
    for (let round = 0; round < 6 && done < budget; round++) {
      const cand = [];
      const consider = (t) => { for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3]; if (a > b) continue;
        const l2 = (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2; if (l2 >= L2) continue;
        if (r !== Infinity) { const mx = (P[a * 3] + P[b * 3]) / 2 - cx, my = (P[a * 3 + 1] + P[b * 3 + 1]) / 2 - cy, mz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2 - cz; if (mx * mx + my * my + mz * mz > r * r) continue; }
        cand.push(l2, a, b); } };
      if (r === Infinity) for (let t = 0; t < this.nt; t++) consider(t);
      else { const out = { ids: new Int32Array(1024), t: new Float32Array(1024), n: 0 }; this.query(cx, cy, cz, r, out); const s = this.bump();
        for (let i = 0; i < out.n; i++) for (const t of this.vt[out.ids[i]]) { if (this.stampT[t] === s) continue; this.stampT[t] = s; consider(t); } }
      if (!cand.length) break;
      const order = []; for (let i = 0; i < cand.length; i += 3) order.push(i); order.sort((i, j) => cand[i] - cand[j]);
      let did = 0;
      for (const i of order) { const a = cand[i + 1], b = cand[i + 2]; if (!this.vt[a].length || !this.vt[b].length) continue;
        if ((P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2 >= L2) continue;
        if (this.collapseEdge(a, b)) { did++; if (++done >= budget) break; } }
      if (!did) break;
    }
    if (done) { this.touchV(0); this.touchV(this.nv - 1); }
    return done;
  }
  flush() {
    const g = this.geo, d = this.dirty;
    if (this.realloc) { this.realloc = false; this.makeGeometry(); return; }
    const vat = [g.attributes.position, g.attributes.normal, g.attributes.mfMask]; if (g.attributes.color) vat.push(g.attributes.color);
    if (d.v1 >= 0) for (const a of vat) { a.clearUpdateRanges(); a.addUpdateRange(d.v0 * a.itemSize, (d.v1 - d.v0 + 1) * a.itemSize); a.needsUpdate = true; }
    if (d.t1 >= 0) { if (this.Tdraw) this.fillDraw(d.t0, Math.min(d.t1 + 1, this.capT)); const a = g.index; a.clearUpdateRanges(); a.addUpdateRange(d.t0 * 3, (d.t1 - d.t0 + 1) * 3); a.needsUpdate = true; }
    g.setDrawRange(0, this.nt * 3); this.dirty = { v0: Infinity, v1: -1, t0: Infinity, t1: -1 };
  }
}

// welded arrays -> render/export geometry. Vertices are split by UV (seams) so each corner keeps its UV;
// normals come from the welded mesh so there are no shading seams; orphan vertices (from edge collapse) are dropped.
function compactArrays(snap, N, mesh) {
  const { P, T, C, TU, FS } = snap, nt = T.length / 3, nv = P.length / 3;
  if (!N) { N = new Float32Array(nv * 3); for (let t = 0; t < nt; t++) { const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; } }
    for (let i = 0; i < nv; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; } }
  const map = new Map(), src = [], uvs = [], I = new Uint32Array(nt * 3);
  // keep triangles of one material slot together (few draw calls); stable order inside a slot
  let order = null; if (FS && FS.some((x) => x)) { order = Array.from({ length: nt }, (_, i) => i); order.sort((x, y) => FS[x] - FS[y] || x - y); }
  for (let q = 0; q < nt; q++) { const t = order ? order[q] : q; for (let k = 0; k < 3; k++) {
    const v = T[t * 3 + k]; let key = v;
    if (TU) { const u = TU[t * 6 + k * 2], w = TU[t * 6 + k * 2 + 1]; key = v + ':' + Math.round(u * 1e5) + ',' + Math.round(w * 1e5); }
    let id = map.get(key); if (id === undefined) { id = src.length; map.set(key, id); src.push(v); if (TU) uvs.push(TU[t * 6 + k * 2], TU[t * 6 + k * 2 + 1]); }
    I[q * 3 + k] = id;
  } }
  const n = src.length, Pn = new Float32Array(n * 3), Nn = new Float32Array(n * 3), Cn = C ? new Float32Array(n * 3) : null;
  for (let i = 0; i < n; i++) { const v = src[i]; for (let k = 0; k < 3; k++) { Pn[i * 3 + k] = P[v * 3 + k]; Nn[i * 3 + k] = N[v * 3 + k]; if (Cn) Cn[i * 3 + k] = C[v * 3 + k]; } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Pn, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  if (Cn) g.setAttribute('color', new THREE.BufferAttribute(Cn, 3)); if (TU) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  if (order) { setSlots(g, Uint16Array.from(order, (t) => FS[t])); applyGroups(g, mesh?.userData.mf?.slots.length || 1); }
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}

// ---------------------------------------------------------------- UI + strokes
export function createSculpt(ctx) {
  const { scene, canvas, controls } = ctx;
  const vp = canvas.parentElement, cam = () => ctx.camera();
  const $ = (id) => document.getElementById(id);
  const opt = { brush: 'standard', radius: 60, strength: 0.5, falloff: 'auto', spacing: 0.12, lazy: false, rope: 25, sym: { x: true, y: false, z: false },
    dyn: false, detail: 0.35, detailMode: 'brush', constDetail: 1.0, softCap: 500000, hardCap: 1000000, smoothBias: 1,
    alpha: 'none', stabilize: 0, pressureSize: false, pressureStrength: true, collapse: true, maskOverlay: true };
  let pressure = 1;
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
  const maskMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'attribute float mfMask; varying float vM; void main(){ vM = mfMask; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vM; void main(){ if (vM < 0.01) discard; gl_FragColor = vec4(0.05,0.05,0.08, 0.62 * clamp(vM,0.0,1.0)); }' });
  let maskMesh = null;
  function syncMaskMesh() { if (!st || !active) { if (maskMesh) { maskMesh.parent?.remove(maskMesh); maskMesh = null; } return; }
    if (!maskMesh) { maskMesh = new THREE.Mesh(st.geo, maskMat); maskMesh.userData.isOverlay = true; maskMesh.raycast = () => {}; maskMesh.renderOrder = 3; maskMesh.frustumCulled = false; }
    if (maskMesh.parent !== st.mesh) st.mesh.add(maskMesh); maskMesh.geometry = st.geo; maskMesh.visible = opt.maskOverlay; }
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
  <details open><summary>Brush tip &amp; stroke</summary>
    <div class="row"><span>Alpha</span><select id="scAlpha"><option value="none">None (smooth)</option><option value="noise">Noise</option><option value="dots">Dots</option><option value="stripes">Stripes</option><option value="square">Square</option><option value="ring">Ring</option></select></div>
    <div class="row"><span>Stabiliser</span><input id="scStab" type="range" min="0" max="0.95" step="0.05" value="0"><b id="scStabV">off</b></div>
    <label class="row chk"><input id="scPrS" type="checkbox" checked> Pen pressure → strength</label>
    <label class="row chk"><input id="scPrR" type="checkbox"> Pen pressure → size</label>
  </details>
  <details open><summary>Mask</summary>
    <div class="row"><button class="btn" id="scMkBrush">Mask brush (M)</button><button class="btn" id="scMkInv">Invert</button><button class="btn" id="scMkClr">Clear</button></div>
    <div class="row"><button class="btn" id="scMkBlur">Blur</button><button class="btn" id="scMkSharp">Sharpen</button><label class="chk"><input id="scMkShow" type="checkbox" checked> Show</label></div>
    <div class="row"><button class="btn" id="scHide">Hide masked</button><button class="btn" id="scUnhide">Show all</button></div>
    <div class="hint0">Masked (dark) areas are protected from every brush. Alt with the Mask brush erases. Hidden parts can't be sculpted or picked; leaving Sculpt Mode shows them again.</div>
  </details>
  <details open><summary>Sculptron 3D (adaptive detail)</summary>
    <label class="row chk"><input id="scDyn" type="checkbox"> Enabled <span class="grow"></span><b id="scTris">0 tris</b></label>
    <div class="row"><span>Detail by</span><div class="seg" id="scDMode"><button data-v="brush" class="on">Brush size</button><button data-v="constant">Constant</button></div></div>
    <div class="row" id="scDetRow"><span>Detail</span><input id="scDet" type="range" min="0.05" max="1" step="0.01" value="0.35"><b id="scDetV"></b></div>
    <div class="row"><span>Hard cap</span><input id="scCap" class="txt" type="number" min="50000" step="50000" value="1000000"></div>
    <label class="row chk"><input id="scCol" type="checkbox" checked> Also collapse tiny edges (keeps density even)</label>
    <div class="hint0">Edges under the brush longer than the detail size are split, so you can add local detail without stretching. Soft warning at 500k triangles.</div>
  </details>
  <details open><summary>Mesh</summary>
    <div class="row"><button class="btn" id="scSmoothAll">Smooth all (light)</button><button class="btn" id="scHelpBtn">Shortcuts…</button></div>
    <div class="row"><button class="btn" id="scSubdiv">Subdivide (finer)</button><button class="btn" id="scReduce">Reduce (coarser)</button></div>
    <div class="row"><button class="btn" data-sph="2">New sphere 20k</button><button class="btn" data-sph="3">80k</button><button class="btn" data-sph="4">320k</button></div>
    <div class="hint0">Tab or the mode menu returns to Object Mode. Export (File menu) includes your sculpting.</div>
  </details>`;
  document.querySelector('.props').appendChild(panel);
  const help = document.createElement('div'); help.id = 'sculptHelp'; help.className = 'help'; help.hidden = true;
  help.innerHTML = `<b>Sculpt mode shortcuts</b> <small>(click to close)</small><table>
    <tr><td>Left drag on the model</td><td>Sculpt with the current brush</td></tr><tr><td>Left drag off the model / MMB</td><td>Orbit (Shift+MMB pan, wheel zoom)</td></tr>
    <tr><td>1 … 9, 0</td><td>${BRUSHES.slice(0, 10).map((b) => b.name).join(', ')}</td></tr><tr><td>Shift+1 / 2 / 3, M</td><td>Flatten, Crease, Scrape, Mask</td></tr>
    <tr><td>Ctrl+I · Alt+M</td><td>Invert mask · clear mask</td></tr>
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
  $('scAlpha').onchange = (e) => (opt.alpha = e.target.value);
  $('scStab').oninput = (e) => { opt.stabilize = +e.target.value; $('scStabV').textContent = opt.stabilize ? Math.round(opt.stabilize * 100) + '%' : 'off'; };
  $('scPrS').onchange = (e) => (opt.pressureStrength = e.target.checked); $('scPrR').onchange = (e) => (opt.pressureSize = e.target.checked);
  $('scCol').onchange = (e) => (opt.collapse = e.target.checked);
  $('scMkBrush').onclick = () => setBrush('mask'); $('scMkInv').onclick = () => maskOp('invert'); $('scMkClr').onclick = () => maskOp('clear');
  $('scMkBlur').onclick = () => maskOp('blur'); $('scMkSharp').onclick = () => maskOp('sharpen'); $('scMkShow').onchange = (e) => { opt.maskOverlay = e.target.checked; syncMaskMesh(); };
  $('scHide').onclick = () => hideMasked(true); $('scUnhide').onclick = () => hideMasked(false);
  $('scSubdiv').onclick = () => remesh('subdivide'); $('scReduce').onclick = () => remesh('reduce');

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
    if (ctx.blockMode?.(mesh, 'sculpt')) return false;
    let u = mesh.userData.mfSculpt;
    const stamp = (g) => { const sl = getSlots(g, false); let h = 0; if (sl) for (let i = 0; i < sl.length; i++) h = (h * 31 + sl[i] + i) | 0; return `${g.attributes.position.version}/${g.index?.version}/${g.attributes.color?.version}/${g.attributes.uv?.version}/${h}`; };
    if (!u || u.geo !== mesh.geometry || !u.snap || u.stamp !== stamp(mesh.geometry)) {
      const w = weldGeometry(mesh.geometry);
      if (w.changed) ctx.clearHistory?.('Sculpt mode welded the mesh (shared vertices), so older Edit Mode steps were cleared');
      const sm = new SculptMesh(mesh, w.P, w.T, w.extra); u = { sm };
    } else { const sn = u.snap; sn.HT = null; u.sm.load(sn.P, sn.T, sn); }
    st = u.sm; st.mesh = mesh;
    setMeshGeometry(mesh, st.geo); mesh.frustumCulled = false; mesh.userData.mfSculpt = u;
    active = true; syncMaskMesh(); document.body.classList.add('sculpt'); pal.hidden = panel.hidden = false;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    syncUI(); status(`Sculpt Mode · ${st.nv.toLocaleString()} verts · ${st.nt.toLocaleString()} tris · drag on the model to sculpt, drag off it to orbit · H for shortcuts`);
    return true;
  }
  function exit() {
    if (!active) return; endStroke();
    const mesh = st.mesh, g = st.compactGeometry(); setMeshGeometry(mesh, g); mesh.frustumCulled = true;
    const sn = st.snapshot(); sn.HT = null; const sl = getSlots(g, false); let h = 0; if (sl) for (let i = 0; i < sl.length; i++) h = (h * 31 + sl[i] + i) | 0;
    mesh.userData.mfSculpt = { sm: st, geo: g, snap: sn, stamp: `${g.attributes.position.version}/${g.index?.version}/${g.attributes.color?.version}/${g.attributes.uv?.version}/${h}` };
    active = false; syncMaskMesh(); ring.visible = false; lazyDot.hidden = true; document.body.classList.remove('sculpt'); pal.hidden = panel.hidden = help.hidden = true;
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
  function rememberMask(v) {
    const S = stroke; if (!S.mask) S.mask = new Map(); if (!S.mask.has(v)) S.mask.set(v, st.M[v]);
  }
  function detailLen(r) { return opt.detailMode === 'brush' ? Math.max(r * opt.detail * 0.5, st.diag * 1e-4) : st.diag * opt.constDetail / 100; }

  // ---------- one dab ----------
  function dab(cx, cy, cz, rFull, brush, inv, side) {
    const r = brush === 'pen' ? rFull * 0.33 : rFull;
    if (opt.dyn && brush !== 'move' && brush !== 'mask') {
      const res = st.refine(cx, cy, cz, r, detailLen(r), opt.hardCap, buf);
      if (res.splits) stroke.topo = true;
      if (opt.collapse && st.coarsen(cx, cy, cz, r, detailLen(r) * 0.4, 600)) stroke.topo = true;
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
    const pr = opt.pressureStrength ? stroke.pressure : 1;
    const s = opt.strength * pr * (opt.spacing / 0.12), sign = inv ? -1 : 1, P = st.P, N = st.N, MK = st.M;
    st.query(cx, cy, cz, r, buf); const n = buf.n, ids = buf.ids, ts = buf.t;
    // brush tip alpha on the tangent plane (u,v in -1..1), random rotation per stroke
    const AL = ALPHAS[opt.alpha]; let bx = 0, by = 0, bz = 0, cxv = 0, cyv = 0, czv = 0;
    if (AL) { const up = Math.abs(ny) < 0.9 ? [0, 1, 0] : [1, 0, 0]; bx = up[1] * nz - up[2] * ny; by = up[2] * nx - up[0] * nz; bz = up[0] * ny - up[1] * nx; const l = Math.hypot(bx, by, bz) || 1; bx /= l; by /= l; bz /= l;
      cxv = ny * bz - nz * by; cyv = nz * bx - nx * bz; czv = nx * by - ny * bx; }
    const tip = (v) => { let w = 1 - MK[v]; if (AL && w > 0) { const dx = P[v * 3] - cx, dy = P[v * 3 + 1] - cy, dz = P[v * 3 + 2] - cz; w *= AL((dx * bx + dy * by + dz * bz) / r, (dx * cxv + dy * cyv + dz * czv) / r); } return w; };
    if (brush === 'mask') { // paint the mask itself (Alt erases); undo is recorded per stroke
      for (let i = 0; i < n; i++) { const v = ids[i], f = F(ts[i]) * Math.min(1, opt.strength * pr * 1.5) * (AL ? tip(v) + MK[v] : 1); if (f <= 0) continue; rememberMask(v);
        MK[v] = THREE.MathUtils.clamp(MK[v] + (inv ? -f : f), 0, 1); st.touchV(v); }
      return;
    }
    if (brush === 'smooth') { // Jacobi Laplacian towards the 1-ring average
      const T = st.T, tmp = st.tmp, k = Math.min(1, opt.strength * 0.9 + 0.1);
      for (let i = 0; i < n; i++) { const v = ids[i]; let x = 0, y = 0, z = 0, c = 0;
        for (const t of st.vt[v]) for (let j = 0; j < 3; j++) { const u = T[t * 3 + j]; if (u !== v) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; c++; } }
        tmp[i * 3] = c ? x / c : P[v * 3]; tmp[i * 3 + 1] = c ? y / c : P[v * 3 + 1]; tmp[i * 3 + 2] = c ? z / c : P[v * 3 + 2]; }
      for (let i = 0; i < n; i++) { const v = ids[i], w = F(ts[i]) * k * tip(v); if (w <= 0) continue; remember(v);
        for (let j = 0; j < 3; j++) P[v * 3 + j] += (tmp[i * 3 + j] - P[v * 3 + j]) * w; }
    } else {
      const amt = r * 0.045 * s;
      for (let i = 0; i < n; i++) {
        const v = ids[i], f = F(ts[i]) * tip(v); if (f <= 0) continue; remember(v);
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
          case 'flatten': { const d = -h * f * Math.min(1, 0.35 * s + 0.05); dx = nx * d; dy = ny * d; dz = nz * d; break; }
          case 'scrape': { const hs = h * sign; if (hs > 0) { const d = -hs * f * Math.min(1, 0.4 * s + 0.05) * sign; dx = nx * d; dy = ny * d; dz = nz * d; } break; }
          case 'crease': { const dig = 1.6 * amt * f * -sign, pk = 0.45 * s * f; dx = nx * dig + tx * pk; dy = ny * dig + ty * pk; dz = nz * dig + tz * pk; break; }
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
    const t0 = performance.now(), r = pxToLocal(h) * (opt.pressureSize ? 0.25 + 0.75 * stroke.pressure : 1), brush = stroke.brush;
    mirrors(h.x, h.y, h.z).forEach((p, i) => dab(p[0], p[1], p[2], r, brush, stroke.inv, i));
    stroke.dabs++; stroke.ms += performance.now() - t0; stroke.lastR = r;
  }

  // ---------- Move brush ----------
  function moveStart(h) {
    const r = pxToLocal(h), list = [];
    mirrors(h.x, h.y, h.z).forEach((p, si) => {
      st.query(p[0], p[1], p[2], r, buf); const F = FALLOFF[opt.falloff === 'auto' ? 'soft' : opt.falloff];
      const ids = Int32Array.from(buf.ids.subarray(0, buf.n)), w = new Float32Array(buf.n), o = new Float32Array(buf.n * 3);
      for (let i = 0; i < buf.n; i++) { const v = ids[i]; w[i] = F(buf.t[i]) * Math.min(1, opt.strength * 1.6) * (1 - st.M[v]); remember(v); o.set(st.P.subarray(v * 3, v * 3 + 3), i * 3); }
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
      sideN: [], last: p.clone(), lazy: p.clone(), stab: p.clone(), carry: 0, dabs: 0, ms: 0, topo: false, before: opt.dyn ? st.snapshot() : null, nt0: st.nt,
      pressure: pressureOf(e) };
    if (stroke.id >= 4e9) st.mark.fill(0);
    if (stroke.brush === 'move') moveStart(h); else dabAt(h);
    return true;
  }
  function feed(p) {
    if (!stroke) return;
    if (stroke.brush === 'move') { moveUpdate(p); return; }
    let target = p;
    if (opt.stabilize > 0) { stroke.stab.lerp(p, 1 - opt.stabilize); target = p = stroke.stab.clone(); }
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
  function pressureOf(e) { const p = e && e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : (e && typeof e.pressure === 'number' && e.pointerType === 'pen' ? 0.5 : 1); return THREE.MathUtils.clamp(p, 0.05, 1); }
  function endStroke() {
    const S = stroke; if (!S) return; stroke = null; lazyDot.hidden = true;
    const mesh = st.mesh, label = BRUSHES.find((b) => b.id === S.brush).name + ' stroke';
    if (S.mask && S.mask.size && !S.topo) {
      const ids = Int32Array.from(S.mask.keys()), before = Float32Array.from(S.mask.values()), after = Float32Array.from(ids, (v) => st.M[v]);
      pushHistory({ label: 'Mask stroke', undo: () => applyMask(mesh, ids, before), redo: () => applyMask(mesh, ids, after) });
    } else if (S.topo) {
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
    if (s) { s.load(snap.P, snap.T, snap); setMeshGeometry(mesh, s.geo); syncMaskMesh(); updateTris(); return; }
    const g = compactArrays(snap, null, mesh); if (mesh.userData.mfSculpt) mesh.userData.mfSculpt.snap = snap; setMeshGeometry(mesh, g); if (mesh.userData.mfSculpt) mesh.userData.mfSculpt.geo = g; ctx.onTris?.(snap.T.length / 3, false, false);
  }
  function applyMask(mesh, ids, vals) { const s = sculptOf(mesh); if (!s) { const sn = mesh.userData.mfSculpt?.snap; if (sn) for (let i = 0; i < ids.length; i++) sn.M[ids[i]] = vals[i]; return; }
    for (let i = 0; i < ids.length; i++) { s.M[ids[i]] = vals[i]; s.touchV(ids[i]); } }
  function maskOp(op) {
    if (!st || !active) return false; const n = st.nv, M = st.M, before = M.slice(0, n), mesh = st.mesh, T = st.T;
    if (op === 'invert') for (let i = 0; i < n; i++) M[i] = 1 - M[i];
    else if (op === 'clear') M.fill(0, 0, n);
    else if (op === 'fill') M.fill(1, 0, n);
    else if (op === 'blur' || op === 'sharpen') {
      const avg = new Float32Array(n);
      for (let v = 0; v < n; v++) { let s2 = 0, c = 0; for (const t of st.vt[v]) for (let j = 0; j < 3; j++) { const u = T[t * 3 + j]; if (u !== v) { s2 += M[u]; c++; } } avg[v] = c ? s2 / c : M[v]; }
      for (let v = 0; v < n; v++) M[v] = op === 'blur' ? (M[v] + avg[v] * 2) / 3 : THREE.MathUtils.clamp(M[v] + (M[v] - avg[v]) * 1.5 + (M[v] - 0.5) * 0.25, 0, 1);
    } else return false;
    const after = M.slice(0, n), ids = Int32Array.from({ length: n }, (_, i) => i); st.touchV(0); st.touchV(n - 1);
    pushHistory({ label: 'Mask ' + op, undo: () => applyMask(mesh, ids, before), redo: () => applyMask(mesh, ids, after) });
    status(`Mask ${op} · ${maskStats().masked.toLocaleString()} masked vertices`); return true;
  }
  function maskStats() { let m = 0; if (st) for (let i = 0; i < st.nv; i++) if (st.M[i] > 0.5) m++; return { masked: m, verts: st ? st.nv : 0, hidden: st ? st.nHidden : 0 }; }
  function hideMasked(on) {
    if (!st || !active) return 0; let h = 0;
    for (let t = 0; t < st.nt; t++) { const T = st.T; const v = on && st.M[T[t * 3]] > 0.5 && st.M[T[t * 3 + 1]] > 0.5 && st.M[T[t * 3 + 2]] > 0.5 ? 1 : 0; st.HT[t] = v; h += v; }
    st.nHidden = h; st.realloc = true; st.flush(); setMeshGeometry(st.mesh, st.geo); syncMaskMesh();
    status(on ? `${h.toLocaleString()} masked triangles hidden (Show all to bring them back)` : 'All triangles shown'); return h;
  }
  function remesh(kind) {
    if (!st || !active) return 0; const before = st.snapshot(), mesh = st.mesh; let n = 0; const es = st.edgeStats();
    if (kind === 'subdivide') { const out = { ids: new Int32Array(4096), t: new Float32Array(4096), n: 0 }; const c = st.box.getCenter(new THREE.Vector3());
      if (st.nt * 4 > opt.hardCap) { status(`Subdivide would pass the ${opt.hardCap.toLocaleString()} triangle cap`); return 0; }
      const r = st.refine(c.x, c.y, c.z, st.diag * 2, es.avg * 0.6, opt.hardCap, out, 1); n = r.splits; }
    else n = st.coarsen(0, 0, 0, Infinity, es.avg * 1.25, Math.ceil(st.nt / 4));
    if (!n) { status(kind === 'subdivide' ? 'Nothing to subdivide' : 'Nothing could be reduced (edges protected by seams, borders or the link rule)'); return 0; }
    st.allNormals(); st.buildGrid(); st.realloc = true; st.flush(); setMeshGeometry(mesh, st.geo); syncMaskMesh();
    const after = st.snapshot(); pushHistory({ label: kind === 'subdivide' ? 'Subdivide' : 'Reduce', topo: true, undo: () => applySnapshot(mesh, before), redo: () => applySnapshot(mesh, after) });
    updateTris(); ctx.updateInfo?.(); status(`${kind === 'subdivide' ? 'Subdivided' : 'Reduced'}: ${st.nt.toLocaleString()} triangles`); return n;
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
    if (stroke) { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []; if (evs.length) for (const ce of evs) { stroke.pressure = pressureOf(ce); feed(local(ce)); } else { stroke.pressure = pressureOf(e); feed(p); } }
    else hover = p;
  });
  addEventListener('pointerup', (e) => { if (stroke && e.button === 0) endStroke(); });
  canvas.addEventListener('pointerleave', () => { if (!stroke) hover = null; });

  function handleKey(e) {
    if (!active) return false; const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'i') { maskOp('invert'); return true; }
    if (e.ctrlKey || e.metaKey) return false;
    if (e.shiftKey && ['!', '@', '"', '#', '1', '2', '3', '£'].includes(e.key)) { setBrush({ '!': 'flatten', 1: 'flatten', '@': 'crease', '"': 'crease', 2: 'crease', '#': 'scrape', '£': 'scrape', 3: 'scrape' }[e.key]); return true; }
    if (k === 'm' && e.altKey) { maskOp('clear'); return true; }
    if (k === 'm') { setBrush('mask'); return true; }
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
    const g0 = st.geo; st.flush(); if (st.geo !== g0 || st.mesh.geometry !== st.geo) { setMeshGeometry(st.mesh, st.geo); } if (maskMesh && maskMesh.geometry !== st.geo) maskMesh.geometry = st.geo;
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

  const debug = { get st() { return st; }, opt, maskOp, maskStats, hideMasked, remesh, get stroke() { return stroke; }, get lastStats() { return lastStats; }, beginStroke, feed, endStroke, pick, dabAt, setBrush, setDyn, syncUI, smoothAll,
    stroke2(points, mods = {}) { // synthetic stroke in screen pixels, used by the tests
      if (!beginStroke(new THREE.Vector2(...points[0]), { shiftKey: !!mods.shift, altKey: !!mods.alt })) return false;
      for (const q of points.slice(1)) feed(new THREE.Vector2(...q)); endStroke(); return lastStats; } };
  return { enter, exit, tick, handleKey, info, geometryFor, setDyn, setBrush, syncUI, opt, debug, maskOp, maskStats, hideMasked, remesh, get active() { return active; } };
}
