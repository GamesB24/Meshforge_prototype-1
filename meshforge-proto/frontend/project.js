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
        type: obj.isBone ? 'bone' : obj.isLight ? 'light' : obj.isCamera ? 'camera' : obj.userData?.isEmpty ? 'empty' : obj.userData?.isArmature ? 'armature' : obj.isMesh ? 'mesh' : 'group',
        length: obj.isBone ? (obj.userData.length || 0) : undefined,
        restPosition: obj.isBone ? (obj.userData.restPosition || null) : undefined,
        restQuaternion: obj.isBone ? (obj.userData.restQuaternion || null) : undefined,
        light: obj.isLight ? { kind: obj.isDirectionalLight ? 'directional' : 'point', color: '#' + obj.color.getHexString(), intensity: obj.intensity } : undefined,
        position: [obj.position.x, obj.position.y, obj.position.z],
        quaternion: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
        visible: obj.visible !== false,
        source: obj.userData.source || '',
        behaviours: behavioursOf(obj),
        collision: obj.userData.collision ? JSON.parse(JSON.stringify(obj.userData.collision)) : null,
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
        rec.material = m ? { name: m.name || '', color: m.color ? '#' + m.color.getHexString() : '#cccccc', roughness: m.roughness ?? 0.6, metalness: m.metalness ?? 0, vertexColors: !!g.attributes.color && !obj.userData.heatColors } : null;
        if (obj.userData.heatColors) rec.geometry.color = null;
        if (obj.isSkinnedMesh && g.attributes.skinIndex && g.attributes.skinWeight) {
          rec.skin = { bones: obj.skeleton.bones.map((b) => b.name), index: packAttr(g.attributes.skinIndex), weight: packAttr(g.attributes.skinWeight) };
        }
      }
      objects.push(rec);
      for (const c of obj.children) {
        if (!c || c.userData?.isOverlay || c.userData?.isWireOverlay || c.userData?.isSelection || c.userData?.isBoneViz) continue;
        if (c.isMesh && obj.isMesh) continue;
        if (c.isMesh || c.isGroup || c.isBone || c.isLight || c.isCamera || c.userData?.isEmpty) walk(c, id);
      }
    };
    if (model) for (const c of model.children) {
      if (c.userData?.isOverlay || c.userData?.isBoneViz) continue;
      if (c.isMesh || c.isGroup || c.isBone || c.isLight || c.isCamera || c.userData?.isEmpty) walk(c, null);
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
      content: ctx.contentJSON?.() || null,
      objects,
    };
  }

  function serializeText() { return JSON.stringify(serialize()); }

  function makeObject(rec, THREE) {
    let obj;
    if (rec.type === 'bone') {
      obj = new THREE.Bone();
      obj.userData.length = rec.length || 0.2;
      if (rec.restPosition) obj.userData.restPosition = rec.restPosition.slice();
      if (rec.restQuaternion) obj.userData.restQuaternion = rec.restQuaternion.slice();
    } else if (rec.type === 'light') {
      const color = rec.light?.color || '#fff6e4';
      const intensity = rec.light?.intensity ?? 1;
      obj = rec.light?.kind === 'directional' ? new THREE.DirectionalLight(color, intensity) : new THREE.PointLight(color, intensity);
    } else if (rec.type === 'camera') obj = new THREE.PerspectiveCamera(rec.camera?.fov || 50, 1, 0.1, 100);
    else if (rec.type === 'empty') { obj = new THREE.Object3D(); obj.userData.isEmpty = true; }
    else if (rec.type === 'armature') { obj = new THREE.Group(); obj.userData.isArmature = true; }
    else if (rec.type === 'mesh' && rec.geometry?.position) {
      const geo = new THREE.BufferGeometry();
      const pos = unpackAttr(rec.geometry.position);
      geo.setAttribute('position', new THREE.BufferAttribute(pos.array, pos.itemSize || 3));
      const idx = unpackAttr(rec.geometry.index);
      if (idx) geo.setIndex(new THREE.BufferAttribute(idx.array, 1));
      const uv = unpackAttr(rec.geometry.uv);
      if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv.array, uv.itemSize || 2));
      const col = unpackAttr(rec.geometry.color);
      if (col) geo.setAttribute('color', new THREE.BufferAttribute(col.array, col.itemSize || 3));
      if (rec.skin?.index && rec.skin?.weight) {
        const si = unpackAttr(rec.skin.index);
        const sw = unpackAttr(rec.skin.weight);
        if (si) geo.setAttribute('skinIndex', new THREE.BufferAttribute(si.array, 4));
        if (sw) geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw.array, 4));
      }
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const color = rec.material?.color || '#cccccc';
      const mat = new THREE.MeshStandardMaterial({ color, roughness: rec.material?.roughness ?? 0.6, metalness: rec.material?.metalness ?? 0, vertexColors: !!col, side: THREE.DoubleSide });
      if (rec.material?.name) mat.name = rec.material.name;
      obj = rec.skin?.bones?.length ? new THREE.SkinnedMesh(geo, mat) : new THREE.Mesh(geo, mat);
    } else obj = new THREE.Group();
    obj.name = rec.name || 'Object';
    if (rec.position) obj.position.set(rec.position[0], rec.position[1], rec.position[2]);
    if (rec.quaternion) obj.quaternion.set(rec.quaternion[0], rec.quaternion[1], rec.quaternion[2], rec.quaternion[3]);
    if (rec.scale) obj.scale.set(rec.scale[0], rec.scale[1], rec.scale[2]);
    obj.visible = rec.visible !== false;
    obj.userData.sceneId = rec.id;
    obj.userData.source = rec.source || 'project';
    obj.userData.label = obj.name;
    if (rec.behaviours?.length) obj.userData.behaviours = JSON.parse(JSON.stringify(rec.behaviours));
    if (rec.collision) obj.userData.collision = JSON.parse(JSON.stringify(rec.collision));
    if (rec.faceSetNames && rec.faceSetIds) {
      obj.userData.faceSetNames = rec.faceSetNames.slice();
      obj.userData.faceSetIds = typedFromB64(rec.faceSetIds, Int32Array);
    }
    return obj;
  }

  function rebindSkins(records, byId, root, THREE) {
    for (const rec of records) {
      if (!rec.skin?.bones?.length) continue;
      const host = byId.get(rec.id)?.obj;
      if (!host?.isMesh) continue;
      const bones = [];
      for (const name of rec.skin.bones) {
        let found = null;
        root.traverse((o) => { if (!found && o.isBone && o.name === name) found = o; });
        if (found) bones.push(found);
      }
      if (!bones.length) continue;
      const skinned = host.isSkinnedMesh ? host : new THREE.SkinnedMesh(host.geometry, host.material);
      if (skinned !== host) {
        skinned.name = host.name;
        skinned.userData = host.userData;
        skinned.position.copy(host.position);
        skinned.quaternion.copy(host.quaternion);
        skinned.scale.copy(host.scale);
        host.parent.add(skinned);
        host.parent.remove(host);
        byId.get(rec.id).obj = skinned;
      }
      skinned.bind(new THREE.Skeleton(bones));
      const arm = bones[0] && (bones[0].parent?.userData?.isArmature ? bones[0].parent : null);
      if (arm) { skinned.userData.armatureId = arm.uuid; arm.userData.meshId = skinned.uuid; arm.userData.meshName = skinned.name; }
    }
  }

  async function appendObjects(records) {
    const THREE = ctx.THREE;
    const root = ctx.ensureModel();
    const byId = new Map();
    for (const rec of records || []) byId.set(rec.id, { obj: makeObject(rec, THREE), parent: rec.parent });
    for (const { obj, parent } of byId.values()) {
      const p = parent && byId.get(parent)?.obj;
      (p || root).add(obj);
    }
    rebindSkins(records || [], byId, root, THREE);
    ctx.afterLoad?.({ objects: records });
    return { objects: records?.length || 0 };
  }

  async function loadData(data) {
    if (!data || data.format !== 'meshforge-project') throw new Error('Not a MeshForge project');
    ctx.clearModel();
    const root = ctx.ensureModel();
    await appendObjects(data.objects || []);
    ctx.afterLoad?.(data);
    if (data.landscape) ctx.applyLandscape?.(data.landscape);
    if (data.timeline) ctx.applyTimeline?.(data.timeline, (k) => {
      let found = null;
      root.traverse((o) => { if (!found && (o.userData.sceneId === k.id || o.name === k.name)) found = o; });
      return found;
    });
    if (data.camera) ctx.setCamera?.(data.camera);
    if (data.materials?.length) ctx.applyMaterials?.(data.materials);
    if (data.content) ctx.applyContent?.(data.content);
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

  return { serialize, serializeText, loadText, loadData, appendObjects, save, saveAs, open, writeAutosave, maybeRestore, idbSet, idbGet };
}
