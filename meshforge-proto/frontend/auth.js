// MeshForge Authentication & Agent Wallet Service
// Supports Google Identity Services, OpenAI authentication, and in-game wallet balances.

export function createAuth(ctx) {
  const S = {
    user: {
      user_id: 'guest',
      email: 'guest@meshforge.local',
      name: 'Guest Creator',
      picture: '',
      provider: 'guest',
      wallet_credits: 500,
    },
    token: localStorage.getItem('mf_auth_token') || '',
    openaiKey: localStorage.getItem('mf_openai_key') || '',
    geminiKey: localStorage.getItem('mf_gemini_key') || '',
  };

  const status = (m) => ctx?.status ? ctx.status(m) : console.log('[Auth]', m);

  // Initialize session from server or storage
  async function initSession() {
    try {
      const res = await fetch('/api/auth/session', {
        headers: S.token ? { 'Authorization': `Bearer ${S.token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.user) {
          S.user = data.user;
          dispatchUpdate();
        }
      }
    } catch {
      // Offline fallback: load cached profile from localStorage
      const cached = localStorage.getItem('mf_cached_user');
      if (cached) {
        try { S.user = JSON.parse(cached); } catch {}
      }
      dispatchUpdate();
    }
  }

  function dispatchUpdate() {
    localStorage.setItem('mf_cached_user', JSON.stringify(S.user));
    window.dispatchEvent(new CustomEvent('mf-auth-changed', { detail: { user: S.user } }));
    window.dispatchEvent(new CustomEvent('mf-wallet-changed', { detail: { credits: S.user.wallet_credits } }));
  }

  const PROVIDERS = ['openai', 'anthropic', 'gemini', 'xai', 'custom'];

  function readKeys() {
    try { return JSON.parse(localStorage.getItem('mf_provider_keys') || '{}'); } catch { return {}; }
  }
  function writeKeys(map) {
    localStorage.setItem('mf_provider_keys', JSON.stringify(map));
    S.openaiKey = map.openai?.apiKey || '';
    S.geminiKey = map.gemini?.apiKey || '';
    if (S.openaiKey) localStorage.setItem('mf_openai_key', S.openaiKey); else localStorage.removeItem('mf_openai_key');
    if (S.geminiKey) localStorage.setItem('mf_gemini_key', S.geminiKey); else localStorage.removeItem('mf_gemini_key');
  }

  async function testProviderKey(provider, apiKey, baseUrl = '') {
    const res = await fetch('/api/auth/keys/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl }),
    });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const down = res.status === 404 || res.status === 501;
      const fallback = down
        ? 'The MeshForge API is not running on this address, so the key was not saved. Start the Python server and try again.'
        : `Server returned HTTP ${res.status}`;
      return { ok: false, provider, message: data.detail || data.message || fallback };
    }
    return data;
  }

  async function saveProviderKey(provider, apiKey, baseUrl = '') {
    const key = (apiKey || '').trim();
    if (!PROVIDERS.includes(provider)) throw new Error('Unknown provider');
    if (!key) throw new Error('Enter an API key first.');
    let result;
    try { result = await testProviderKey(provider, key, baseUrl); }
    catch (err) { throw new Error('The MeshForge server is not running, so the key could not be checked. Start it, then try again. ' + err.message); }
    if (!result.ok) throw new Error(result.message || 'The provider rejected this key.');
    const map = readKeys();
    map[provider] = { apiKey: key, baseUrl: baseUrl || '', checkedAt: Date.now() };
    writeKeys(map);
    status(result.message);
    return result;
  }

  function googleClientId() { return localStorage.getItem('mf_google_client_id') || ''; }
  function setGoogleClientId(id) {
    const v = (id || '').trim();
    if (v) localStorage.setItem('mf_google_client_id', v);
    else localStorage.removeItem('mf_google_client_id');
  }

  function loadGoogleScript() {
    if (window.google?.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.getElementById('mf-gsi');
      if (existing) { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', () => reject(new Error('Could not load Google sign-in.'))); return; }
      const s = document.createElement('script');
      s.id = 'mf-gsi';
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load Google sign-in. Check the network.'));
      document.head.appendChild(s);
    });
  }

  // Google Identity Services. This identifies the user. It does not mint a Gemini API key.
  async function loginGoogle(credential) {
    const clientId = googleClientId();
    if (!credential) {
      if (!clientId) throw new Error('Paste a Google OAuth client ID first. Create a Web client in Google Cloud Console, add this page as an authorised origin, then sign in. Google sign-in does not create a Gemini API key; save a Gemini key separately.');
      await loadGoogleScript();
      return new Promise((resolve, reject) => {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp) => {
            try { resolve(await loginGoogle(resp.credential)); }
            catch (err) { reject(err); }
          },
        });
        window.google.accounts.id.prompt((n) => {
          if (n.isNotDisplayed?.() || n.isSkippedMoment?.()) reject(new Error('Google did not show the sign-in prompt. Check the OAuth client ID and that this site is an authorised JavaScript origin.'));
        });
      });
    }
    status('Checking the Google sign-in with the MeshForge server...');
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential, client_id: clientId }),
    });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || !data.ok) throw new Error(data.detail || data.message || `Google sign-in failed (HTTP ${res.status}). The server must be running.`);
    S.token = data.token;
    S.user = data.user;
    localStorage.setItem('mf_auth_token', S.token);
    dispatchUpdate();
    status(`Signed in as ${S.user.name}. A Gemini API key is still separate from this login.`);
    return S.user;
  }

  async function loginOpenAI(apiKey, nickname = 'OpenAI') {
    const result = await saveProviderKey('openai', apiKey);
    S.user = { ...S.user, name: nickname || S.user.name, provider: 'openai' };
    dispatchUpdate();
    return result;
  }

  function setGeminiKey(key) {
    return saveProviderKey('gemini', key);
  }

  // Wallet operations (kiosk purchases, agent transfers)
  async function processWalletTransaction({ action = 'credit', amount = 100, reason = 'Metaverse kiosk', targetAgent = 'Google Assistant' } = {}) {
    try {
      const res = await fetch('/api/auth/wallet/transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': S.token ? `Bearer ${S.token}` : '',
        },
        body: JSON.stringify({ action, amount, reason, target_agent: targetAgent }),
      });
      if (res.ok) {
        const data = await res.json();
        S.user.wallet_credits = data.new_balance;
        dispatchUpdate();
        return data;
      }
    } catch {
      // Fallback local balance update
    }

    if (action === 'debit' || action === 'transfer') {
      if (S.user.wallet_credits < amount) {
        throw new Error(`Insufficient credits (Current: ${S.user.wallet_credits})`);
      }
      S.user.wallet_credits -= amount;
    } else {
      S.user.wallet_credits += amount;
    }
    dispatchUpdate();
    return { ok: true, action, amount, new_balance: S.user.wallet_credits, reason, targetAgent };
  }

  function logout() {
    S.user = {
      user_id: 'guest',
      email: 'guest@meshforge.local',
      name: 'Guest Creator',
      picture: '',
      provider: 'guest',
      wallet_credits: 500,
    };
    S.token = '';
    localStorage.removeItem('mf_auth_token');
    dispatchUpdate();
    status('Signed out to Guest mode.');
    try { fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  }

  initSession();

  return {
    getUser: () => ({ ...S.user }),
    getToken: () => S.token,
    getOpenAIKey: () => readKeys().openai?.apiKey || S.openaiKey,
    getGeminiKey: () => readKeys().gemini?.apiKey || S.geminiKey,
    getProviderKey: (provider) => readKeys()[provider] || null,
    setGeminiKey,
    saveProviderKey,
    testProviderKey,
    googleClientId,
    setGoogleClientId,
    loginGoogle,
    loginOpenAI,
    logout,
    wallet: {
      get: () => S.user.wallet_credits,
      transact: processWalletTransaction,
    },
  };
}
