// MeshForge Landscape mode (v4): original three.js (MIT) code, fully client-side.
// Paint a colour map -> height field (base heights + fractal noise + blend) -> region offsets (cliffs, hills,
// plateaus) -> grayscale terrain mesh, flat water plane and rule-based building scatter (InstancedMesh).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/GLTFExporter.js';
import { OBJExporter } from 'three/addons/OBJExporter.js';
import { STLExporter } from 'three/addons/STLExporter.js';
import { PLYExporter } from 'three/addons/PLYExporter.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export const MAP = 256;                                   // paint canvas resolution
export const CLASSES = [                                  // index order is stored in project files
  { key: 'sand', name: 'Sand', rgb: [232, 205, 90] },
  { key: 'grass', name: 'Grass', rgb: [96, 176, 72] },
  { key: 'water', name: 'Water', rgb: [60, 120, 220] },
  { key: 'mountain', name: 'Mountain', rgb: [40, 40, 40] },
];
const GRASS = 1;
export const DEFAULTS = () => ({
  seed: 1, size: 20, res: 192,
  base: { sand: 0.25, grass: 0.8, water: -1.2, mountain: 4.5 },
  noiseAmp: 0.5, noiseScale: 4, octaves: 4, blend: 1.0, waterLevel: 0, showWater: true, debugColour: false,
  hmapMin: -1.2, hmapMax: 5,
  scatter: { on: true, density: 0.5, spacing: 1.2, maxSlope: 12, onGrass: true, onSand: false, avoidCliff: 0.8, waterMargin: 0.15, tall: 0.2, scaleMin: 0.8, scaleMax: 1.25, rotate: true },
});

// ---------- seeded random + noise ----------
export function rng(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
export function fbm(x, y, seed, oct = 4) { let f = 1, amp = 1, sum = 0, norm = 0; for (let o = 0; o < oct; o++) { sum += amp * vnoise(x * f, y * f, seed + o * 1013); norm += amp; f *= 2; amp *= 0.5; } return sum / norm; }

// separable box blur, 3 passes ~ gaussian. r in cells.
function blur(a, n, r, tmp) {
  r = Math.round(r); if (r < 1) return a; tmp ||= new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < n; y++) { const o = y * n; let acc = 0; for (let k = -r; k <= r; k++) acc += a[o + Math.min(n - 1, Math.max(0, k))];
      for (let x = 0; x < n; x++) { tmp[o + x] = acc / (2 * r + 1); acc += a[o + Math.min(n - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; } }
    for (let x = 0; x < n; x++) { let acc = 0; for (let k = -r; k <= r; k++) acc += tmp[Math.min(n - 1, Math.max(0, k)) * n + x];
      for (let y = 0; y < n; y++) { a[y * n + x] = acc / (2 * r + 1); acc += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x]; } }
  }
  return a;
}

// rasterise a region (coords in 0..1 map space) into a mask of n*n
const maskCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function regionMask(reg, n) {
  const c = maskCanvas; c.width = c.height = n; const g = c.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, n, n); g.fillStyle = '#fff'; g.beginPath(); const p = reg.pts;
  if (reg.type === 'rect') g.rect(Math.min(p[0][0], p[1][0]) * n, Math.min(p[0][1], p[1][1]) * n, Math.abs(p[1][0] - p[0][0]) * n, Math.abs(p[1][1] - p[0][1]) * n);
  else if (reg.type === 'circle') g.arc(p[0][0] * n, p[0][1] * n, Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) * n, 0, Math.PI * 2);
  else { p.forEach(([x, y], i) => i ? g.lineTo(x * n, y * n) : g.moveTo(x * n, y * n)); g.closePath(); }
  g.fill(); const d = g.getImageData(0, 0, n, n).data, m = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) m[i] = d[i * 4 + 3] / 255; return m;
}

// ---------- core: height field ----------
// state = { params, paint: Uint8Array(MAP*MAP), hmap: Float32Array(MAP*MAP)|null, regions: [] }
export function computeField(state) {
  const P = state.params, n = P.res + 1, cell = P.size / P.res, F = new Float32Array(n * n), cls = new Uint8Array(n * n);
  const baseOf = CLASSES.map((c) => P.base[c.key]);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const mi = Math.min(MAP - 1, Math.floor(i / (n - 1) * MAP)), mj = Math.min(MAP - 1, Math.floor(j / (n - 1) * MAP)), k = mj * MAP + mi;
    if (state.hmap) { const v = state.hmap[k]; F[j * n + i] = P.hmapMin + v * (P.hmapMax - P.hmapMin); }
    else F[j * n + i] = baseOf[state.paint[k]];
    cls[j * n + i] = state.paint[k];
  }
  const tmp = new Float32Array(n * n);
  blur(F, n, P.blend / cell / 1.7, tmp);
  if (P.noiseAmp > 0) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // mountains get more noise, water less: keeps beaches calm and peaks rugged
    const c = cls[j * n + i], w = c === 3 ? 2.2 : c === 2 ? 0.4 : 1;
    F[j * n + i] += (fbm(i / (n - 1) * P.noiseScale, j / (n - 1) * P.noiseScale, P.seed, P.octaves) - 0.5) * 2 * P.noiseAmp * w;
  }
  for (const reg of state.regions || []) {
    if (reg.hidden) continue;
    const hard = regionMask(reg, n), m = Float32Array.from(hard);
    if (reg.blend > cell * 0.5) blur(m, n, reg.blend / cell / 1.7, tmp);
    if (reg.plateau) {
      let s = 0, c = 0; for (let i = 0; i < n * n; i++) if (hard[i] > 0.5) { s += F[i]; c++; }
      const top = (c ? s / c : 0) + reg.offset;
      for (let i = 0; i < n * n; i++) F[i] += (top - F[i]) * m[i];
    } else for (let i = 0; i < n * n; i++) F[i] += reg.offset * m[i];
  }
  return { F, cls, n, cell, size: P.size };
}
export function makeSampler(field) {
  const { F, n, size } = field;
  return (x, z) => {
    const u = Math.min(n - 1.0001, Math.max(0, (x / size + 0.5) * (n - 1))), v = Math.min(n - 1.0001, Math.max(0, (z / size + 0.5) * (n - 1)));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, a = F[j * n + i], b = F[j * n + i + 1], c = F[(j + 1) * n + i], d = F[(j + 1) * n + i + 1];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  };
}
function slopeDeg(field, x, z, h) { const s = makeSamplerCached(field); const dx = (s(x + h, z) - s(x - h, z)) / (2 * h), dz = (s(x, z + h) - s(x, z - h)) / (2 * h); return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI; }
const samplerCache = new WeakMap(); function makeSamplerCached(f) { let s = samplerCache.get(f); if (!s) { s = makeSampler(f); samplerCache.set(f, s); } return s; }

// ---------- building scatter (jittered grid, seeded) ----------
export function scatter(state, field) {
  const P = state.params, S = P.scatter, out = []; if (!S.on || S.density <= 0) return out;
  const r = rng(P.seed * 7919 + 17), sh = makeSamplerCached(field), half = P.size / 2, sp = Math.max(0.3, S.spacing), cells = Math.floor(P.size / sp);
  for (let gy = 0; gy < cells; gy++) for (let gx = 0; gx < cells; gx++) {
    const roll = r(), jx = r(), jz = r(), rot = r(), sc = r(), tl = r();
    if (roll > S.density) continue;
    const x = -half + (gx + 0.15 + jx * 0.7) * sp, z = -half + (gy + 0.15 + jz * 0.7) * sp;
    const u = Math.min(MAP - 1, Math.floor((x / P.size + 0.5) * MAP)), v = Math.min(MAP - 1, Math.floor((z / P.size + 0.5) * MAP)), c = state.paint[v * MAP + u];
    if (!((c === GRASS && S.onGrass) || (c === 0 && S.onSand))) continue;
    const h = sh(x, z); if (h < P.waterLevel + S.waterMargin) continue;
    if (slopeDeg(field, x, z, 0.25) > S.maxSlope) continue;
    let ok = true;                                          // keep clear of nearby cliffs
    if (S.avoidCliff > 0) for (let a = 0; a < 6 && ok; a++) { const ax = x + Math.cos(a) * S.avoidCliff, az = z + Math.sin(a) * S.avoidCliff; if (Math.abs(sh(ax, az) - h) > S.avoidCliff * 0.9) ok = false; }
    if (!ok) continue;
    const s = S.scaleMin + sc * (S.scaleMax - S.scaleMin), fp = 0.35 * s;
    const y = Math.min(h, sh(x - fp, z - fp), sh(x + fp, z - fp), sh(x - fp, z + fp), sh(x + fp, z + fp));
    out.push({ type: tl < S.tall ? 'tower' : 'house', x, y, z, rot: S.rotate ? rot * Math.PI * 2 : 0, scale: s });
  }
  return out;
}

// ---------- module geometry ----------
function roofGeo() { const g = (function () { const x = 0.38, z = 0.48, h = 0.32, p = [-x, 0, z, x, 0, z, 0, h, z, x, 0, -z, -x, 0, -z, 0, h, -z, -x, 0, -z, -x, 0, z, 0, h, z, -x, 0, -z, 0, h, z, 0, h, -z, x, 0, z, x, 0, -z, 0, h, -z, x, 0, z, 0, h, -z, 0, h, z];
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.computeVertexNormals(); return geo; })(); g.translate(0, 0.5, 0); return g; }
function stripGeo(g) { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); return g; }
export function defaultModules() {
  const body = new THREE.BoxGeometry(0.7, 0.5, 0.9); body.translate(0, 0.25, 0);
  const tower = new THREE.BoxGeometry(0.6, 2.2, 0.6); tower.translate(0, 1.1, 0);
  return { house: [stripGeo(body), stripGeo(roofGeo())], tower: [stripGeo(tower)] };
}
const BUILD_MAT = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
const TERRAIN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
const WATER_MAT = new THREE.MeshStandardMaterial({ color: 0x3a78d0, transparent: true, opacity: 0.55, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide });

// ---------- builder: owns meshes, reuses buffers ----------
export function createBuilder() {
  const group = new THREE.Group(); group.name = 'Landscape';
  let terrain = null, water = null, inst = [], modules = defaultModules(), last = null;
  function buildTerrain(state, field) {
    const P = state.params, n = field.n;
    if (!terrain || terrain.userData.res !== P.res || terrain.userData.size !== P.size) {
      if (terrain) { group.remove(terrain); terrain.geometry.dispose(); }
      const g = new THREE.PlaneGeometry(P.size, P.size, P.res, P.res); g.rotateX(-Math.PI / 2);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
      terrain = new THREE.Mesh(g, TERRAIN_MAT); terrain.name = 'Terrain'; terrain.userData = { res: P.res, size: P.size }; group.add(terrain);
    }
    const pos = terrain.geometry.attributes.position, col = terrain.geometry.attributes.color, F = field.F;
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < F.length; i++) { lo = Math.min(lo, F[i]); hi = Math.max(hi, F[i]); }
    const span = Math.max(1e-3, hi - lo);
    for (let i = 0; i < n * n; i++) {               // PlaneGeometry rows run -z..+z after rotation, matching map v
      pos.array[i * 3 + 1] = F[i];
      if (P.debugColour) { const c = CLASSES[field.cls[i]].rgb; col.array[i * 3] = c[0] / 255; col.array[i * 3 + 1] = c[1] / 255; col.array[i * 3 + 2] = c[2] / 255; }
      else { const g = 0.32 + 0.38 * (F[i] - lo) / span; col.array[i * 3] = col.array[i * 3 + 1] = col.array[i * 3 + 2] = g; }
    }
    pos.needsUpdate = col.needsUpdate = true; terrain.geometry.computeVertexNormals(); terrain.geometry.computeBoundingSphere(); terrain.geometry.computeBoundingBox();
  }
  function buildWater(state) {
    const P = state.params;
    if (!water) { water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), WATER_MAT); water.name = 'Water'; water.renderOrder = 2; group.add(water); }
    water.scale.set(P.size, 1, P.size); water.position.y = P.waterLevel; water.visible = P.showWater;
  }
  function buildInstances(list) {
    for (const m of inst) { group.remove(m); m.dispose(); } inst = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const type of ['house', 'tower']) {
      const items = list.filter((b) => b.type === type); if (!items.length) continue;
      for (const geo of modules[type]) {
        const im = new THREE.InstancedMesh(geo, BUILD_MAT, items.length); im.name = type === 'house' ? 'Houses' : 'Towers';
        items.forEach((b, i) => { q.setFromAxisAngle(up, b.rot); m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.scale, b.scale, b.scale)); im.setMatrixAt(i, m4); });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); group.add(im); inst.push(im);
      }
    }
  }
  function build(state) {
    const field = computeField(state), buildings = scatter(state, field);
    buildTerrain(state, field); buildWater(state); buildInstances(buildings);
    last = { field, buildings, sampleHeight: makeSampler(field) }; return last;
  }
  function setModules(mods) { modules = { ...defaultModules(), ...mods }; }
  // flatten everything into plain meshes for OBJ/STL/PLY/GLB export
  function exportGroup({ buildings = true, water: withWater = true } = {}) {
    const g = new THREE.Group(); g.name = 'MeshForgeLandscape';
    if (terrain) { const t = new THREE.Mesh(terrain.geometry.clone(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })); t.name = 'Terrain'; g.add(t); }
    if (withWater && water?.visible) { const w = new THREE.Mesh(water.geometry.clone().scale(water.scale.x, 1, water.scale.z).translate(0, water.position.y, 0), WATER_MAT.clone()); w.name = 'Water'; g.add(w); }
    if (buildings && inst.length) {
      const parts = [], m4 = new THREE.Matrix4();
      for (const im of inst) for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); parts.push(im.geometry.clone().applyMatrix4(m4)); }
      const merged = mergeGeometries(parts, false); if (merged) { const b = new THREE.Mesh(merged, BUILD_MAT.clone()); b.name = 'Buildings'; g.add(b); }
    }
    return g;
  }
  return { group, build, setModules, exportGroup, get terrain() { return terrain; }, get last() { return last; } };
}

// ---------- random painted map ----------
export function randomPaint(seed, opts = {}) {
  const paint = new Uint8Array(MAP * MAP), f = opts.scale ?? 3, water = opts.water ?? 0.36, sand = water + (opts.beach ?? 0.05), mount = opts.mountain ?? 0.66;
  for (let j = 0; j < MAP; j++) for (let i = 0; i < MAP; i++) {
    const e = fbm(i / MAP * f, j / MAP * f, seed * 31 + 5, 5);
    paint[j * MAP + i] = e < water ? 2 : e < sand ? 0 : e > mount ? 3 : 1;
  }
  return paint;
}
export function randomRegions(seed, count = 2) {
  const r = rng(seed * 104729 + 3), out = [];
  for (let k = 0; k < count; k++) {
    const cx = 0.2 + r() * 0.6, cy = 0.2 + r() * 0.6, rad = 0.06 + r() * 0.1, cliff = r() < 0.5;
    out.push({ name: cliff ? `Cliff ${k + 1}` : `Hill ${k + 1}`, type: r() < 0.5 ? 'circle' : 'rect', pts: [[cx, cy], [cx + rad, cy + rad * (0.6 + r() * 0.6)]], offset: +(1.5 + r() * 3).toFixed(1), blend: cliff ? 0.05 : +(1 + r() * 2).toFixed(1), plateau: cliff });
  }
  return out;
}
