// MeshForge plugin host. Original MIT code; plugins are trusted local modules, not sandboxed.
import { createSecretStore } from './secretstore.js';
export async function initPlugins({ api, setWorkspace, tabs, panels, offline }) {
  const records = new Map();
  let active = null, pluginsLoaded = false;
  const dialog = document.createElement('div');
  dialog.id = 'pluginDialog'; dialog.className = 'plugin-modal'; dialog.hidden = true;
  dialog.innerHTML = '<div class="plugin-card"><h2>Plugins</h2><p class="hint0">Trusted local code · changes require reload</p><div id="pluginList"></div><div class="row"><span></span><button class="btn" id="pluginClose">Close</button></div></div>';
  document.body.appendChild(dialog);
  dialog.querySelector('#pluginClose').onclick = () => { dialog.hidden = true; };
  dialog.onclick = e => { if (e.target === dialog) dialog.hidden = true; };
  api.showPlugins = async () => {
    dialog.hidden = false;
    const list = dialog.querySelector('#pluginList'); list.textContent = 'Loading…';
    if (offline() && !pluginsLoaded) { list.textContent = 'Plugins need the MeshForge backend (offline mode skips them).'; return; }
    try {
      const r = await fetch('/api/plugins/all'); const plugins = await r.json();
      list.replaceChildren();
      if (!plugins.length) list.textContent = 'No plugins found. Drop a plugin folder or zip in plugins/, then restart.';
      for (const p of plugins) {
        const row = document.createElement('div'); row.className = 'plugin-row';
        const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = p.enabled; toggle.id = 'pluginToggle-' + p.id;
        toggle.onchange = async () => { toggle.disabled = true; try { const res = await fetch(`/api/plugins/${encodeURIComponent(p.id)}/enabled`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({enabled:toggle.checked}) }); if (!res.ok) throw Error(await res.text()); row.querySelector('.plugin-reload').hidden = false; } catch (e) { toggle.checked = !toggle.checked; toggle.disabled = false; row.querySelector('.plugin-error').textContent = e.message; } };
        const label = document.createElement('label'); label.htmlFor = toggle.id; label.textContent = `${p.manifest?.name || p.id} ${p.manifest?.version || ''}`;
        const err = document.createElement('div'); err.className = 'plugin-error'; err.textContent = p.error || '';
        const reload = document.createElement('span'); reload.className = 'plugin-reload hint0'; reload.textContent = 'Reload MeshForge to apply'; reload.hidden = true;
        row.append(toggle, label, reload, err); list.appendChild(row);
      }
    } catch (e) { list.textContent = 'Could not read plugins: ' + e.message; }
  };
  // Secrets are in-memory even when plugin discovery fails. set() never calls the network.
  if (offline()) {
    api.plugins = { list: () => [], active: null, showPlugins: api.showPlugins, offline: true };
    console.warn('MeshForge is offline, so plugin tabs are not loaded. A key cannot be entered until you reload with the server running. Keys are never written to disk.');
    return;
  }

  try { // One bad entry never blocks subsequent modules.
    const response = await fetch('/api/plugins/all');
    if (!response.ok) throw Error('HTTP ' + response.status);
    var plugins = await response.json(); pluginsLoaded = true;
  } catch (e) { console.warn('Plugin list failed: ' + e.message + '. secrets.set does not contact the server. The key field is missing because the plugin did not load. Reload with the MeshForge server running. Keys are never saved.'); return; }

  function activateTab(pid) {
    const r = records.get(pid); if (!r) return;
    if (active && active !== pid) {
      const prev = records.get(active); try { prev?.spec.onLeave?.(); } catch {} prev?.panel?.setAttribute('hidden', '');
      prev?.tabEl.classList.remove('on');
    }
    document.body.classList.add('pluginActive');
    for (const [other, rec] of records) if (other !== pid) { rec.panel.setAttribute('hidden',''); rec.tabEl.classList.remove('on'); }
    active = pid; api.plugins.active = pid;
    try { setWorkspace('plugin:' + pid); } catch { /* host fallback */ } r.panel.removeAttribute('hidden'); r.tabEl.classList.add('on'); api.plugins.active = pid;
    try { r.spec.onEnter?.(); } catch { /* plugin UI is isolated below */ }
    api.plugins.active = pid;
  }
  api.plugins = {
    list: () => plugins.map(p => ({ id:p.id, enabled:p.enabled, manifest:p.manifest, error:p.error })),
    active: null, showPlugins: api.showPlugins,
    activate: activateTab,
  };
  for (const p of plugins) {
    if (!p.enabled) continue;
    const rec = { spec:null, panel:null, tabEl:null, cleanup:[], module:null, secrets:new Map() };
    records.set(p.id, rec);
    try {
      const module = await import(apiPluginURL(p.id, p.manifest.entry)); rec.module = module;
      if (typeof module.activate !== 'function') throw Error('entry module must export activate(mf)');
      const store = createSecretStore({ pluginId: p.id, pluginName: p.manifest?.name });
      const showSecret = (name) => {
        const text = store.status(name);
        const host = rec.panel || panels.right;
        if (!host) return text;
        let el = host.querySelector('.mf-secret-status');
        if (!el) { el = document.createElement('div'); el.className = 'mf-secret-status hint0'; host.appendChild(el); }
        el.textContent = text;
        return text;
      };
      const clearSecrets = () => { store.clear(); };
      const secretAPI = Object.freeze({
        set: (name, value) => { const text = store.set(name, value); showSecret(name); return text; },
        get: name => store.get(name), has: name => store.has(name), clear: clearSecrets,
        header: name => { const h = store.header(name); if (h && Object.keys(h).length) showSecret(name); return h; },
        status: name => store.status(name),
      });
      rec.clearSecrets = clearSecrets;
      const backend = (path, opts={}) => fetch(`/api/plugins/${encodeURIComponent(p.id)}/${String(path).replace(/^\//,'')}`, opts);
      const mf = Object.freeze({
        api,
        registerTab(spec) {
          if (rec.tabEl) throw Error('This example host allows one tab per plugin');
          const el = document.createElement('span'); el.className = 'tab plugin-tab'; el.textContent = spec.label || p.manifest.name; el.id = 'pluginTab-' + p.id;
          const panel = document.createElement('section'); panel.className = 'plugin-left-panel'; panel.id = 'pluginPanel-' + p.id; panel.hidden = true;
          panels.left.appendChild(panel);
          el.onclick = () => activateTab(p.id); tabs.appendChild(el);
          rec.spec=spec || {}; rec.tabEl=el; rec.panel=panel;
          rec.cleanup.push(() => { el.remove(); panel.remove(); }); return {panel};
        },
        registerPanel(spec={}) {
          const host = spec.location === 'bottom' ? panels.bottom : panels.right;
          const details = document.createElement('details'); details.open = true; details.id = 'pluginSide-' + p.id + '-' + (spec.id || 'panel');
          const summary = document.createElement('summary'); summary.textContent = spec.title || p.manifest.name;
          const el = document.createElement('div'); details.append(summary,el); host.appendChild(details);
          rec.cleanup.push(() => details.remove()); return {el};
        },
        backend, jobs: Object.freeze({ poll: (jobId,onProgress) => poll(backend,jobId,onProgress) }),
        secrets: secretAPI, assetURL: rel => `/plugins/${encodeURIComponent(p.id)}/${String(rel).replace(/^\//,'')}`,
      });
      rec.mf = mf;
      await module.activate(mf);
      rec.cleanup.push(() => { try { module.deactivate?.(); } catch { /* isolated */ } clearSecrets(); });
    } catch (e) {
      rec.error = e.message;
      // Keep a visible non-sensitive load error without breaking any other plugin.
      console.error(`Plugin ${p.id} failed: ${e?.message || e}`);
    }
  }
  addEventListener('pagehide', (ev) => { if (ev.persisted) return; for (const r of records.values()) r.clearSecrets?.(); });
  addEventListener('unload', () => { for (const r of records.values()) r.clearSecrets?.(); });
  addEventListener('meshforge-workspace-change', e => {
    const w=e.detail;
    if (active && w !== 'plugin:'+active) {
      const r=records.get(active); try { r?.spec.onLeave?.(); } catch {} r?.panel?.setAttribute('hidden',''); r?.tabEl?.classList.remove('on'); active=null; api.plugins.active=null; document.body.classList.remove('pluginActive');
    }
  });
}
function apiPluginURL(id, entry) { return `/plugins/${encodeURIComponent(id)}/${String(entry).replace(/^\//,'')}`; }
async function poll(backend, jobId, onProgress) {
  for (;;) {
    const r=await backend('jobs/'+encodeURIComponent(jobId)); if (!r.ok) throw Error('Plugin job HTTP '+r.status);
    const job=await r.json(); onProgress?.(job);
    if (job.status === 'done' || job.status === 'error') return job;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
