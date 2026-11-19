// Chibili: MeshForge's stylised toon render engine (v7). Original MIT code written for MeshForge.
// Hard-banded half-lambert shading, optional rim light and highlight, shadow tint, inverted-hull outlines,
// toon sky gradient and cheap animated toon water (cell foam lines). Works with skinned meshes.
import * as THREE from 'three';

// Global look settings (per-material values can override bands/softness/rim/outline).
export const CHIBILI = { bands: 3, soft: 0.03, rim: 0.25, highlight: 0.18, shadowTint: 0.65, outline: true, outlineWidth: 2.5, outlineColor: '#141218', lightAz: 35, lightEl: 50, ambient: 0.0 };
export const lightDir = () => {
  const az = THREE.MathUtils.degToRad(CHIBILI.lightAz), el = THREE.MathUtils.degToRad(CHIBILI.lightEl);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
};

const SKIN_PARS = `#include <common>
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>`;
const SKIN_MAIN = `#include <beginnormal_vertex>
#include <morphnormal_vertex>
#include <skinbase_vertex>
#include <skinnormal_vertex>
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinning_vertex>`;

const VERT = `${SKIN_PARS}
uniform float uKind; uniform float uTime; uniform float uWave;
varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vCol; varying vec3 vObj;
void main(){
  ${SKIN_MAIN}
  if (uKind > 1.5 && uKind < 2.5) { transformed.y += (sin(transformed.x * 3.1 + uTime * 1.3) + cos(transformed.z * 2.7 + uTime * 1.1)) * uWave; }
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vW = wp.xyz; vN = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz); vUv = uv; vObj = transformed;
#ifdef USE_COLOR
  vCol = color.rgb;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = `
uniform vec3 uColor; uniform vec3 uShade; uniform vec3 uRimColor; uniform vec3 uLight; uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uFoam;
uniform float uBands; uniform float uSoft; uniform float uRim; uniform float uHigh; uniform float uTint; uniform float uKind; uniform float uTime;
uniform float uUseMap; uniform float uUseVCol; uniform float uOpacity; uniform float uFoamScale; uniform float uAmbient;
uniform sampler2D uMap;
varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vCol; varying vec3 vObj;
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float cellEdge(vec2 p, float t){ // distance between nearest and second-nearest moving cell centre
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)); vec2 o = hash2(i + g); o = 0.5 + 0.4 * sin(t + 6.2831 * o);
    float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return d2 - d1; }
float band(float t, float b, float s){ // quantise 0..1 into b hard steps; s softens each step edge
  float q = t * b; float fl = floor(q); float fr = q - fl;
  float lv = fl + smoothstep(1.0 - max(s, 0.0005), 1.0, fr);
  return clamp(lv / max(b - 1.0, 1.0), 0.0, 1.0); }
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vW);
  vec3 col;
  if (uKind > 0.5 && uKind < 1.5) {           // sky: banded vertical gradient, unlit
    float h = clamp(normalize(vObj).y * 0.5 + 0.5, 0.0, 1.0);
    col = mix(uBottom, uTop, band(h, max(uBands, 2.0) + 2.0, uSoft));
  } else {
    vec3 base = uColor;
    if (uUseVCol > 0.5) base *= vCol;
    if (uUseMap > 0.5) base *= texture2D(uMap, vUv).rgb;
    float b = max(uBands, 1.0);
    float t = dot(N, normalize(uLight)) * 0.5 + 0.5;
    float lv = b < 1.5 ? 1.0 : band(t, b, uSoft);
    vec3 shadow = mix(vec3(0.42), uShade, uTint);
    col = base * mix(shadow, vec3(1.0), max(lv, uAmbient));
    float rim = 1.0 - max(dot(N, V), 0.0);
    col += uRimColor * uRim * smoothstep(0.62, 0.66, rim) * step(0.5, t);
    vec3 H = normalize(normalize(uLight) + V);
    col += vec3(uHigh) * smoothstep(0.955, 0.965, dot(N, H));
    if (uKind > 1.5) {                           // water: cell foam lines + darker troughs
      vec2 p = vW.xz * uFoamScale;
      float e = cellEdge(p, uTime * 0.6);
      float e2 = cellEdge(p * 0.5 + 7.3, uTime * 0.35);
      col = mix(col * 0.82, col, step(0.35, e2));
      col = mix(uFoam, col, smoothstep(0.06, 0.09, e));
    }
  }
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}`;

const OUT_VERT = `${SKIN_PARS}
uniform float uWidth; uniform vec2 uRes; uniform float uKind; uniform float uTime; uniform float uWave;
#ifdef MF_SMOOTHN
attribute vec3 mfOutlineN;
#endif
void main(){
  ${SKIN_MAIN}
#ifdef MF_SMOOTHN
  objectNormal = mfOutlineN;
#endif
  vec4 c = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  vec2 d = (projectionMatrix * vec4(normalMatrix * objectNormal, 0.0)).xy; float l = length(d);
  if (l > 1e-6) c.xy += d / l * uWidth * 2.0 / uRes * c.w;
  gl_Position = c;
}`;
const OUT_FRAG = `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}`;

export const KIND = { toon: 0, sky: 1, water: 2 };
const col = (v) => new THREE.Color(v);

export function makeChibiliMaterial(opts = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: col(opts.color || '#cccccc') }, uShade: { value: col(opts.shade || '#5b4a7a') }, uRimColor: { value: col('#ffffff') },
      uLight: { value: lightDir() }, uTop: { value: col(opts.top || '#3f8fe8') }, uBottom: { value: col(opts.bottom || '#cfeeff') }, uFoam: { value: col(opts.foam || '#f4fbff') },
      uBands: { value: 3 }, uSoft: { value: 0.03 }, uRim: { value: 0.25 }, uHigh: { value: 0.18 }, uTint: { value: 0.65 }, uKind: { value: 0 }, uTime: { value: 0 }, uWave: { value: 0 },
      uUseMap: { value: 0 }, uUseVCol: { value: 0 }, uOpacity: { value: 1 }, uFoamScale: { value: 2.2 }, uAmbient: { value: 0 }, uMap: { value: null },
    },
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
  });
  m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1;
  m.userData.isChibili = true;
  return m;
}
export function makeOutlineMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uWidth: { value: 2.5 }, uRes: { value: new THREE.Vector2(1, 1) }, uColor: { value: col('#141218') }, uKind: { value: 0 }, uTime: { value: 0 }, uWave: { value: 0 } },
    vertexShader: OUT_VERT, fragmentShader: OUT_FRAG, side: THREE.BackSide,
  });
  m.userData.isChibiliOutline = true; return m;
}

// Copy a library material definition + global settings into a Chibili ShaderMaterial's uniforms.
export function syncUniforms(m, def, ex = {}) {
  const u = m.uniforms, G = CHIBILI;
  u.uColor.value.set(def.color || '#cccccc'); u.uShade.value.set(def.shade || '#5b4a7a');
  u.uBands.value = def.bands > 0 ? def.bands : G.bands; u.uSoft.value = def.soft >= 0 ? def.soft : G.soft;
  u.uRim.value = def.rim >= 0 ? def.rim : G.rim; u.uHigh.value = def.highlight >= 0 ? def.highlight : G.highlight; u.uTint.value = G.shadowTint;
  u.uKind.value = KIND[def.kind] || 0; u.uLight.value.copy(ex.light || lightDir()); u.uAmbient.value = G.ambient;
  if (def.kind === 'sky') { u.uTop.value.set(def.top || '#3f8fe8'); u.uBottom.value.set(def.bottom || '#cfeeff'); }
  if (def.kind === 'water') { u.uFoam.value.set(def.foam || '#f4fbff'); u.uFoamScale.value = def.foamScale || 2.2; u.uWave.value = def.wave ?? 0.015; }
  else u.uWave.value = 0;
  u.uTime.value = ex.time || 0;
  const useV = !!ex.vertexColors; if (m.vertexColors !== useV) { m.vertexColors = useV; m.needsUpdate = true; }
  u.uUseVCol.value = useV ? 1 : 0;
  u.uUseMap.value = ex.map ? 1 : 0; u.uMap.value = ex.map || null;
  const op = def.opacity ?? 1; u.uOpacity.value = op; const tr = op < 0.999; if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
}

// Outline normals averaged over coincident positions so hard-edged meshes don't crack at corners.
export function smoothOutlineNormals(geo) {
  const pos = geo.attributes.position; if (!pos) return;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal, n = pos.count, map = new Map(), acc = [];
  const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const id = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = key(i); let w = map.get(k); if (w === undefined) { w = acc.length / 3; map.set(k, w); acc.push(0, 0, 0); } id[i] = w; acc[w * 3] += nor.getX(i); acc[w * 3 + 1] += nor.getY(i); acc[w * 3 + 2] += nor.getZ(i); }
  if (acc.length / 3 === n) return false;   // already shared vertices: plain normals are fine
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const w = id[i]; const l = Math.hypot(acc[w * 3], acc[w * 3 + 1], acc[w * 3 + 2]) || 1; out[i * 3] = acc[w * 3] / l; out[i * 3 + 1] = acc[w * 3 + 1] / l; out[i * 3 + 2] = acc[w * 3 + 2] / l; }
  geo.setAttribute('mfOutlineN', new THREE.BufferAttribute(out, 3)); return true;
}

// Small offscreen renderer for library thumbnails (rendered with the Chibili look itself).
let thumbR = null, thumbScene = null, thumbCam = null, thumbMesh = null, thumbOut = null;
export function renderSwatch(def, size = 64) {
  try {
    if (!thumbR) {
      const c = document.createElement('canvas'); c.width = c.height = size;
      thumbR = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbScene = new THREE.Scene(); thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 10); thumbCam.position.set(0, 0.25, 3.3); thumbCam.lookAt(0, 0, 0);
      const g = new THREE.SphereGeometry(0.8, 40, 24);
      thumbMesh = new THREE.Mesh(g, makeChibiliMaterial()); thumbOut = new THREE.Mesh(g, makeOutlineMaterial()); thumbScene.add(thumbMesh, thumbOut);
    }
    const isSky = def.kind === 'sky';
    syncUniforms(thumbMesh.material, def, { light: new THREE.Vector3(0.55, 0.6, 0.6).normalize(), time: 1.3 });
    if (def.kind === 'water') thumbMesh.material.uniforms.uFoamScale.value = 3.2;
    thumbMesh.material.side = isSky ? THREE.BackSide : THREE.DoubleSide;
    thumbOut.visible = !isSky; thumbOut.material.uniforms.uWidth.value = 1.6; thumbOut.material.uniforms.uRes.value.set(size, size);
    thumbOut.material.uniforms.uColor.value.set(CHIBILI.outlineColor);
    thumbMesh.scale.setScalar(isSky ? 3 : 1);
    thumbR.setClearColor(0x000000, 0); thumbR.render(thumbScene, thumbCam);
    return thumbR.domElement.toDataURL('image/png');
  } catch (e) { console.warn('swatch render failed', e); return ''; }
}
