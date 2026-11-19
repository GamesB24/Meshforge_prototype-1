// MeshForge v7 shared per-geometry data (original MIT code).
// three.js clones geometry.userData through JSON, which would mangle typed arrays, so per-triangle data
// (material slot per triangle, UV seams) lives in WeakMaps keyed by the BufferGeometry instead.
const SLOTS = new WeakMap(), SEAMS = new WeakMap();

export const triCount = (geo) => {
  const n = geo.index ? geo.index.count : geo.attributes.position.count;
  return Math.floor(Math.min(n, geo.drawRange && Number.isFinite(geo.drawRange.count) ? geo.drawRange.count : n) / 3);
};
export function getSlots(geo, create = true) {
  let s = SLOTS.get(geo); const nt = triCount(geo);
  if (s && s.length >= nt) return s;
  if (!create) return s || null;
  const n = new Uint16Array(nt); if (s) n.set(s.subarray(0, Math.min(s.length, nt))); SLOTS.set(geo, n); return n;
}
export const hasSlots = (geo) => SLOTS.has(geo);
export function setSlots(geo, arr) { if (arr) SLOTS.set(geo, arr instanceof Uint16Array ? arr : Uint16Array.from(arr)); else SLOTS.delete(geo); }
export function copyData(from, to) {
  const s = SLOTS.get(from); if (s) SLOTS.set(to, s.slice());
  const e = SEAMS.get(from); if (e) SEAMS.set(to, new Set(e));
  return to;
}
// one group per run of equal slots (keeps triangle order, so Edit Mode face indices stay valid)
export function applyGroups(geo, nSlots = 1) {
  const nt = triCount(geo), s = getSlots(geo); geo.clearGroups();
  if (!nt) { geo.addGroup(0, 0, 0); return 1; }
  let start = 0, cur = Math.min(s[0], nSlots - 1);
  for (let t = 1; t <= nt; t++) {
    const v = t < nt ? Math.min(s[t], nSlots - 1) : -1;
    if (v !== cur) { geo.addGroup(start * 3, (t - start) * 3, cur); start = t; cur = v; }
  }
  return geo.groups.length;
}
export function getSeams(geo, create = true) { let s = SEAMS.get(geo); if (!s && create) { s = new Set(); SEAMS.set(geo, s); } return s || null; }
export function setSeams(geo, set) { if (set) SEAMS.set(geo, set); else SEAMS.delete(geo); }
// position key used for seams so they survive re-indexing
export const pkey = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
export const ekey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
