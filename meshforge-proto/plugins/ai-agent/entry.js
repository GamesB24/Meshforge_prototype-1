// AI Agent panel. Keys stay in mf.secrets. Tools are the whitelist in tools.js.
// Original MIT code. No eval.
import { TOOLS, runTool } from './tools.js';

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'openai', label: 'OpenAI ChatGPT' },
  { id: 'xai', label: 'xAI Grok' },
  { id: 'compatible', label: 'OpenAI-compatible (Ollama and others)' },
];

export async function activate(mf) {
  const { panel } = mf.registerTab({ id: 'agent', label: 'Agent', onEnter() {}, onLeave() {} });
  panel.innerHTML = `
    <details open><summary>Connect</summary>
      <div class="row"><span>Provider</span><select id="aiProv" class="txt"></select></div>
      <div class="row" id="aiBaseRow" hidden><span>Base URL</span><input id="aiBase" class="txt" placeholder="http://127.0.0.1:11434/v1"></div>
      <div class="row"><span>Model</span><select id="aiModel" class="txt"></select></div>
      <label class="hint0">API key, this session only</label>
      <input id="aiKey" type="password" class="txt" autocomplete="new-password">
      <div class="row"><button class="primary" id="aiConnect" type="button">Connect</button><button class="btn" id="aiDisc" type="button">Disconnect</button></div>
      <div id="aiStatus" class="hint0">Not connected. Connect checks the key with one small request. The key is not saved.</div>
      <label class="hint0">Optional Google key for the four-view step (Gemini). Also session only.</label>
      <input id="aiGoogle" type="password" class="txt" autocomplete="new-password" placeholder="Google key, optional">
    </details>
    <details open><summary>Chat</summary>
      <label class="row chk"><input id="aiAsk" type="checkbox"> Ask before each action</label>
      <label class="row chk"><input id="aiSpeak" type="checkbox"> Speak replies</label>
      <div id="aiLog" style="max-height:240px;overflow:auto;background:#1b1b1b;border-radius:4px;padding:6px;margin:6px 0"></div>
      <div id="aiMicNote" class="hint0" hidden></div>
      <div class="row"><button class="btn" id="aiMic" type="button" title="Speech to text">Mic</button><button class="btn" id="aiStop" type="button">Stop</button></div>
      <textarea id="aiBox" class="txt" rows="3" placeholder="Ask for a material, a landscape, or drop an image"></textarea>
      <div class="row"><button class="primary" id="aiSend" type="button">Send</button><button class="btn" id="aiImg" type="button">Drop image</button></div>
      <input id="aiFile" type="file" accept="image/*" hidden>
      <div class="hint0">Text-to-image and the four-view step spend API credit. Voxel carve and TripoSR do not call those image APIs. Delete always asks first.</div>
    </details>`;
  const q = (id) => panel.querySelector(id);
  const prov = q('#aiProv');
  PROVIDERS.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; prov.appendChild(o); });
  const modelSel = q('#aiModel');
  function fillModels(list) {
    const cur = modelSel.value;
    modelSel.replaceChildren();
    (list.length ? list : ['custom']).forEach((id) => { const o = document.createElement('option'); o.value = id; o.textContent = id; modelSel.appendChild(o); });
    if (cur) modelSel.value = cur;
  }
  fillModels(['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest']);
  prov.onchange = () => {
    q('#aiBaseRow').hidden = prov.value !== 'compatible';
    const presets = { anthropic: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'], openai: ['gpt-4o-mini', 'gpt-4o'], xai: ['grok-2-latest', 'grok-2-image'], compatible: [] };
    fillModels(presets[prov.value] || []);
  };
  const state = { provider: 'anthropic', model: '', base: '', images: [], views: [], stop: false, busy: false };
  const log = q('#aiLog');
  function line(who, text) {
    const row = document.createElement('div');
    row.style.margin = '4px 0';
    const b = document.createElement('b'); b.textContent = who + ': ';
    row.append(b, document.createTextNode(text));
    log.appendChild(row); log.scrollTop = log.scrollHeight;
    if (q('#aiSpeak').checked && who === 'Assistant' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.slice(0, 400)));
    }
  }
  function setStatus(text) { q('#aiStatus').textContent = text; }
  q('#aiConnect').onclick = async () => {
    const key = q('#aiKey').value;
    q('#aiKey').value = '';
    const google = q('#aiGoogle').value;
    q('#aiGoogle').value = '';
    if (!key) { setStatus('Invalid key'); return; }
    mf.secrets.set('Provider', key);
    if (google) mf.secrets.set('Google', google);
    state.provider = prov.value;
    state.base = q('#aiBase').value.trim();
    state.model = modelSel.value;
    setStatus('Checking the key…');
    try {
      const res = await mf.backend('connect', { method: 'POST', headers: { ...mf.secrets.header('Provider'), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: state.provider, base: state.base, model: state.model }) });
      const data = await res.json();
      if (data.status === 'connected') {
        if (data.models?.length) fillModels(data.models);
        state.model = modelSel.value;
        setStatus('Connected');
      } else if (data.status === 'invalid') {
        mf.secrets.set('Provider', '');
        setStatus('Invalid key');
      } else {
        mf.secrets.set('Provider', '');
        setStatus('Network error');
      }
    } catch {
      mf.secrets.set('Provider', '');
      setStatus('Network error');
    }
  };
  q('#aiDisc').onclick = () => {
    mf.secrets.clear();
    state.views = [];
    setStatus('Disconnected. The key is cleared.');
    line('Agent', 'disconnected');
  };
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) {
    q('#aiMic').hidden = true;
    const note = q('#aiMicNote');
    note.hidden = false;
    note.textContent = 'Speech input needs Chrome or Edge (the Web Speech API). This browser does not have it. Typing still works.';
  } else {
    const rec = new Rec();
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (ev) => { q('#aiBox').value = (q('#aiBox').value ? q('#aiBox').value + ' ' : '') + ev.results[0][0].transcript; };
    rec.onerror = () => line('Agent', 'the microphone did not return text');
    q('#aiMic').onclick = () => { try { rec.start(); line('Agent', 'listening…'); } catch { line('Agent', 'the microphone is already on or was blocked'); } };
  }
  q('#aiStop').onclick = () => { state.stop = true; if (window.speechSynthesis) window.speechSynthesis.cancel(); line('Agent', 'stopped'); };
  q('#aiImg').onclick = () => q('#aiFile').click();
  q('#aiFile').onchange = () => { const f = q('#aiFile').files[0]; if (f) readImage(f); q('#aiFile').value = ''; };
  panel.addEventListener('dragover', (e) => e.preventDefault());
  panel.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer?.files || [])].find((file) => file.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    readImage(f);
  });
  function readImage(file) {
    const reader = new FileReader();
    reader.onload = () => { state.images.push(reader.result); line('You', 'dropped an image (' + state.images.length + ')'); };
    reader.readAsDataURL(file);
  }
  async function confirm(text) { return window.confirm(text); }
  const ctx = {
    api: mf.api,
    provider: '',
    base: '',
    imageModel: '',
    images: state.images,
    views: state.views,
    ask: false,
    confirm,
    backend: (path, opts) => mf.backend(path, opts),
    secretHeaders: () => mf.secrets.header('Provider'),
    googleHeaders: () => mf.secrets.header('Google'),
    rememberImage(url) { state.images.push(url); line('Agent', 'stored the image in the chat'); },
    rememberViews(list) { state.views = list; line('Agent', 'stored four views'); },
  };
  async function turn(text) {
    if (state.busy) return;
    if (q('#aiStatus').textContent !== 'Connected') { line('Agent', 'connect a provider first'); return; }
    state.busy = true; state.stop = false;
    ctx.provider = prov.value; ctx.base = q('#aiBase').value.trim(); ctx.ask = q('#aiAsk').checked;
    ctx.images = state.images; ctx.views = state.views;
    const messages = state.messages;
    messages.push({ role: 'user', content: text });
    line('You', text);
    try {
      for (let step = 0; step < 6 && !state.stop; step++) {
        const res = await mf.backend('chat', { method: 'POST', headers: { ...mf.secrets.header('Provider'), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: ctx.provider, base: ctx.base, model: modelSel.value, messages, tools: TOOLS }) });
        const data = await res.json();
        if (!data.ok) { line('Agent', data.message || 'Network error'); break; }
        if (data.text) line('Assistant', data.text);
        const calls = data.tool_calls || [];
        if (!calls.length) break;
        messages.push({ role: 'assistant', content: data.text || '', tool_calls: calls });
        for (const call of calls) {
          if (state.stop) break;
          const outcome = await runTool(ctx, call.name, call.arguments || {});
          line('Agent', outcome.summary.replace(/^Agent:\s*/, ''));
          messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: outcome.text });
        }
      }
    } catch {
      line('Agent', 'Network error');
    } finally {
      state.busy = false;
    }
  }
  state.messages = [{ role: 'system', content: 'You edit a 3D level in MeshForge. Use only the provided tools. Say when a step spends API credit. Do not invent tools.' }];
  q('#aiSend').onclick = () => { const text = q('#aiBox').value.trim(); q('#aiBox').value = ''; if (text) turn(text); };
}

export function deactivate() {}
