// Content browser docked beside the timeline. Library lives in IndexedDB and in the project file.
const DEFAULTS = ['Meshes', 'Materials', 'Levels', 'Rigs/Animations', 'Imported', 'Generated', 'Prefabs'];

function emptyLib() {
  const folders = {};
  for (const name of DEFAULTS) folders[name] = [];
  return { folders };
}

export function createContentBrowser(ctx) {
  const lib = emptyLib();
  let tab = localStorage.getItem('mf_dock_tab') || 'timeline';
  let collapsed = localStorage.getItem('mf_dock_collapsed') === '1';
  let filter = 'all';
  let query = '';
  let current = 'Meshes';

  function allAssets() {
    const out = [];
    for (const [folder, list] of Object.entries(lib.folders)) for (const a of list) out.push({ ...a, folder });
    return out;
  }
  function remember() {
    localStorage.setItem('mf_dock_tab', tab);
    localStorage.setItem('mf_dock_collapsed', collapsed ? '1' : '0');
    const dbReq = indexedDB.open('meshforge-content', 1);
    dbReq.onupgradeneeded = () => dbReq.result.createObjectStore('lib');
    dbReq.onsuccess = () => {
      const db = dbReq.result;
      const tx = db.transaction('lib', 'readwrite');
      tx.objectStore('lib').put(exportJSON(true), 'library');
    };
  }
  function exportJSON(withThumbs) {
    const folders = {};
    for (const [name, list] of Object.entries(lib.folders)) {
      folders[name] = list.map((a) => withThumbs ? a : { ...a, thumb: '' });
    }
    return { folders };
  }
  function importJSON(data) {
    if (!data?.folders) return;
    lib.folders = { ...emptyLib().folders, ...data.folders };
    paint();
  }
  async function restore() {
    await new Promise((resolve) => {
      const req = indexedDB.open('meshforge-content', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('lib');
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const tx = req.result.transaction('lib', 'readonly');
        const get = tx.objectStore('lib').get('library');
        get.onsuccess = () => { if (get.result?.folders) lib.folders = { ...emptyLib().folders, ...get.result.folders }; resolve(); };
        get.onerror = () => resolve();
      };
    });
    paint();
  }
  function thumb(label, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1b1f27';
    g.font = '24px sans-serif';
    g.fillText(String(label || '?').slice(0, 1).toUpperCase(), 22, 40);
    return c.toDataURL('image/png');
  }
  function addAsset(folder, asset) {
    if (!lib.folders[folder]) lib.folders[folder] = [];
    asset.id = asset.id || `asset_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`;
    asset.thumb = asset.thumb || thumb(asset.name, asset.type === 'level' ? '#8fbf8a' : asset.type === 'prefab' ? '#d2b48c' : '#8aa4d4');
    lib.folders[folder].push(asset);
    current = folder;
    remember();
    paint();
    return asset;
  }
  function createFolder(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    if (lib.folders[n]) { ctx.status?.('That folder already exists'); return false; }
    lib.folders[n] = [];
    current = n;
    remember();
    paint();
    return true;
  }
  function renameFolder(from, to) {
    if (!lib.folders[from] || !to?.trim() || lib.folders[to]) return false;
    lib.folders[to.trim()] = lib.folders[from];
    delete lib.folders[from];
    if (current === from) current = to.trim();
    remember();
    paint();
    return true;
  }
  function deleteFolder(name) {
    const names = Object.keys(lib.folders);
    if (names.length < 2 || !lib.folders[name]) return false;
    delete lib.folders[name];
    if (current === name) current = Object.keys(lib.folders)[0];
    remember();
    paint();
    return true;
  }
  function saveSelection(name, folder = 'Prefabs') {
    const data = ctx.serialize?.();
    const sel = ctx.selected?.();
    if (!data || !sel) { ctx.status?.('Select an object to save as a prefab'); return null; }
    const ids = new Set();
    const take = (o) => { if (!o) return; ids.add(o.userData?.sceneId || o.uuid); o.traverse?.((c) => ids.add(c.userData?.sceneId || c.uuid)); };
    take(sel);
    const objects = (data.objects || []).filter((o) => ids.has(o.id));
    if (!objects.length) { ctx.status?.('Nothing to save'); return null; }
    const asset = addAsset(folder, { name: name || sel.name || 'Prefab', type: 'prefab', payload: { objects } });
    ctx.status?.(`Saved ${asset.name} into ${folder}`);
    return asset;
  }
  function saveLevel(name) {
    const data = ctx.serialize?.();
    if (!data) return null;
    const { content, ...rest } = data;
    const asset = addAsset('Levels', { name: name || 'Level', type: 'level', payload: rest });
    ctx.status?.(`Saved level ${asset.name}`);
    return asset;
  }
  async function place(id) {
    const asset = allAssets().find((a) => a.id === id);
    if (!asset) return false;
    if (asset.type === 'level') {
      await ctx.loadProject?.(asset.payload);
      ctx.status?.(`Opened level ${asset.name}`);
      return true;
    }
    if (asset.type === 'image' && asset.payload?.url) {
      ctx.addImagePlane?.(asset.payload.url, asset.name);
      return true;
    }
    const objects = asset.payload?.objects;
    if (!objects?.length) { ctx.status?.('That asset has no objects'); return false; }
    const map = new Map();
    for (const r of objects) map.set(r.id, `${r.id}_${Math.random().toString(36).slice(2, 6)}`);
    const cloned = objects.map((r) => ({ ...r, id: map.get(r.id), parent: r.parent ? map.get(r.parent) : null }));
    await ctx.appendObjects?.(cloned);
    ctx.status?.(`Added ${asset.name}`);
    return true;
  }
  function useAsSpawn(id) {
    const asset = allAssets().find((a) => a.id === id);
    const mesh = asset?.payload?.objects?.find((o) => o.type === 'mesh' && o.geometry);
    if (!mesh) { ctx.status?.('Pick a mesh asset to scatter'); return false; }
    return ctx.spawnAsset?.(asset.id, asset.name, mesh) || false;
  }
  async function importFile(file) {
    const name = file.name.replace(/\.[^.]+$/, '');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'fbx') { ctx.status?.('FBX is not imported in this build. Use GLB, glTF, OBJ, or an image.'); return null; }
    if (ext === 'obj') {
      const text = await file.text();
      const objects = [objRecord(name, text)];
      return addAsset('Imported', { name, type: 'prefab', payload: { objects } });
    }
    if (ext === 'glb' || ext === 'gltf') {
      const buf = await file.arrayBuffer();
      const objects = await gltfRecords(name, buf);
      return addAsset('Imported', { name, type: 'prefab', payload: { objects } });
    }
    if (/png|jpe?g|webp|gif/.test(ext)) {
      const url = await blobUrl(file);
      return addAsset('Imported', { name, type: 'image', payload: { url }, thumb: url });
    }
    ctx.status?.('Use GLB, glTF, OBJ, or an image.');
    return null;
  }
  function objRecord(name, text) {
    const verts = [], faces = [];
    for (const line of text.split(/\r?\n/)) {
      const p = line.trim().split(/\s+/);
      if (p[0] === 'v' && p.length >= 4) verts.push(+p[1], +p[2], +p[3]);
      else if (p[0] === 'f' && p.length >= 4) {
        const idx = p.slice(1).map((s) => (parseInt(s, 10) || 1) - 1);
        for (let i = 1; i < idx.length - 1; i++) faces.push(idx[0], idx[i], idx[i + 1]);
      }
    }
    return geometryRecord(name, new Float32Array(verts), new Uint32Array(faces));
  }
  async function gltfRecords(name, buf) {
    const { GLTFLoader } = await import('./vendor/GLTFLoader.js');
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => loader.parse(buf, '', resolve, reject));
    const records = [];
    gltf.scene?.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      records.push(geometryRecord(o.name || name, g.attributes.position.array, g.index ? g.index.array : null));
    });
    return records.length ? records : [geometryRecord(name, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]))];
  }
  function geometryRecord(name, position, index) {
    const pack = (arr) => {
      if (!arr) return null;
      const typed = arr instanceof Uint32Array || arr instanceof Uint16Array ? arr : new Float32Array(arr);
      let s = '';
      const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
      const step = 0x8000;
      for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + step)));
      const kind = typed instanceof Uint32Array ? 'u32' : typed instanceof Uint16Array ? 'u16' : 'f32';
      return { kind, itemSize: kind === 'f32' ? 3 : 1, b64: btoa(s) };
    };
    return {
      id: `imp_${Math.random().toString(36).slice(2, 7)}`,
      parent: null,
      name,
      type: 'mesh',
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
      visible: true,
      source: 'imported',
      geometry: { position: pack(position), index: index ? pack(index) : null },
      material: { color: '#cccccc', roughness: 0.6, metalness: 0 },
    };
  }
  function blobUrl(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
  }

  const dock = document.createElement('div');
  dock.id = 'bottomDock';
  function mount() {
    const bar = document.getElementById('animTimelineBar');
    if (!bar || document.getElementById('bottomDock')) return !!bar;
    bar.parentElement.insertBefore(dock, bar);
    dock.appendChild(bar);
    const tabs = document.createElement('div');
    tabs.className = 'dock-tabs';
    tabs.innerHTML = `<button type="button" data-tab="timeline">Timeline</button><button type="button" data-tab="content">Content Browser</button><span class="grow"></span><button type="button" id="dockMin" title="Minimise">–</button>`;
    dock.insertBefore(tabs, bar);
    const browser = document.createElement('div');
    browser.id = 'contentBrowser';
    browser.innerHTML = `
      <div class="cb-folders"></div>
      <div class="cb-main">
        <div class="cb-tools">
          <input id="cbSearch" placeholder="Search">
          <select id="cbFilter"><option value="all">All types</option><option value="prefab">Prefabs</option><option value="level">Levels</option><option value="image">Images</option><option value="material">Materials</option></select>
          <button type="button" id="cbFolder" class="btn">New folder</button>
          <button type="button" id="cbImport" class="btn">Import</button>
          <button type="button" id="cbPrefab" class="btn">Save prefab</button>
          <button type="button" id="cbLevel" class="btn">Save level</button>
          <input id="cbFile" type="file" hidden accept=".glb,.gltf,.obj,.fbx,.png,.jpg,.jpeg,.webp">
        </div>
        <div class="cb-grid"></div>
      </div>`;
    dock.appendChild(browser);
    tabs.onclick = (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) { tab = b.dataset.tab; collapsed = false; remember(); paint(); }
      if (e.target.id === 'dockMin') { collapsed = !collapsed; remember(); paint(); }
    };
    browser.querySelector('#cbSearch').oninput = (e) => { query = e.target.value; paint(); };
    browser.querySelector('#cbFilter').onchange = (e) => { filter = e.target.value; paint(); };
    browser.querySelector('#cbFolder').onclick = () => { const n = prompt('Folder name'); if (n) createFolder(n); };
    browser.querySelector('#cbImport').onclick = () => browser.querySelector('#cbFile').click();
    browser.querySelector('#cbFile').onchange = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await importFile(f); };
    browser.querySelector('#cbPrefab').onclick = () => { const n = prompt('Prefab name', ctx.selected?.()?.name || 'Prefab'); if (n) saveSelection(n); };
    browser.querySelector('#cbLevel').onclick = () => { const n = prompt('Level name', 'Level'); if (n) saveLevel(n); };
    const vp = document.getElementById('c');
    vp?.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-meshforge-asset')) e.preventDefault(); });
    vp?.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('application/x-meshforge-asset');
      if (!id) return;
      e.preventDefault();
      place(id);
    });
    return true;
  }
  function paint() {
    if (!mount()) return;
    const bar = document.getElementById('animTimelineBar');
    const browser = document.getElementById('contentBrowser');
    dock.classList.toggle('collapsed', collapsed);
    bar.style.display = !collapsed && tab === 'timeline' ? '' : 'none';
    browser.hidden = collapsed || tab !== 'content';
    dock.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const min = dock.querySelector('#dockMin');
    if (min) min.textContent = collapsed ? '+' : '–';
    const folders = dock.querySelector('.cb-folders');
    if (!folders) return;
    folders.innerHTML = Object.keys(lib.folders).map((name) => `<div class="cb-folder ${name === current ? 'on' : ''}" data-folder="${name}"><b>${name}</b><button type="button" data-ren="${name}" title="Rename">✎</button><button type="button" data-del="${name}" title="Delete">×</button></div>`).join('');
    folders.querySelectorAll('.cb-folder').forEach((row) => { row.onclick = (e) => { if (e.target.dataset.ren || e.target.dataset.del) return; current = row.dataset.folder; paint(); }; });
    folders.querySelectorAll('[data-ren]').forEach((b) => { b.onclick = () => { const n = prompt('Rename folder', b.dataset.ren); if (n) renameFolder(b.dataset.ren, n); }; });
    folders.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => deleteFolder(b.dataset.del); });
    const grid = dock.querySelector('.cb-grid');
    const q = query.trim().toLowerCase();
    const assets = (lib.folders[current] || []).filter((a) => (filter === 'all' || a.type === filter) && (!q || a.name.toLowerCase().includes(q)));
    grid.innerHTML = assets.map((a) => `<button type="button" class="asset-card" draggable="true" data-id="${a.id}"><img alt="" src="${a.thumb || ''}"><span>${a.name}</span><small>${a.type}</small></button>`).join('') || '<div class="hint0">Empty folder. Import a file, or save a prefab or level.</div>';
    grid.querySelectorAll('.asset-card').forEach((card) => {
      card.ondragstart = (e) => e.dataTransfer.setData('application/x-meshforge-asset', card.dataset.id);
      card.ondblclick = () => place(card.dataset.id);
      card.onclick = () => { card.classList.add('on'); };
      card.oncontextmenu = (e) => { e.preventDefault(); useAsSpawn(card.dataset.id); };
    });
  }
  const timer = setInterval(() => { if (mount()) { clearInterval(timer); restore().then(paint); } }, 200);

  return {
    createFolder, renameFolder, deleteFolder, saveSelection, saveLevel, place, importFile, useAsSpawn, exportJSON, importJSON,
    folders: () => Object.keys(lib.folders),
    assets: () => allAssets().map((a) => ({ id: a.id, name: a.name, type: a.type, folder: a.folder })),
    setTab(next) { tab = next; collapsed = false; remember(); paint(); },
    minimise(on) { collapsed = on !== false; remember(); paint(); },
    isCollapsed: () => collapsed,
    tab: () => tab,
  };
}
