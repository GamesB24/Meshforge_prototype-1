// MeshForge project file (.meshforge JSON) plus IndexedDB autosave.
// Round-trips objects, edited geometry, transforms, materials, hierarchy,
// timeline keys, behaviours, landscape paint/settings and the camera.
// Original MIT code.

const DB = 'meshforge';
const STORE = 'autosave';
const KEY = 'latest';

function b64FromTyped(typed) {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + step)));
  return btoa(s);
}
function typedFromB64(b64, ctor) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const copy = u8.byteLength % (ctor.BYTES_PER_ELEMENT || 1) === 0 ? u8 : u8.slice(0, u8.byteLength - (u8.byteLength % ctor.BYTES_PER_ELEMENT));
  return new ctor(copy.buffer, copy.byteOffset, copy.byteLength / ctor.BYTES_PER_ELEMENT);
}

function packAttr(attr) {
  if (!attr) return null;
  const arr = attr.array;
  const kind = arr instanceof Float32Array ? 'f32' : arr instanceof Uint32Array ? 'u32' : arr instanceof Uint16Array ? 'u16' : 'f32';
  return { kind, itemSize: attr.itemSize, b64: b64FromTyped(arr) };
}
function unpackAttr(pack) {
  if (!pack?.b64) return null;
  const ctor = pack.kind === 'u32' ? Uint32Array : pack.kind === 'u16' ? Uint16Array : Float32Array;
  return { array: typedFromB64(pack.b64, ctor), itemSize: pack.itemSize };
}

function behavioursOf(obj) {
  return (obj.userData.behaviours || []).filter((b) => b && b.type).map((b) => ({ type: b.type, enabled: b.enabled !== false, params: b.params || {} }));
}

export function createProject(ctx) {
  let fileHandle = null;
  let saving = false;

  function openDb() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function idbGet() {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const q = tx.objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  }
  async function idbSet(text) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(text, KEY);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  function serialize() {
    const model = ctx.getModel();
    const objects = [];
    const walk = (obj, parentId) => {
      if (!obj || obj.userData?.isOverlay || obj.userData?.isSelection) return;
      const id = obj.userData.sceneId || obj.uuid;
      const rec = {
        id, parent: parentId, name: obj.name || 'Object',
        type: obj.isMesh ? 'mesh' : 'group',
        position: [obj.position.x, obj.position.y, obj.position.z],
        quaternion: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
        visible: obj.visible !== false,
        source: obj.userData.source || '',
        behaviours: behavioursOf(obj),
        faceSetNames: obj.userData.faceSetNames || null,
        faceSetIds: obj.userData.faceSetIds ? b64FromTyped(obj.userData.faceSetIds) : null,
      };
      if (obj.isMesh && obj.geometry?.attributes?.position) {
        const g = obj.geometry;
        const mat = obj.userData.orig || obj.material;
        const m = Array.isArray(mat) ? mat[0] : mat;
        rec.geometry = {
          position: packAttr(g.attributes.position),
          index: g.index ? packAttr(g.index) : null,
          uv: packAttr(g.attributes.uv),
          color: packAttr(g.attributes.color),
        };
        rec.material = m ? { name: m.name || '', color: m.color ? '#' + m.color.getHexString() : '#cccccc', roughness: m.roughness ?? 0.6, metalness: m.metalness ?? 0, vertexColors: !!g.attributes.color } : null;
      }
      objects.push(rec);
      if (obj.isGroup || (!obj.isMesh && obj.children)) {
        for (const c of obj.children) {
          if (c.userData?.isOverlay || c.userData?.isWireOverlay || c.userData?.isSelection) continue;
          if (c.isMesh && obj.isMesh) continue;
          if (c.isMesh || c.isGroup) walk(c, id);
        }
      }
    };
    if (model) for (const c of model.children) {
      if (c.userData?.isOverlay) continue;
      if (c.isMesh || c.isGroup) walk(c, null);
    }
    const cam = ctx.getCamera();
    return {
      format: 'meshforge-project',
      version: 1,
      savedAt: new Date().toISOString(),
      camera: cam,
      materials: ctx.materialsJSON?.() || [],
      timeline: ctx.timelineJSON?.() || null,
      landscape: ctx.landscapeJSON?.() || null,
      objects,
    };
  }

  function serializeText() { return JSON.stringify(serialize()); }

  async function loadData(data) {
    if (!data || data.format !== 'meshforge-project') throw new Error('Not a MeshForge project');
    ctx.clearModel();
    const THREE = ctx.THREE;
    const byId = new Map();
    const root = ctx.ensureModel();
    for (const rec of data.objects || []) {
      let obj;
      if (rec.type === 'mesh' && rec.geometry?.position) {
        const geo = new THREE.BufferGeometry();
        const pos = unpackAttr(rec.geometry.position);
        geo.setAttribute('position', new THREE.BufferAttribute(pos.array, pos.itemSize || 3));
        const idx = unpackAttr(rec.geometry.index);
        if (idx) geo.setIndex(new THREE.BufferAttribute(idx.array, 1));
        const uv = unpackAttr(rec.geometry.uv);
        if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv.array, uv.itemSize || 2));
        const col = unpackAttr(rec.geometry.color);
        if (col) geo.setAttribute('color', new THREE.BufferAttribute(col.array, col.itemSize || 3));
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        const color = rec.material?.color || '#cccccc';
        const mat = new THREE.MeshStandardMaterial({ color, roughness: rec.material?.roughness ?? 0.6, metalness: rec.material?.metalness ?? 0, vertexColors: !!col, side: THREE.DoubleSide });
        if (rec.material?.name) mat.name = rec.material.name;
        obj = new THREE.Mesh(geo, mat);
      } else obj = new THREE.Group();
      obj.name = rec.name || 'Object';
      obj.position.set(rec.position[0], rec.position[1], rec.position[2]);
      if (rec.quaternion) obj.quaternion.set(rec.quaternion[0], rec.quaternion[1], rec.quaternion[2], rec.quaternion[3]);
      if (rec.scale) obj.scale.set(rec.scale[0], rec.scale[1], rec.scale[2]);
      obj.visible = rec.visible !== false;
      obj.userData.sceneId = rec.id;
      obj.userData.source = rec.source || 'project';
      obj.userData.label = obj.name;
      if (rec.behaviours?.length) obj.userData.behaviours = JSON.parse(JSON.stringify(rec.behaviours));
      if (rec.faceSetNames && rec.faceSetIds) {
        obj.userData.faceSetNames = rec.faceSetNames.slice();
        obj.userData.faceSetIds = typedFromB64(rec.faceSetIds, Int32Array);
      }
      byId.set(rec.id, { obj, parent: rec.parent });
    }
    for (const { obj, parent } of byId.values()) {
      const p = parent && byId.get(parent)?.obj;
      (p || root).add(obj);
    }
    ctx.afterLoad?.(data);
    if (data.landscape) ctx.applyLandscape?.(data.landscape);
    if (data.timeline) ctx.applyTimeline?.(data.timeline, (k) => {
      let found = null;
      root.traverse((o) => { if (!found && (o.userData.sceneId === k.id || o.name === k.name)) found = o; });
      return found;
    });
    if (data.camera) ctx.setCamera?.(data.camera);
    if (data.materials?.length) ctx.applyMaterials?.(data.materials);
    return { objects: data.objects?.length || 0 };
  }

  async function loadText(text) { return loadData(JSON.parse(text)); }

  async function writeAutosave() {
    if (saving) return;
    try { saving = true; await idbSet(serializeText()); }
    catch (err) { console.warn('Autosave failed', err); }
    finally { saving = false; }
  }

  async function maybeRestore() {
    try {
      const text = await idbGet();
      if (!text) return false;
      await loadText(text);
      ctx.status?.('Restored the autosaved project');
      return true;
    } catch (err) {
      ctx.status?.('Autosave could not be restored: ' + err.message);
      return false;
    }
  }

  async function saveAs() {
    const text = serializeText();
    const blob = new Blob([text], { type: 'application/json' });
    try {
      if (window.showSaveFilePicker) {
        fileHandle = await window.showSaveFilePicker({ suggestedName: 'project.meshforge', types: [{ description: 'MeshForge project', accept: { 'application/json': ['.meshforge'] } }] });
        const w = await fileHandle.createWritable();
        await w.write(blob); await w.close();
        ctx.status?.('Saved project');
        await idbSet(text);
        return true;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return false;
    }
    ctx.download?.(blob, 'project.meshforge');
    await idbSet(text);
    ctx.status?.('Downloaded project.meshforge');
    return true;
  }

  async function save() {
    if (fileHandle) {
      try {
        const text = serializeText();
        const w = await fileHandle.createWritable();
        await w.write(new Blob([text], { type: 'application/json' }));
        await w.close();
        await idbSet(text);
        ctx.status?.('Saved project');
        return true;
      } catch (err) {
        if (err?.name !== 'AbortError') ctx.status?.('Save failed: ' + err.message);
      }
    }
    return saveAs();
  }

  async function open() {
    try {
      if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({ types: [{ description: 'MeshForge project', accept: { 'application/json': ['.meshforge', '.json'] } }] });
        fileHandle = handle;
        const file = await handle.getFile();
        await loadText(await file.text());
        ctx.status?.('Opened ' + file.name);
        return true;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return false;
    }
    ctx.pickFile?.();
    return false;
  }

  return { serialize, serializeText, loadText, loadData, save, saveAs, open, writeAutosave, maybeRestore, idbSet, idbGet };
}
