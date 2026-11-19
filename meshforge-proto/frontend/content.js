// Content browser: imported meshes, category guess, drag payload. Original MIT code.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { classifyAsset } from './catalog.js';
import { meshesFromOBJ } from './objmtl.js';

const assets = [];
const listeners = new Set();
let seq = 1;
const CATS = ['building', 'tree', 'prop', 'character'];

function emit() { for (const fn of listeners) fn(assets); }

export function onAssets(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function listAssets() { return assets.slice(); }
export function assetById(id) { return assets.find((a) => a.id === id) || null; }

export function readDropId(dt) {
  if (!dt) return '';
  const custom = dt.getData('application/x-meshforge-asset');
  if (custom) return custom;
  const text = dt.getData('text/plain') || '';
  return text.startsWith('mf-asset:') ? text.slice('mf-asset:'.length) : '';
}

function boundsOf(parts) {
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const s = box.getSize(new THREE.Vector3());
  return { x: s.x, y: s.y, z: s.z, rigged: false };
}

function remember(name, parts, rigged = false) {
  const size = boundsOf(parts); size.rigged = rigged;
  const category = classifyAsset(name, size);
  const rec = { id: 'asset_' + (seq++), name, category, parts, size };
  assets.push(rec); emit(); return rec;
}

function partsFromObject(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const mat = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : (o.material ? o.material.clone() : new THREE.MeshStandardMaterial({ color: 0xcccccc }));
    parts.push({ geometry: geo, material: mat });
  });
  return parts;
}

export function normalizeParts(parts, target = 1) {
  const box = new THREE.Box3();
  parts.forEach((p) => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); });
  const size = box.getSize(new THREE.Vector3());
  const s = target / Math.max(size.x, size.y, size.z, 1e-6);
  const c = box.getCenter(new THREE.Vector3());
  return parts.map((p) => {
    const g = p.geometry.clone();
    g.translate(-c.x, -box.min.y, -c.z).scale(s, s, s);
    return { geometry: g, material: p.material };
  });
}

export function objectFromAsset(asset) {
  const parts = asset.parts || [];
  if (parts.length === 1) {
    const mesh = new THREE.Mesh(parts[0].geometry.clone(), cloneMat(parts[0].material));
    mesh.name = asset.name;
    return mesh;
  }
  const g = new THREE.Group(); g.name = asset.name;
  for (const p of parts) {
    const mesh = new THREE.Mesh(p.geometry.clone(), cloneMat(p.material));
    mesh.name = asset.name;
    g.add(mesh);
  }
  return g;
}
function cloneMat(m) {
  if (Array.isArray(m)) return m.map((x) => x.clone());
  return m ? m.clone() : new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 });
}

export function importObject(name, root, rigged = false) {
  const parts = partsFromObject(root);
  if (!parts.length) return null;
  return remember(name, parts, rigged);
}

export async function importFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '');
  if (/\.obj$/i.test(file.name)) {
    const text = await file.text();
    const meshes = await meshesFromOBJ(text, '');
    if (!meshes.length) throw new Error('OBJ has no faces');
    const g = new THREE.Group(); meshes.forEach((m) => g.add(m));
    return importObject(name, g, false);
  }
  const buf = await file.arrayBuffer();
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
  const rigged = !!gltf.scene && hasSkin(gltf.scene);
  return importObject(name, gltf.scene, rigged);
}
function hasSkin(root) { let yes = false; root.traverse((o) => { if (o.isSkinnedMesh) yes = true; }); return yes; }

export function mountBrowser(host) {
  host.classList.add('content-browser');
  const draw = () => {
    host.replaceChildren();
    const title = document.createElement('div'); title.className = 'hint0'; title.textContent = 'Content — drag a mesh onto a landscape slot or into the viewport';
    host.appendChild(title);
    if (!assets.length) {
      const empty = document.createElement('div'); empty.className = 'hint0'; empty.textContent = 'No assets yet. Drop a GLB, glTF or OBJ here.';
      host.appendChild(empty);
    }
    for (const cat of CATS) {
      const rows = assets.filter((a) => a.category === cat);
      if (!rows.length) continue;
      const h = document.createElement('b'); h.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
      host.appendChild(h);
      for (const a of rows) {
        const row = document.createElement('div');
        row.className = 'asset-row'; row.draggable = true; row.dataset.id = a.id; row.textContent = a.name;
        row.title = a.category;
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-meshforge-asset', a.id);
          e.dataTransfer.setData('text/plain', 'mf-asset:' + a.id);
          e.dataTransfer.effectAllowed = 'copy';
        });
        host.appendChild(row);
      }
    }
  };
  host.addEventListener('dragover', (e) => { e.preventDefault(); host.classList.add('over'); });
  host.addEventListener('dragleave', () => host.classList.remove('over'));
  host.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); host.classList.remove('over');
    const files = [...(e.dataTransfer.files || [])].filter((f) => /\.(glb|gltf|obj)$/i.test(f.name));
    for (const f of files) { try { await importFile(f); } catch (err) { console.warn(err); } }
  });
  onAssets(draw); draw();
  return { draw };
}
