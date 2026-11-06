// MeshForge v7 UV toolkit (original MIT code).
// Workflow-compatible with the usual DCC unwrap tools, not code-identical: every algorithm below is our own
// implementation of a published method (least-squares conformal maps, as-rigid-as-possible refinement,
// normal clustering, shelf packing). Works on per-corner UVs; writeUVs() re-indexes the geometry so each
// vertex is unique by (position, UV, normal, colour) and keeps triangle order (so material slots survive).
import * as THREE from 'three';
import { getSlots, setSlots, copyData, getSeams, pkey } from './mfdata.js';

// ---------------------------------------------------------------- topology
export function topo(geo) {
  const pos = geo.attributes.position, idx = geo.index, n = idx ? idx.count : pos.count;
  const nt = Math.floor(Math.min(n, Number.isFinite(geo.drawRange?.count) ? geo.drawRange.count : n) / 3);
  const map = new Map(), P = [], keys = [], T = new Uint32Array(nt * 3), CO = new Uint32Array(nt * 3);
  const vid = new Int32Array(pos.count).fill(-1);
  for (let i = 0; i < nt * 3; i++) {
    const o = idx ? idx.getX(i) : i; CO[i] = o;
    if (vid[o] < 0) { const x = pos.getX(o), y = pos.getY(o), z = pos.getZ(o), k = pkey(x, y, z); let w = map.get(k); if (w === undefined) { w = keys.length; map.set(k, w); keys.push(k); P.push(x, y, z); } vid[o] = w; }
    T[i] = vid[o];
  }
  const uvA = geo.attributes.uv, UV = new Float32Array(nt * 6);
  if (uvA) for (let i = 0; i < nt * 3; i++) { UV[i * 2] = uvA.getX(CO[i]); UV[i * 2 + 1] = uvA.getY(CO[i]); }
  const E = new Map(); // edge -> list of [tri, k] (k = corner index of the edge start)
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3], key = a < b ? a * 4294967296 + b : b * 4294967296 + a; let l = E.get(key); if (!l) E.set(key, (l = [])); l.push(t, k); }
  return { P: new Float32Array(P), T, CO, UV, hasUV: !!uvA, nt, nv: keys.length, keys, E, geo };
}
const ekeyP = (ka, kb) => (ka < kb ? ka + '|' + kb : kb + '|' + ka);
export function isSeam(M, a, b) { const s = getSeams(M.geo, false); return !!s && s.has(ekeyP(M.keys[a], M.keys[b])); }
export function triNormals(M) {
  const { P, T, nt } = M, N = new Float32Array(nt * 3), A = new Float32Array(nt);
  for (let t = 0; t < nt; t++) { const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z); A[t] = l / 2; if (l > 0) { x /= l; y /= l; z /= l; } N[t * 3] = x; N[t * 3 + 1] = y; N[t * 3 + 2] = z; }
  return { N, A };
}
// union-find over corners: corners sharing a vertex across an uncut, manifold edge are one UV vertex
function UF(n) { const p = new Int32Array(n); for (let i = 0; i < n; i++) p[i] = i; const f = (x) => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }; return { f, u: (a, b) => { a = f(a); b = f(b); if (a !== b) p[a] = b; } }; }
// cut(a, b, t1, t2) -> true when the edge separates islands
export function islands(M, cut) {
  const { T, nt, E } = M, cu = UF(nt * 3), tu = UF(nt);
  for (const l of E.values()) {
    if (l.length !== 4) continue; const t1 = l[0], k1 = l[1], t2 = l[2], k2 = l[3];
    const a = T[t1 * 3 + k1], b = T[t1 * 3 + (k1 + 1) % 3];
    if (cut(a, b, t1, t2)) continue;
    const ca1 = t1 * 3 + k1, cb1 = t1 * 3 + (k1 + 1) % 3; let ca2 = -1, cb2 = -1;
    for (let k = 0; k < 3; k++) { if (T[t2 * 3 + k] === a) ca2 = t2 * 3 + k; if (T[t2 * 3 + k] === b) cb2 = t2 * 3 + k; }
    if (ca2 < 0 || cb2 < 0) continue; cu.u(ca1, ca2); cu.u(cb1, cb2); tu.u(t1, t2);
  }
  const chartOf = new Int32Array(nt), roots = new Map(); const charts = [];
  for (let t = 0; t < nt; t++) { const r = tu.f(t); let c = roots.get(r); if (c === undefined) { c = charts.length; roots.set(r, c); charts.push({ tris: [] }); } chartOf[t] = c; charts[c].tris.push(t); }
  const cv = new Int32Array(nt * 3); for (let i = 0; i < nt * 3; i++) cv[i] = cu.f(i);
  for (const ch of charts) { const m = new Map(); for (const t of ch.tris) for (let k = 0; k < 3; k++) { const r = cv[t * 3 + k]; if (!m.has(r)) m.set(r, m.size); } ch.vmap = m; ch.n = m.size; }
  return { charts, chartOf, cv };
}
// islands from the current UVs (corners that share a vertex and the same UV are connected)
export function uvIslands(M) {
  const UV = M.UV, eq = (c1, c2) => Math.abs(UV[c1 * 2] - UV[c2 * 2]) + Math.abs(UV[c1 * 2 + 1] - UV[c2 * 2 + 1]) < 1e-6;
  return islands(M, (a, b, t1, t2) => { const T = M.T; let a1, b1, a2, b2; for (let k = 0; k < 3; k++) { if (T[t1 * 3 + k] === a) a1 = t1 * 3 + k; if (T[t1 * 3 + k] === b) b1 = t1 * 3 + k; if (T[t2 * 3 + k] === a) a2 = t2 * 3 + k; if (T[t2 * 3 + k] === b) b2 = t2 * 3 + k; } return !(eq(a1, a2) && eq(b1, b2)); });
}

// ---------------------------------------------------------------- solvers
// local 2D frame per triangle (x0=(0,0), x1=(l,0), x2=(px,py))
function localTri(P, a, b, c) {
  const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  const l = Math.hypot(...e1) || 1e-12, ux = e1.map((x) => x / l), px = e2[0] * ux[0] + e2[1] * ux[1] + e2[2] * ux[2];
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], py = Math.hypot(...cr) / l;
  return [0, 0, l, 0, px, py];
}
// preconditioned conjugate gradient for a symmetric positive (semi-)definite operator
function pcg(apply, b, x, diag, iters, tol = 1e-10) {
  const n = b.length, r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  apply(x, Ap); for (let i = 0; i < n; i++) r[i] = b[i] - Ap[i];
  let bn = 0; for (let i = 0; i < n; i++) bn += b[i] * b[i]; bn = Math.sqrt(bn) || 1;
  for (let i = 0; i < n; i++) { z[i] = r[i] / (diag[i] || 1); p[i] = z[i]; }
  let rz = 0; for (let i = 0; i < n; i++) rz += r[i] * z[i];
  let it = 0;
  for (; it < iters; it++) {
    apply(p, Ap); let pAp = 0; for (let i = 0; i < n; i++) pAp += p[i] * Ap[i]; if (Math.abs(pAp) < 1e-30) break;
    const al = rz / pAp; let rn = 0; for (let i = 0; i < n; i++) { x[i] += al * p[i]; r[i] -= al * Ap[i]; rn += r[i] * r[i]; }
    if (Math.sqrt(rn) / bn < tol) break;
    for (let i = 0; i < n; i++) z[i] = r[i] / (diag[i] || 1);
    let rz2 = 0; for (let i = 0; i < n; i++) rz2 += r[i] * z[i]; const be = rz2 / rz; rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + be * p[i];
  }
  return it;
}
// Least-squares conformal map of one chart (Lévy et al. 2002 formulation), two pinned vertices
function lscm(M, ch, cv) {
  const { P, T } = M, n = ch.n, tris = ch.tris, vm = ch.vmap;
  const loc = (t, k) => vm.get(cv[t * 3 + k]);
  // pins: two vertices far apart along the chart's longest bbox axis
  const pv = new Int32Array(n); const bb = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; pv[loc(t, k)] = v; for (let j = 0; j < 3; j++) { bb[j * 2] = Math.min(bb[j * 2], P[v * 3 + j]); bb[j * 2 + 1] = Math.max(bb[j * 2 + 1], P[v * 3 + j]); } }
  const ax = [bb[1] - bb[0], bb[3] - bb[2], bb[5] - bb[4]], j = ax.indexOf(Math.max(...ax));
  let i0 = 0, i1 = 0; for (let i = 0; i < n; i++) { if (P[pv[i] * 3 + j] < P[pv[i0] * 3 + j]) i0 = i; if (P[pv[i] * 3 + j] > P[pv[i1] * 3 + j]) i1 = i; }
  if (i0 === i1) i1 = (i0 + 1) % n;
  const d = Math.hypot(P[pv[i1] * 3] - P[pv[i0] * 3], P[pv[i1] * 3 + 1] - P[pv[i0] * 3 + 1], P[pv[i1] * 3 + 2] - P[pv[i0] * 3 + 2]) || 1;
  const pin = new Map([[i0, [0, 0]], [i1, [d, 0]]]);
  // free variable index: u_i -> 2*f, v_i -> 2*f+1
  const fi = new Int32Array(n).fill(-1); let nf = 0; for (let i = 0; i < n; i++) if (!pin.has(i)) fi[i] = nf++;
  const rows = []; // per tri: [c0,c1,c2, Wr0,Wi0,Wr1,Wi1,Wr2,Wi2]
  for (const t of tris) {
    const [x0, y0, x1, y1, x2, y2] = localTri(P, T[t * 3], T[t * 3 + 1], T[t * 3 + 2]); const A = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)); if (A < 1e-20) continue;
    const s = 1 / Math.sqrt(A);
    rows.push(loc(t, 0), loc(t, 1), loc(t, 2), (x2 - x1) * s, (y2 - y1) * s, (x0 - x2) * s, (y0 - y2) * s, (x1 - x0) * s, (y1 - y0) * s);
  }
  const nr = rows.length / 9, N = nf * 2, b = new Float64Array(N), diag = new Float64Array(N), x = new Float64Array(N);
  // residual pieces: Re = Σ Wr u - Wi v ; Im = Σ Wr v + Wi u
  const rhs = new Float64Array(nr * 2);
  for (let r = 0; r < nr; r++) { let re = 0, im = 0; for (let k = 0; k < 3; k++) { const vi = rows[r * 9 + k], wr = rows[r * 9 + 3 + k * 2], wi = rows[r * 9 + 4 + k * 2];
      const pp = pin.get(vi); if (pp) { re -= wr * pp[0] - wi * pp[1]; im -= wr * pp[1] + wi * pp[0]; } else { const f = fi[vi]; diag[f * 2] += wr * wr + wi * wi; diag[f * 2 + 1] += wr * wr + wi * wi; } }
    rhs[r * 2] = re; rhs[r * 2 + 1] = im; }
  // b = A^T rhs
  const AT = (y, out) => { out.fill(0); for (let r = 0; r < nr; r++) { const re = y[r * 2], im = y[r * 2 + 1]; for (let k = 0; k < 3; k++) { const f = fi[rows[r * 9 + k]]; if (f < 0) continue; const wr = rows[r * 9 + 3 + k * 2], wi = rows[r * 9 + 4 + k * 2];
    out[f * 2] += wr * re + wi * im; out[f * 2 + 1] += -wi * re + wr * im; } } };
  const Ax = (xx, out) => { for (let r = 0; r < nr; r++) { let re = 0, im = 0; for (let k = 0; k < 3; k++) { const f = fi[rows[r * 9 + k]]; if (f < 0) continue; const wr = rows[r * 9 + 3 + k * 2], wi = rows[r * 9 + 4 + k * 2], u = xx[f * 2], v = xx[f * 2 + 1]; re += wr * u - wi * v; im += wr * v + wi * u; } out[r * 2] = re; out[r * 2 + 1] = im; } };
  AT(rhs, b);
  // initial guess: planar projection on the chart's average normal, aligned with the pins
  const { N: TN } = triNormals({ P, T, nt: M.nt }); let nx = 0, ny = 0, nz = 0; for (const t of tris) { nx += TN[t * 3]; ny += TN[t * 3 + 1]; nz += TN[t * 3 + 2]; }
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  let ex = P[pv[i1] * 3] - P[pv[i0] * 3], ey = P[pv[i1] * 3 + 1] - P[pv[i0] * 3 + 1], ez = P[pv[i1] * 3 + 2] - P[pv[i0] * 3 + 2]; const dn = ex * nx + ey * ny + ez * nz; ex -= dn * nx; ey -= dn * ny; ez -= dn * nz;
  let el = Math.hypot(ex, ey, ez); if (el < 1e-12) { ex = 1; ey = 0; ez = 0; el = 1; } ex /= el; ey /= el; ez /= el;
  const fx = ny * ez - nz * ey, fy = nz * ex - nx * ez, fz = nx * ey - ny * ex;
  for (let i = 0; i < n; i++) { const f = fi[i]; if (f < 0) continue; const v = pv[i], dx = P[v * 3] - P[pv[i0] * 3], dy = P[v * 3 + 1] - P[pv[i0] * 3 + 1], dz = P[v * 3 + 2] - P[pv[i0] * 3 + 2]; x[f * 2] = dx * ex + dy * ey + dz * ez; x[f * 2 + 1] = dx * fx + dy * fy + dz * fz; }
  const tmpR = new Float64Array(nr * 2); const apply = (xx, out) => { Ax(xx, tmpR); AT(tmpR, out); };
  const it = pcg(apply, b, x, diag, Math.min(4000, 200 + N * 2), 1e-9);
  const U = new Float64Array(n * 2); for (let i = 0; i < n; i++) { const pp = pin.get(i); if (pp) { U[i * 2] = pp[0]; U[i * 2 + 1] = pp[1]; } else { U[i * 2] = x[fi[i] * 2]; U[i * 2 + 1] = x[fi[i] * 2 + 1]; } }
  return { U, iters: it };
}
// As-rigid-as-possible refinement (local/global, cotangent weights); reduces area and angle stretch
function arap(M, ch, cv, U, iters = 8) {
  const { P, T } = M, n = ch.n, vm = ch.vmap, tris = ch.tris, loc = (t, k) => vm.get(cv[t * 3 + k]);
  const L = tris.map((t) => localTri(P, T[t * 3], T[t * 3 + 1], T[t * 3 + 2]));
  const cot = tris.map((t, i) => { const x = L[i], out = []; for (let k = 0; k < 3; k++) { const ax = x[k * 2], ay = x[k * 2 + 1], bx = x[((k + 1) % 3) * 2] - ax, by = x[((k + 1) % 3) * 2 + 1] - ay, cx = x[((k + 2) % 3) * 2] - ax, cy = x[((k + 2) % 3) * 2 + 1] - ay;
    const cr = Math.abs(bx * cy - by * cx); out.push(THREE.MathUtils.clamp((bx * cx + by * cy) / (cr || 1e-12), 0.01, 50)); } return out; }); // cot of angle at corner k (opposite edge k+1,k+2)
  const diag = new Float64Array(n); tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const w = cot[i][k] / 2, a = loc(t, (k + 1) % 3), b = loc(t, (k + 2) % 3); diag[a] += w; diag[b] += w; } });
  const pin = 0; diag[pin] += 1e6;
  const apply = (x, out) => { out.fill(0); tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const w = cot[i][k] / 2, a = loc(t, (k + 1) % 3), b = loc(t, (k + 2) % 3), d = x[a] - x[b]; out[a] += w * d; out[b] -= w * d; } }); out[pin] += 1e6 * x[pin]; };
  const xu = new Float64Array(n), xv = new Float64Array(n); for (let i = 0; i < n; i++) { xu[i] = U[i * 2]; xv[i] = U[i * 2 + 1]; }
  const p0 = [xu[pin], xv[pin]];
  for (let it = 0; it < iters; it++) {
    const bu = new Float64Array(n), bv = new Float64Array(n);
    tris.forEach((t, i) => {
      const x = L[i], a = loc(t, 0), b = loc(t, 1), c = loc(t, 2);
      // Jacobian of local->uv: J = [du1 du2; dv1 dv2] * inv([dx1 dx2; dy1 dy2])
      const dx1 = x[2] - x[0], dy1 = x[3] - x[1], dx2 = x[4] - x[0], dy2 = x[5] - x[1], det = dx1 * dy2 - dx2 * dy1; if (Math.abs(det) < 1e-20) return;
      const du1 = xu[b] - xu[a], du2 = xu[c] - xu[a], dv1 = xv[b] - xv[a], dv2 = xv[c] - xv[a];
      const j00 = (du1 * dy2 - du2 * dy1) / det, j01 = (du2 * dx1 - du1 * dx2) / det, j10 = (dv1 * dy2 - dv2 * dy1) / det, j11 = (dv2 * dx1 - dv1 * dx2) / det;
      let ang = Math.atan2(j10 - j01, j00 + j11); if (j00 * j11 - j01 * j10 < 0) ang = Math.atan2(j10 + j01, j00 - j11); // keep orientation where possible
      const cs = Math.cos(ang), sn = Math.sin(ang);
      for (let k = 0; k < 3; k++) { const w = cot[i][k] / 2, ia = (k + 1) % 3, ib = (k + 2) % 3, A2 = loc(t, ia), B2 = loc(t, ib);
        const ex = x[ia * 2] - x[ib * 2], ey = x[ia * 2 + 1] - x[ib * 2 + 1], rx = cs * ex - sn * ey, ry = sn * ex + cs * ey;
        bu[A2] += w * rx; bu[B2] -= w * rx; bv[A2] += w * ry; bv[B2] -= w * ry; }
    });
    bu[pin] += 1e6 * p0[0]; bv[pin] += 1e6 * p0[1];
    pcg(apply, bu, xu, diag, 120, 1e-8); pcg(apply, bv, xv, diag, 120, 1e-8);
  }
  for (let i = 0; i < n; i++) { U[i * 2] = xu[i]; U[i * 2 + 1] = xv[i]; }
  return U;
}
function chartArea(M, ch, cv, U) { let a = 0; const vm = ch.vmap; for (const t of ch.tris) { const i = vm.get(cv[t * 3]) * 2, j = vm.get(cv[t * 3 + 1]) * 2, k = vm.get(cv[t * 3 + 2]) * 2; a += ((U[j] - U[i]) * (U[k + 1] - U[i + 1]) - (U[k] - U[i]) * (U[j + 1] - U[i + 1])) / 2; } return a; }
function writeChart(M, ch, cv, U, out) {
  if (chartArea(M, ch, cv, U) < 0) for (let i = 0; i < ch.n; i++) U[i * 2] = -U[i * 2]; // keep front-facing
  const vm = ch.vmap; for (const t of ch.tris) for (let k = 0; k < 3; k++) { const i = vm.get(cv[t * 3 + k]); out[(t * 3 + k) * 2] = U[i * 2]; out[(t * 3 + k) * 2 + 1] = U[i * 2 + 1]; }
}

// ---------------------------------------------------------------- operations (all return per-corner UVs)
export function unwrap(M, { method = 'angle', margin = 0.02, fillHoles = true } = {}) {
  void fillHoles;
  const I = islands(M, (a, b) => isSeam(M, a, b)), out = new Float32Array(M.nt * 6); let iters = 0;
  for (const ch of I.charts) {
    if (ch.n < 3) continue;
    let { U, iters: it } = lscm(M, ch, I.cv); iters += it;
    if (method === 'angle') U = arap(M, ch, I.cv, U, 6);
    writeChart(M, ch, I.cv, U, out);
  }
  const r = pack(M, out, { margin, rotate: true }); r.iters = iters; r.charts = I.charts.length; return r;
}
export function minimizeStretch(M, { iterations = 10, selected = null } = {}) {
  const I = uvIslands(M), out = M.UV.slice();
  for (const ch of I.charts) {
    if (selected && !ch.tris.some((t) => selected[t])) continue;
    const U = new Float64Array(ch.n * 2); for (const t of ch.tris) for (let k = 0; k < 3; k++) { const i = ch.vmap.get(I.cv[t * 3 + k]); U[i * 2] = M.UV[(t * 3 + k) * 2]; U[i * 2 + 1] = M.UV[(t * 3 + k) * 2 + 1]; }
    const a0 = Math.abs(chartArea(M, ch, I.cv, U)), c0 = centroid(U, ch.n);
    arap(M, ch, I.cv, U, iterations);
    const a1 = Math.abs(chartArea(M, ch, I.cv, U)) || 1, s = Math.sqrt(a0 / a1), c1 = centroid(U, ch.n); // keep the island's size and place
    for (let i = 0; i < ch.n; i++) { U[i * 2] = c0[0] + (U[i * 2] - c1[0]) * s; U[i * 2 + 1] = c0[1] + (U[i * 2 + 1] - c1[1]) * s; }
    const vm = ch.vmap; for (const t of ch.tris) for (let k = 0; k < 3; k++) { const i = vm.get(I.cv[t * 3 + k]); out[(t * 3 + k) * 2] = U[i * 2]; out[(t * 3 + k) * 2 + 1] = U[i * 2 + 1]; }
  }
  return { uv: out, charts: I.charts.length };
}
const centroid = (U, n) => { let x = 0, y = 0; for (let i = 0; i < n; i++) { x += U[i * 2]; y += U[i * 2 + 1]; } return [x / n, y / n]; };
function planarCharts(M, groupOf, basisOf) { // charts = connected tris with the same group, projected on that group's plane
  const I = islands(M, (a, b, t1, t2) => groupOf[t1] !== groupOf[t2] || isSeam(M, a, b)), out = new Float32Array(M.nt * 6), P = M.P, T = M.T;
  for (const ch of I.charts) { const [e, f] = basisOf(ch); for (const t of ch.tris) for (let k = 0; k < 3; k++) { const v = T[t * 3 + k] * 3; out[(t * 3 + k) * 2] = P[v] * e[0] + P[v + 1] * e[1] + P[v + 2] * e[2]; out[(t * 3 + k) * 2 + 1] = P[v] * f[0] + P[v + 1] * f[1] + P[v + 2] * f[2]; } }
  return out;
}
const basis = (n) => { const up = Math.abs(n[1]) < 0.95 ? [0, 1, 0] : [0, 0, -1]; let e = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]]; const l = Math.hypot(...e) || 1; e = e.map((x) => x / l); const f = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]]; return [e, f]; };
export function smartProject(M, { angle = 66, margin = 0.02, areaWeight = 0 } = {}) {
  const { N, A } = triNormals(M), nt = M.nt, grp = new Int32Array(nt).fill(-1), cos = Math.cos(THREE.MathUtils.degToRad(angle));
  const order = Array.from({ length: nt }, (_, i) => i), maxA = Math.max(...A, 1e-12);
  // priority: area weight 0 = pure normal flatness order, 1 = biggest faces seed first
  const flat = new Float32Array(nt); for (const l of M.E.values()) for (let i = 0; i + 3 < l.length; i += 2) { const t1 = l[i], t2 = l[i + 2]; const d = N[t1 * 3] * N[t2 * 3] + N[t1 * 3 + 1] * N[t2 * 3 + 1] + N[t1 * 3 + 2] * N[t2 * 3 + 2]; flat[t1] += d; flat[t2] += d; }
  order.sort((i, j) => (flat[j] / 3 * (1 - areaWeight) + A[j] / maxA * areaWeight) - (flat[i] / 3 * (1 - areaWeight) + A[i] / maxA * areaWeight));
  const nb = (t) => { const r = []; for (let k = 0; k < 3; k++) { const a = M.T[t * 3 + k], b = M.T[t * 3 + (k + 1) % 3], l = M.E.get(a < b ? a * 4294967296 + b : b * 4294967296 + a); if (l && l.length === 4) r.push(l[0] === t ? l[2] : l[0]); } return r; };
  const cn = []; let g = 0;
  for (const s of order) { if (grp[s] >= 0) continue; let nx = N[s * 3] * A[s], ny = N[s * 3 + 1] * A[s], nz = N[s * 3 + 2] * A[s]; const q = [s]; grp[s] = g; const sn = [N[s * 3], N[s * 3 + 1], N[s * 3 + 2]];
    while (q.length) { const t = q.pop(); for (const u of nb(t)) { if (grp[u] >= 0) continue; const d1 = N[u * 3] * sn[0] + N[u * 3 + 1] * sn[1] + N[u * 3 + 2] * sn[2], l = Math.hypot(nx, ny, nz) || 1, d2 = (N[u * 3] * nx + N[u * 3 + 1] * ny + N[u * 3 + 2] * nz) / l;
      if (Math.min(d1, d2) >= cos) { grp[u] = g; nx += N[u * 3] * A[u]; ny += N[u * 3 + 1] * A[u]; nz += N[u * 3 + 2] * A[u]; q.push(u); } } }
    const l = Math.hypot(nx, ny, nz) || 1; cn.push([nx / l, ny / l, nz / l]); g++; }
  const out = planarCharts(M, grp, (ch) => basis(cn[grp[ch.tris[0]]]));
  const r = pack(M, out, { margin, rotate: true }); r.groups = g; return r;
}
export function cubeProject(M, { size = 1, margin = 0.02, packIt = false } = {}) {
  const { N } = triNormals(M), grp = new Int32Array(M.nt);
  for (let t = 0; t < M.nt; t++) { const a = [Math.abs(N[t * 3]), Math.abs(N[t * 3 + 1]), Math.abs(N[t * 3 + 2])], j = a.indexOf(Math.max(...a)); grp[t] = j * 2 + (N[t * 3 + j] < 0 ? 1 : 0); }
  const B = [[[0, 0, -1], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]], [[1, 0, 0], [0, 0, -1]], [[1, 0, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]]];
  const out = planarCharts(M, grp, (ch) => B[grp[ch.tris[0]]]); for (let i = 0; i < out.length; i++) out[i] = out[i] / size + 0.5;
  return packIt ? pack(M, out, { margin, rotate: false }) : { uv: out };
}
function bounds(M) { const P = M.P; const b = new THREE.Box3(); for (let i = 0; i < M.nv; i++) b.expandByPoint(new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); return b; }
function fixWrap(out, nt) { for (let t = 0; t < nt; t++) { const u = [out[t * 6], out[t * 6 + 2], out[t * 6 + 4]]; const mx = Math.max(...u), mn = Math.min(...u); if (mx - mn > 0.5) for (let k = 0; k < 3; k++) if (u[k] < 0.5) out[t * 6 + k * 2] += 1; } }
export function cylinderProject(M, { axis = 1 } = {}) {
  const b = bounds(M), c = b.getCenter(new THREE.Vector3()).toArray(), s = b.getSize(new THREE.Vector3()).toArray(), out = new Float32Array(M.nt * 6), P = M.P, T = M.T;
  const i1 = (axis + 1) % 3, i2 = (axis + 2) % 3;
  for (let i = 0; i < M.nt * 3; i++) { const v = T[i] * 3, x = P[v + i2] - c[i2], z = P[v + i1] - c[i1]; out[i * 2] = 0.5 + Math.atan2(x, z) / (2 * Math.PI); out[i * 2 + 1] = (P[v + axis] - b.min.getComponent(axis)) / (s[axis] || 1); }
  fixWrap(out, M.nt); return { uv: out };
}
export function sphereProject(M) {
  const b = bounds(M), c = b.getCenter(new THREE.Vector3()), out = new Float32Array(M.nt * 6), P = M.P, T = M.T;
  for (let i = 0; i < M.nt * 3; i++) { const v = T[i] * 3, x = P[v] - c.x, y = P[v + 1] - c.y, z = P[v + 2] - c.z, r = Math.hypot(x, y, z) || 1; out[i * 2] = 0.5 + Math.atan2(x, z) / (2 * Math.PI); out[i * 2 + 1] = 1 - Math.acos(THREE.MathUtils.clamp(y / r, -1, 1)) / Math.PI; }
  fixWrap(out, M.nt); return { uv: out };
}
export function viewProject(M, mvp, { fit = true } = {}) { // mvp: Matrix4 (projection * view * model)
  const out = new Float32Array(M.nt * 6), v = new THREE.Vector3(), P = M.P, T = M.T;
  for (let i = 0; i < M.nt * 3; i++) { v.set(P[T[i] * 3], P[T[i] * 3 + 1], P[T[i] * 3 + 2]).applyMatrix4(mvp); out[i * 2] = v.x * 0.5 + 0.5; out[i * 2 + 1] = v.y * 0.5 + 0.5; }
  if (fit) normalize(out, 0); return { uv: out };
}
export function resetUV(M) { const out = new Float32Array(M.nt * 6); for (let t = 0; t < M.nt; t++) out.set([0, 0, 1, 0, 1, 1], t * 6); return { uv: out }; }
function normalize(uv, margin) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < uv.length; i += 2) { x0 = Math.min(x0, uv[i]); x1 = Math.max(x1, uv[i]); y0 = Math.min(y0, uv[i + 1]); y1 = Math.max(y1, uv[i + 1]); }
  const s = (1 - 2 * margin) / (Math.max(x1 - x0, y1 - y0) || 1); for (let i = 0; i < uv.length; i += 2) { uv[i] = margin + (uv[i] - x0) * s; uv[i + 1] = margin + (uv[i + 1] - y0) * s; } }

// ---------------------------------------------------------------- packing
// shelf packing of the islands found in `uv`; optional 90°-step + best-fit rotation; scale = equal texel density when average
export function pack(M, uv, { margin = 0.02, rotate = true, average = true, selected = null } = {}) {
  const save = M.UV; M.UV = uv; const I = uvIslands(M); M.UV = save;
  const { A } = triNormals(M); const isl = [];
  for (const ch of I.charts) {
    if (selected && !ch.tris.some((t) => selected[t])) continue;
    const cs = new Set(); for (const t of ch.tris) for (let k = 0; k < 3; k++) cs.add(t * 3 + k); const cn = [...cs];
    let a3 = 0, a2 = 0; for (const t of ch.tris) { a3 += A[t]; const o = t * 6; a2 += Math.abs((uv[o + 2] - uv[o]) * (uv[o + 5] - uv[o + 1]) - (uv[o + 4] - uv[o]) * (uv[o + 3] - uv[o + 1])) / 2; }
    if (average && a2 > 1e-20) { const s = Math.sqrt(a3 / a2); for (const c of cn) { uv[c * 2] *= s; uv[c * 2 + 1] *= s; } }
    if (rotate) { // best bounding box over 0..90° (5° steps), then make it wider than tall
      let best = 0, bestA = Infinity; for (let d = 0; d < 90; d += 5) { const r = d * Math.PI / 180, cs2 = Math.cos(r), sn = Math.sin(r); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const c of cn) { const x = uv[c * 2] * cs2 - uv[c * 2 + 1] * sn, y = uv[c * 2] * sn + uv[c * 2 + 1] * cs2; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const ar = (x1 - x0) * (y1 - y0); if (ar < bestA - 1e-12) { bestA = ar; best = r; } }
      const cs2 = Math.cos(best), sn = Math.sin(best); for (const c of cn) { const x = uv[c * 2], y = uv[c * 2 + 1]; uv[c * 2] = x * cs2 - y * sn; uv[c * 2 + 1] = x * sn + y * cs2; }
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const c of cn) { x0 = Math.min(x0, uv[c * 2]); x1 = Math.max(x1, uv[c * 2]); y0 = Math.min(y0, uv[c * 2 + 1]); y1 = Math.max(y1, uv[c * 2 + 1]); }
    if (rotate && y1 - y0 > x1 - x0) { for (const c of cn) { const x = uv[c * 2], y = uv[c * 2 + 1]; uv[c * 2] = -y; uv[c * 2 + 1] = x; } [x0, x1, y0, y1] = [-y1, -y0, x0, x1]; }
    isl.push({ cn, x0, y0, w: x1 - x0, h: y1 - y0 });
  }
  if (!isl.length) return { uv, islands: 0 };
  let total = 0; for (const s of isl) total += (s.w || 1e-9) * (s.h || 1e-9);
  isl.sort((a, b) => b.h - a.h);
  // iterate: margin is in final UV units, so the gap in island units depends on the final scale
  let scale = 1, W = 0, H = 0, place = [];
  for (let pass = 0; pass < 4; pass++) {
    const gap = margin / scale; let width = Math.sqrt(total) * 1.1 + gap; const maxW = Math.max(...isl.map((s) => s.w)) + 2 * gap; width = Math.max(width, maxW);
    let x = gap, y = gap, rowH = 0; place = []; W = 0;
    for (const s of isl) { if (x + s.w + gap > width) { x = gap; y += rowH + gap; rowH = 0; } place.push([x, y]); x += s.w + gap; rowH = Math.max(rowH, s.h); W = Math.max(W, x); }
    H = y + rowH + gap; const side = Math.max(W, H); scale = 1 / side;
  }
  isl.forEach((s, i) => { const [px, py] = place[i]; for (const c of s.cn) { uv[c * 2] = (uv[c * 2] - s.x0 + px) * scale; uv[c * 2 + 1] = (uv[c * 2 + 1] - s.y0 + py) * scale; } });
  return { uv, islands: isl.length, fill: total * scale * scale };
}
export function averageScale(M, opts = {}) { return pack(M, M.UV.slice(), { ...opts, average: true, rotate: false }); }

// ---------------------------------------------------------------- stretch (singular values of the 3D->UV Jacobian)
export function stretch(M, uv = M.UV) {
  const { P, T, nt } = M, S = new Float32Array(nt); let a3 = 0, a2 = 0; const J = [];
  for (let t = 0; t < nt; t++) {
    const x = localTri(P, T[t * 3], T[t * 3 + 1], T[t * 3 + 2]), o = t * 6;
    const dx1 = x[2], dy1 = 0, dx2 = x[4], dy2 = x[5], det = dx1 * dy2 - dx2 * dy1; const ar3 = Math.abs(det) / 2;
    const du1 = uv[o + 2] - uv[o], du2 = uv[o + 4] - uv[o], dv1 = uv[o + 3] - uv[o + 1], dv2 = uv[o + 5] - uv[o + 1];
    const ar2 = Math.abs(du1 * dv2 - du2 * dv1) / 2; a3 += ar3; a2 += ar2;
    if (Math.abs(det) < 1e-20) { J.push(null); continue; }
    const a = (du1 * dy2 - du2 * dy1) / det, b = (du2 * dx1 - du1 * dx2) / det, c = (dv1 * dy2 - dv2 * dy1) / det, d = (dv2 * dx1 - dv1 * dx2) / det;
    const E = a * a + c * c, F = a * b + c * d, G = b * b + d * d, root = Math.sqrt(Math.max(0, (E - G) ** 2 + 4 * F * F));
    J.push([Math.sqrt(Math.max(0, (E + G + root) / 2)), Math.sqrt(Math.max(0, (E + G - root) / 2)), ar3]);
  }
  const k = Math.sqrt(a2 / (a3 || 1)) || 1; let mean = 0;
  for (let t = 0; t < nt; t++) { const j = J[t]; if (!j) { S[t] = 1; continue; } const s1 = j[0] / k, s2 = j[1] / k; // 0 = perfect, 1 = bad
    const aniso = s2 > 1e-9 ? 1 - s2 / s1 : 1, area = Math.abs(Math.log(Math.max(s1 * s2, 1e-9))) / 2.3; S[t] = Math.min(1, 0.65 * aniso + 0.35 * Math.min(1, area)); mean += S[t] * j[2]; }
  return { S, mean: mean / (a3 || 1) };
}
// own colour scale: deep teal (no stretch) -> mint -> sun yellow -> coral -> magenta (heavy stretch)
const SCALE = [[0.05, 0.36, 0.45], [0.24, 0.78, 0.66], [0.98, 0.85, 0.32], [1.0, 0.44, 0.38], [0.82, 0.16, 0.55]];
export function stretchColor(s) { const x = THREE.MathUtils.clamp(s, 0, 1) * (SCALE.length - 1), i = Math.min(SCALE.length - 2, Math.floor(x)), f = x - i; return SCALE[i].map((c, j) => c + (SCALE[i + 1][j] - c) * f); }

// ---------------------------------------------------------------- write back
export function writeUVs(mesh, uv, M = topo(mesh.geometry)) {
  const old = mesh.geometry, nt = M.nt, map = new Map(), src = [], uvs = [], I = new Uint32Array(nt * 3);
  const nA = old.attributes.normal, cA = old.attributes.color;
  for (let i = 0; i < nt * 3; i++) {
    const o = M.CO[i], u = uv[i * 2], v = uv[i * 2 + 1];
    let key = M.T[i] + ':' + Math.round(u * 1e6) + ',' + Math.round(v * 1e6);
    if (nA) key += ':' + Math.round(nA.getX(o) * 1e3) + ',' + Math.round(nA.getY(o) * 1e3) + ',' + Math.round(nA.getZ(o) * 1e3);
    if (cA) key += ':' + Math.round(cA.getX(o) * 255) + ',' + Math.round(cA.getY(o) * 255) + ',' + Math.round(cA.getZ(o) * 255);
    let id = map.get(key); if (id === undefined) { id = src.length; map.set(key, id); src.push(o); uvs.push(u, v); } I[i] = id;
  }
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(old.attributes)) { if (name === 'uv' || name === 'mfMask') continue; const s = a.itemSize, arr = new a.array.constructor(src.length * s);
    for (let i = 0; i < src.length; i++) for (let k = 0; k < s; k++) arr[i * s + k] = a.array[src[i] * s + k] ?? 0; // interleaved attributes are not used by MeshForge geometry
    g.setAttribute(name, new THREE.BufferAttribute(arr, s, a.normalized)); }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(new THREE.BufferAttribute(I, 1));
  copyData(old, g); const sl = getSlots(old, false); if (sl) setSlots(g, sl.slice(0, nt));
  for (const gr of old.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
export const uvOf = (geo) => topo(geo).UV;

// ---------------------------------------------------------------- import / export
// transfer UVs from another mesh of the same shape: matches triangles by their corner positions
export function transferUVs(M, sources) {
  const tri = new Map(), corner = new Map(); let matched = 0, near = 0;
  for (const s of sources) { const S = topo(s); if (!S.hasUV) continue;
    for (let t = 0; t < S.nt; t++) { const ks = [0, 1, 2].map((k) => S.keys[S.T[t * 3 + k]]); const key = [...ks].sort().join('#'); const m = {}; ks.forEach((k, j) => (m[k] = [S.UV[(t * 3 + j) * 2], S.UV[(t * 3 + j) * 2 + 1]])); tri.set(key, m); ks.forEach((k) => { if (!corner.has(k)) corner.set(k, m[k]); }); } }
  if (!tri.size) return null;
  const out = new Float32Array(M.nt * 6);
  for (let t = 0; t < M.nt; t++) { const ks = [0, 1, 2].map((k) => M.keys[M.T[t * 3 + k]]); const m = tri.get([...ks].sort().join('#'));
    if (m) { matched++; ks.forEach((k, j) => { out[(t * 3 + j) * 2] = m[k][0]; out[(t * 3 + j) * 2 + 1] = m[k][1]; }); }
    else ks.forEach((k, j) => { const c = corner.get(k); if (c) { near++; out[(t * 3 + j) * 2] = c[0]; out[(t * 3 + j) * 2 + 1] = c[1]; } }); }
  return { uv: out, matched, partial: near, total: M.nt };
}
export function uvJSON(M, name = 'mesh') { return { format: 'meshforge-uv', version: 1, object: name, triangles: M.nt, uv: Array.from(M.UV, (x) => +x.toFixed(6)) }; }
export function parseUVJSON(M, j) {
  if (!j || j.format !== 'meshforge-uv' || !Array.isArray(j.uv)) throw new Error('Not a MeshForge UV JSON file (format "meshforge-uv")');
  if (j.uv.length !== M.nt * 6) throw new Error(`UV JSON is for ${j.uv.length / 6} triangles; this object has ${M.nt}`);
  return { uv: Float32Array.from(j.uv) };
}
// UV layout as a PNG (transparent, wires + optional stretch fill)
export function layoutCanvas(M, { size = 1024, color = '#ffffff', fill = false, uv = M.UV } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  if (fill) { const { S } = stretch(M, uv); for (let t = 0; t < M.nt; t++) { const [r, gg, b] = stretchColor(S[t]); g.fillStyle = `rgba(${r * 255 | 0},${gg * 255 | 0},${b * 255 | 0},0.6)`; g.beginPath(); for (let k = 0; k < 3; k++) { const x = uv[(t * 3 + k) * 2] * size, y = (1 - uv[(t * 3 + k) * 2 + 1]) * size; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.fill(); } }
  g.strokeStyle = color; g.lineWidth = Math.max(1, size / 1024); g.beginPath();
  for (let t = 0; t < M.nt; t++) for (let k = 0; k < 3; k++) { const i = (t * 3 + k) * 2, j = (t * 3 + (k + 1) % 3) * 2; g.moveTo(uv[i] * size, (1 - uv[i + 1]) * size); g.lineTo(uv[j] * size, (1 - uv[j + 1]) * size); }
  g.stroke(); return c;
}
