// Autosave client: interval, folder choice, recovery prompt, .mfproj upload.
// Original MIT code. The project zip is built by the caller and contains no secrets.
export function createRecover(ctx) {
  let settings = { dir: '', intervalSec: 120, projectPath: '', lastManualSave: 0 };
  let timer = 0;
  const dialog = document.createElement('div');
  dialog.className = 'plugin-modal'; dialog.hidden = true;
  dialog.innerHTML = `<div class="plugin-card" id="recoverCard"></div>`;
  document.body.appendChild(dialog);
  const card = dialog.querySelector('#recoverCard');

  async function refresh() {
    const r = await fetch('/api/autosave/settings');
    if (!r.ok) return null;
    const body = await r.json();
    settings = body.settings || settings;
    return body;
  }
  function start() {
    clearInterval(timer);
    const ms = Math.max(30, settings.intervalSec || 120) * 1000;
    timer = setInterval(() => { write('interval').catch(() => {}); }, ms);
  }
  async function write(reason) {
    const blob = await ctx.buildProject();
    if (!blob) return null;
    const r = await fetch('/api/autosave?reason=' + encodeURIComponent(reason || 'interval'), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  async function saveSettings(patch) {
    const r = await fetch('/api/autosave/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.detail || 'Could not save the autosave setting');
    settings = body.settings;
    start();
    return body;
  }
  function ask(html, onYes, onNo) {
    card.innerHTML = html;
    dialog.hidden = false;
    const yes = card.querySelector('[data-yes]');
    const no = card.querySelector('[data-no]');
    if (yes) yes.onclick = async () => { dialog.hidden = true; await onYes?.(); };
    if (no) no.onclick = () => { dialog.hidden = true; onNo?.(); };
  }
  async function maybeRecover() {
    let body;
    try { body = await refresh(); } catch { return false; }
    start();
    if (!body?.newerThanSave || !body.latest) return false;
    const when = new Date(body.latest.savedAt * 1000).toLocaleString();
    return new Promise((resolve) => {
      ask(`<h2>Recover autosave?</h2><p>An autosave from ${when} is newer than the last save. It is in ${body.dir}.</p><div class="row"><span></span><button class="btn" data-no>Not now</button><button class="btn" data-yes>Recover</button></div>`, async () => {
        const file = await fetch('/api/autosave/file/' + body.latest.file);
        const buf = await file.arrayBuffer();
        await ctx.openProject(buf);
        ctx.status('Recovered the newest autosave');
        resolve(true);
      }, () => resolve(false));
    });
  }
  async function chooseFolder() {
    let native = { needsEntry: true, path: '' };
    try { native = await (await fetch('/api/autosave/choose', { method: 'POST' })).json(); } catch { /* path entry */ }
    const current = native.path || settings.dir || '';
    ask(`<h2>Autosave folder</h2><p>Used until you save the project. After Save, autosaves go next to the project. Leave this blank to use data/autosave/.</p><input id="asPath" class="txt" value="${current.replace(/"/g, '&quot;')}" placeholder="C:\\MeshForge\\autosave or /home/you/autosave"><p id="asErr" class="hint0"></p><div class="row"><span>Every</span><input id="asEvery" type="number" min="30" max="3600" value="${settings.intervalSec || 120}"><b>sec</b></div><div class="row"><span></span><button class="btn" data-no>Cancel</button><button class="btn" data-yes>Use this folder</button></div>`, async () => {
      const path = card.querySelector('#asPath').value.trim();
      const intervalSec = +card.querySelector('#asEvery').value || 120;
      if (path) {
        const chk = await (await fetch('/api/autosave/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })).json();
        if (!chk.ok) { ctx.status(chk.reason || 'That folder is not writable'); return; }
      }
      await saveSettings({ dir: path, intervalSec });
      ctx.status(path ? `Autosave folder: ${path}` : 'Autosave folder: data/autosave/');
    });
  }
  async function saveProject(path) {
    const blob = await ctx.buildProject();
    const r = await fetch('/api/projects/save?path=' + encodeURIComponent(path), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail || 'Save failed');
    settings.projectPath = body.path;
    ctx.status('Saved ' + body.path);
    return body;
  }
  function saveAs() {
    ask(`<h2>Save project</h2><p>Path on this computer. The file is a .mfproj zip (scene.json, GLB, materials, textures).</p><input id="projPath" class="txt" value="${(settings.projectPath || '').replace(/"/g, '&quot;')}" placeholder="/home/you/level.mfproj"><p class="hint0">Autosaves then go in a meshforge-autosave folder next to this file.</p><div class="row"><span></span><button class="btn" data-no>Cancel</button><button class="btn" data-yes>Save</button></div>`, async () => {
      let path = card.querySelector('#projPath').value.trim();
      if (!path) return;
      if (!path.toLowerCase().endsWith('.mfproj')) path += '.mfproj';
      try { await saveProject(path); } catch (err) { ctx.status(err.message); }
    });
  }
  async function save() {
    if (!settings.projectPath) return saveAs();
    try { await saveProject(settings.projectPath); } catch (err) { ctx.status(err.message); }
  }
  return { refresh, write, maybeRecover, chooseFolder, save, saveAs, get settings() { return settings; }, start };
}
