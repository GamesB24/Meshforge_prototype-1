// MeshForge AI Agent Bridge: Voice Input, Speech Synthesis, Tool Calling, and Agent Synchronization.
import * as THREE from 'three';

export function createAgentBridge(ctx) {
  const { scene, editor, getModel, camera, auth, status } = ctx;

  const S = {
    listening: false,
    ws: null,
    connected: false,
    history: [],
    recognition: null,
    ttsEnabled: false, // Muted by default: zero unsolicited noise!
  };

  // ---------- Web Speech API (Voice Recognition) ----------
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    S.recognition = new SpeechRec();
    S.recognition.continuous = false;
    S.recognition.interimResults = false;
    S.recognition.lang = 'en-US';

    S.recognition.onstart = () => {
      S.listening = true;
      updateVoiceUI();
      status('🎙 Listening... Speak your command (e.g., "Build a stone wall", "Spawn a red cube")');
    };

    S.recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      status(`🎙 Heard: "${transcript}"`);
      await executeNaturalLanguage(transcript, 'voice');
    };

    S.recognition.onerror = (err) => {
      console.warn('[SpeechRec Error]', err);
      S.listening = false;
      updateVoiceUI();
      status('Microphone error: ' + (err.error || 'could not capture speech'));
    };

    S.recognition.onend = () => {
      S.listening = false;
      updateVoiceUI();
    };
  }

  function toggleVoice() {
    if (!S.recognition) {
      status('Speech recognition not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (S.listening) S.recognition.stop();
    else {
      try { S.recognition.start(); } catch (e) { S.recognition.stop(); }
    }
  }

  // Voice Push-To-Talk shortcut (V key when not typing)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      if (!S.listening) toggleVoice();
    }
  });

  // ---------- Text-To-Speech (Companion / Agent Voice) ----------
  function speak(text, options = {}) {
    if (!S.ttsEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // Stop prior speech
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = options.rate || 1.05;
    utt.pitch = options.pitch || 1.1; // Friendly slightly higher pitch for bot
    const voices = window.speechSynthesis.getVoices();
    const botVoice = voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Zira') || v.name.includes('David')));
    if (botVoice) utt.voice = botVoice;
    window.speechSynthesis.speak(utt);
  }

  // ---------- WebSocket Agent Bridge ----------
  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/api/agent/ws?client_type=browser&token=${encodeURIComponent(auth?.getToken() || '')}`;
    try {
      S.ws = new WebSocket(wsUrl);
      S.ws.onopen = () => {
        S.connected = true;
        console.log('[AgentBridge] WebSocket connected');
      };
      S.ws.onmessage = async (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'agent_action') {
            await executeTool(msg.action, msg.params);
          }
        } catch (err) {
          console.error('[AgentBridge WS Msg Error]', err);
        }
      };
      S.ws.onclose = () => {
        S.connected = false;
        setTimeout(connectWebSocket, 4000);
      };
    } catch {
      // Offline fallback
    }
  }
  connectWebSocket();

  // ---------- Tool Execution Engine (DCC Actions) ----------
  const TOOLS = {
    // 1. Spawning Primitives & Objects
    spawn_primitive: async ({ type = 'cube', color = '#5588cc', position = [0, 1, 0], scale = [1, 1, 1], name = '' }) => {
      let geo;
      const t = type.toLowerCase();
      if (t === 'sphere') geo = new THREE.SphereGeometry(scale[0] * 0.5, 32, 16);
      else if (t === 'cylinder') geo = new THREE.CylinderGeometry(scale[0] * 0.5, scale[0] * 0.5, scale[1], 24);
      else if (t === 'plane' || t === 'ground') geo = new THREE.PlaneGeometry(scale[0] * 5, scale[2] * 5).rotateX(-Math.PI / 2);
      else if (t === 'torus') geo = new THREE.TorusGeometry(scale[0] * 0.5, scale[0] * 0.15, 16, 32);
      else if (t === 'ramp' || t === 'wedge') {
        geo = new THREE.BufferGeometry();
        const sX = scale[0], sY = scale[1], sZ = scale[2];
        const verts = new Float32Array([
          -sX/2, 0, -sZ/2,   sX/2, 0, -sZ/2,   sX/2, sY, sZ/2,
          -sX/2, 0, -sZ/2,   sX/2, sY, sZ/2,  -sX/2, sY, sZ/2,
          -sX/2, 0, -sZ/2,  -sX/2, 0,  sZ/2,   sX/2, 0,  sZ/2,
          -sX/2, 0, -sZ/2,   sX/2, 0,  sZ/2,   sX/2, 0, -sZ/2,
        ]);
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.computeVertexNormals();
      } else {
        // Default Box / Wall / Barricade
        geo = new THREE.BoxGeometry(scale[0], scale[1], scale[2]);
      }

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.4,
        metalness: 0.2,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name || `${type.charAt(0).toUpperCase() + type.slice(1)}_${Math.floor(Math.random() * 900 + 100)}`;
      mesh.position.set(position[0], position[1], position[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.isPrimitive = true;
      mesh.userData.mf = { slots: ['default'], active: 0, albedo: 'material', vcol: false };

      const root = getModel() || scene;
      root.add(mesh);
      editor.select(mesh);
      status(`Spawned ${mesh.name}`);
      return { ok: true, object_id: mesh.uuid, name: mesh.name };
    },

    // 2. Delete Object
    delete_object: async ({ target = 'selected' }) => {
      let obj = editor.sel;
      if (target !== 'selected' && typeof target === 'string') {
        scene.traverse((o) => { if (o.name.toLowerCase() === target.toLowerCase()) obj = o; });
      }
      if (!obj || obj === getModel()) {
        status('No object selected to delete.');
        return { ok: false, error: 'No target object' };
      }
      const name = obj.name;
      editor.select(null);
      obj.parent?.remove(obj);
      status(`Deleted ${name}`);
      return { ok: true, deleted: name };
    },

    // 3. Transform Object
    transform_object: async ({ position, rotation, scale, target = 'selected' }) => {
      let obj = editor.sel;
      if (target !== 'selected' && typeof target === 'string') {
        scene.traverse((o) => { if (o.name.toLowerCase() === target.toLowerCase()) obj = o; });
      }
      if (!obj) return { ok: false, error: 'No object selected' };
      if (position) obj.position.set(position[0], position[1], position[2]);
      if (rotation) obj.rotation.set(rotation[0] * Math.PI / 180, rotation[1] * Math.PI / 180, rotation[2] * Math.PI / 180);
      if (scale) obj.scale.set(scale[0], scale[1], scale[2]);
      obj.updateMatrixWorld();
      status(`Transformed ${obj.name}`);
      return { ok: true };
    },

    // 4. Set Material Color / Shader
    set_material: async ({ color, roughness, metalness, target = 'selected' }) => {
      let obj = editor.sel;
      if (target !== 'selected' && typeof target === 'string') {
        scene.traverse((o) => { if (o.name.toLowerCase() === target.toLowerCase()) obj = o; });
      }
      if (!obj || !obj.material) return { ok: false, error: 'No object selected' };
      if (color) obj.material.color = new THREE.Color(color);
      if (roughness !== undefined) obj.material.roughness = roughness;
      if (metalness !== undefined) obj.material.metalness = metalness;
      obj.material.needsUpdate = true;
      status(`Updated material for ${obj.name}`);
      return { ok: true };
    },

    // 5. Set Viewport Shading
    set_shading: async ({ mode = 'solid' }) => {
      window.MeshForge.setShading?.(mode);
      status(`Viewport shading set to ${mode}`);
      return { ok: true, shading: mode };
    },

    // 6. Set Environment & Sky
    set_environment: async ({ sky = true, water = true, time = 'day' }) => {
      if (sky && window.MeshForge.addSky) window.MeshForge.addSky();
      if (water && window.MeshForge.addWater) window.MeshForge.addWater();
      status(`Environment updated (Sky: ${sky}, Water: ${water}, Time: ${time})`);
      return { ok: true };
    },

    // 7. Companion Bot Speak
    companion_speak: async ({ text, mood = 'neutral' }) => {
      speak(text);
      if (window.MeshForge.companion?.showBubble) {
        window.MeshForge.companion.showBubble(text, mood);
      }
      return { ok: true };
    },

    // 8. Generate Level Layout (Instant In-Engine Arena / Game Level)
    generate_level: async ({ theme = 'arena', size = 30, obstacles = 8 }) => {
      status(`Constructing procedural ${theme} game level...`);
      // Ground plane
      await TOOLS.spawn_primitive({ type: 'ground', color: '#2b303c', scale: [size, 1, size], position: [0, 0, 0], name: 'Arena_Floor' });
      // Boundary walls
      const half = size / 2;
      const wallMatColor = '#3a4454';
      await TOOLS.spawn_primitive({ type: 'cube', color: wallMatColor, scale: [size, 3, 1], position: [0, 1.5, -half], name: 'Wall_North' });
      await TOOLS.spawn_primitive({ type: 'cube', color: wallMatColor, scale: [size, 3, 1], position: [0, 1.5, half], name: 'Wall_South' });
      await TOOLS.spawn_primitive({ type: 'cube', color: wallMatColor, scale: [1, 3, size], position: [-half, 1.5, 0], name: 'Wall_West' });
      await TOOLS.spawn_primitive({ type: 'cube', color: wallMatColor, scale: [1, 3, size], position: [half, 1.5, 0], name: 'Wall_East' });

      // Scatter tactical cover blocks & pillars
      const colors = ['#e8963a', '#4f7fd6', '#44a08d', '#d64f4f'];
      for (let i = 0; i < obstacles; i++) {
        const x = (Math.random() - 0.5) * (size - 8);
        const z = (Math.random() - 0.5) * (size - 8);
        const h = 1.5 + Math.random() * 2;
        const w = 1.5 + Math.random() * 2;
        const c = colors[i % colors.length];
        const shape = Math.random() > 0.4 ? 'cube' : 'cylinder';
        await TOOLS.spawn_primitive({
          type: shape,
          color: c,
          scale: [w, h, w],
          position: [x, h / 2, z],
          name: `Cover_${i + 1}`,
        });
      }

      // Add atmospheric sky
      if (window.MeshForge.addSky) window.MeshForge.addSky();
      status(`Level generated! Ready to play.`);
      speak('Level constructed! Entering combat arena.');
      return { ok: true, theme, obstacles };
    },

    // 9. Wallet Credit Transfer (Metaverse kiosk transaction)
    transfer_credits: async ({ amount = 100, target = 'Google Agent Wallet', reason = 'Store purchase' }) => {
      if (!auth) return { ok: false, error: 'Auth not initialized' };
      try {
        const res = await auth.wallet.transact({ action: 'transfer', amount, targetAgent: target, reason });
        const user = auth.getUser();
        const msg = `Transferred ${amount} credits to ${target}. New balance: ${res.new_balance}`;
        status(msg);
        speak(`Payment approved! ${amount} credits transferred to your Google Agent wallet.`);
        return { ok: true, balance: res.new_balance };
      } catch (err) {
        status('Transaction failed: ' + err.message);
        speak('Payment declined: insufficient credits in your wallet.');
        return { ok: false, error: err.message };
      }
    },
  };

  async function executeTool(name, params = {}) {
    const fn = TOOLS[name];
    if (!fn) throw new Error(`Unknown tool: ${name}`);
    return await fn(params);
  }

  // ---------- Natural Language Intent Parser ----------
  async function executeNaturalLanguage(input, source = 'text') {
    const text = input.trim();
    if (!text) return;

    addChatMessage('user', text);
    status(`Processing: "${text}"...`);

    // Rule-based offline fast-path parser
    const lower = text.toLowerCase();

    // 1. Spawning objects
    if (lower.startsWith('spawn') || lower.startsWith('create') || lower.startsWith('add') || lower.startsWith('build')) {
      let type = 'cube';
      if (lower.includes('sphere') || lower.includes('ball')) type = 'sphere';
      else if (lower.includes('cylinder') || lower.includes('pillar') || lower.includes('column')) type = 'cylinder';
      else if (lower.includes('plane') || lower.includes('floor') || lower.includes('ground')) type = 'plane';
      else if (lower.includes('ramp') || lower.includes('wedge')) type = 'ramp';
      else if (lower.includes('wall') || lower.includes('barricade') || lower.includes('cover')) type = 'cube';

      let color = '#5588cc';
      if (lower.includes('red')) color = '#e05555';
      else if (lower.includes('green')) color = '#6bbf59';
      else if (lower.includes('blue')) color = '#4f7fd6';
      else if (lower.includes('orange') || lower.includes('gold')) color = '#e8963a';
      else if (lower.includes('dark') || lower.includes('black') || lower.includes('stone')) color = '#333842';
      else if (lower.includes('white') || lower.includes('marble')) color = '#eeeeee';

      let scale = [1, 1, 1];
      if (lower.includes('wall') || lower.includes('barricade')) scale = [3, 2, 0.5];
      else if (lower.includes('pillar')) scale = [1, 4, 1];
      else if (lower.includes('giant') || lower.includes('large') || lower.includes('huge')) scale = [3, 3, 3];

      // Spawn near player or camera focus
      const pos = [0, scale[1] / 2, 0];
      if (window.MeshForge.game?.isPlaying()) {
        const pPos = window.MeshForge.game.getPlayerPosition();
        pos[0] = pPos.x + 2; pos[1] = scale[1] / 2; pos[2] = pPos.z;
      }

      await executeTool('spawn_primitive', { type, color, scale, position: pos });
      addChatMessage('bot', `Spawned a ${color} ${type}.`);
      speak(`Spawned a ${type} for you.`);
      return;
    }

    // 2. Procedural level generation
    if (lower.includes('generate level') || lower.includes('new arena') || lower.includes('create game') || lower.includes('make a level')) {
      await executeTool('generate_level', { theme: 'Sci-Fi Arena', obstacles: 10 });
      addChatMessage('bot', 'Constructed a new battle arena! Press Play to enter.');
      return;
    }

    // 3. Shading & Toon switcher
    if (lower.includes('toon') || lower.includes('chibili') || lower.includes('cel shade')) {
      await executeTool('set_shading', { mode: 'chibili' });
      addChatMessage('bot', 'Switched to Chibili toon render engine.');
      speak('Toon shading activated.');
      return;
    }
    if (lower.includes('wireframe') || lower.includes('wire mode')) {
      await executeTool('set_shading', { mode: 'wire' });
      addChatMessage('bot', 'Shading set to wireframe.');
      return;
    }
    if (lower.includes('solid mode') || lower.includes('solid shading')) {
      await executeTool('set_shading', { mode: 'solid' });
      addChatMessage('bot', 'Shading set to solid.');
      return;
    }

    // 4. Sky and Water
    if (lower.includes('sky') || lower.includes('water') || lower.includes('ocean')) {
      await executeTool('set_environment', { sky: true, water: lower.includes('water') });
      addChatMessage('bot', 'Environment updated.');
      return;
    }

    // 5. Delete
    if (lower.includes('delete') || lower.includes('remove')) {
      const res = await executeTool('delete_object', { target: 'selected' });
      if (res.ok) {
        addChatMessage('bot', `Deleted ${res.deleted}.`);
        speak(`Deleted.`);
      }
      return;
    }

    // 6. Metaverse Credit Transfer / Buying
    if (lower.includes('buy credits') || lower.includes('transfer credits') || lower.includes('pay')) {
      const match = lower.match(/\d+/);
      const amount = match ? parseInt(match[0], 10) : 100;
      await executeTool('transfer_credits', { amount, target: 'Google Agent Wallet' });
      return;
    }

    // 7. General conversational query or companion dialogue
    const reply = `I hear you: "${text}". I am your companion bot ready to build, shoot, or generate 3D assets on your command!`;
    addChatMessage('bot', reply);
    speak(reply);
  }

  // ---------- AI Console UI Panel ----------
  function createUI() {
    let panel = document.getElementById('aiConsole');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'aiConsole';
    panel.className = 'ai-console hidden';
    panel.innerHTML = `
      <div class="ai-header">
        <div class="ai-title"><span class="ai-dot"></span> AI Agent Bridge</div>
        <div class="grow"></div>
        <button id="aiVoiceBtn" class="ai-btn-icon" title="Toggle Voice Push-to-Talk (V)">🎙</button>
        <button id="aiTtsBtn" class="ai-btn-icon" title="Toggle Voice Audio Output (Currently Muted)">🔇</button>
        <button id="aiSettingsBtn" class="ai-btn-icon" title="API Credentials & Cloud Login">⚙</button>
        <button id="aiCloseBtn" class="ai-btn-icon" title="Close">✕</button>
      </div>
      <div id="aiSettings" class="ai-settings hidden">
        <div class="ai-set-row">
          <label>Google Cloud Login:</label>
          <button id="btnGoogleAuth" class="btn-gsi">Sign in with Google</button>
        </div>
        <div class="ai-set-row">
          <label>OpenAI API Key:</label>
          <input id="inpOpenAI" type="password" placeholder="sk-..." class="ai-inp">
          <button id="btnSaveOpenAI" class="btn sm">Save</button>
        </div>
        <div class="ai-set-row">
          <label>Google Gemini Key:</label>
          <input id="inpGemini" type="password" placeholder="AIzaSy..." class="ai-inp">
          <button id="btnSaveGemini" class="btn sm">Save</button>
        </div>
      </div>
      <div id="aiLog" class="ai-log">
        <div class="ai-msg bot">Hello! I am your MeshForge AI agent. You can type commands or press <b>V</b> to speak instructions.</div>
      </div>
      <form id="aiForm" class="ai-form">
        <input id="aiInput" type="text" placeholder="Instruct agent (e.g. 'spawn red barricade', 'build arena')..." autocomplete="off">
        <button type="submit" class="ai-send">Send</button>
      </form>
    `;
    document.body.appendChild(panel);

    // Event hooks
    panel.querySelector('#aiCloseBtn').onclick = () => panel.classList.add('hidden');
    panel.querySelector('#aiVoiceBtn').onclick = () => toggleVoice();
    const ttsBtn = panel.querySelector('#aiTtsBtn');
    ttsBtn.onclick = () => {
      S.ttsEnabled = !S.ttsEnabled;
      ttsBtn.textContent = S.ttsEnabled ? '🔊' : '🔇';
      ttsBtn.title = S.ttsEnabled ? 'Voice Audio Output (Active)' : 'Voice Audio Output (Muted)';
      status(S.ttsEnabled ? 'Voice audio unmuted' : 'Voice audio muted');
    };
    panel.querySelector('#aiSettingsBtn').onclick = () => {
      panel.querySelector('#aiSettings').classList.toggle('hidden');
    };

    // Google Sign-In button
    panel.querySelector('#btnGoogleAuth').onclick = async () => {
      await auth?.loginGoogle({ name: 'Google Creator', email: 'creator@gmail.com' });
    };

    // OpenAI Key Save
    const inpOpenAI = panel.querySelector('#inpOpenAI');
    if (auth?.getOpenAIKey()) inpOpenAI.value = auth.getOpenAIKey();
    panel.querySelector('#btnSaveOpenAI').onclick = async () => {
      const k = inpOpenAI.value.trim();
      if (k) await auth?.loginOpenAI(k);
    };

    // Gemini Key Save
    const inpGemini = panel.querySelector('#inpGemini');
    if (auth?.getGeminiKey()) inpGemini.value = auth.getGeminiKey();
    panel.querySelector('#btnSaveGemini').onclick = () => {
      auth?.setGeminiKey(inpGemini.value.trim());
    };

    panel.querySelector('#aiForm').onsubmit = (e) => {
      e.preventDefault();
      const inp = panel.querySelector('#aiInput');
      const val = inp.value.trim();
      if (val) {
        inp.value = '';
        executeNaturalLanguage(val, 'text');
      }
    };

    return panel;
  }

  function addChatMessage(role, text) {
    const log = document.getElementById('aiLog');
    if (!log) return;
    const item = document.createElement('div');
    item.className = `ai-msg ${role}`;
    item.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  }

  function updateVoiceUI() {
    const btn = document.getElementById('aiVoiceBtn');
    const headerBtn = document.getElementById('topVoiceBtn');
    if (btn) btn.classList.toggle('active', S.listening);
    if (headerBtn) headerBtn.classList.toggle('active', S.listening);
  }

  function toggleConsole(show) {
    const panel = createUI();
    if (show === undefined) panel.classList.toggle('hidden');
    else if (show) panel.classList.remove('hidden');
    else panel.classList.add('hidden');
  }

  createUI();

  return {
    toggleConsole,
    toggleVoice,
    speak,
    executeNaturalLanguage,
    executeTool,
    tools: TOOLS,
    isListening: () => S.listening,
  };
}
