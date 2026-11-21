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

  const GIS_REASONS = {
    1: 'browser_not_supported',
    2: 'invalid_client',
    3: 'missing_client_id',
    4: 'opt_out_or_no_session',
    5: 'secure_http_required',
    6: 'suppressed_by_user',
    7: 'unregistered_origin',
    8: 'unknown_reason',
    browser_not_supported: 'browser_not_supported',
    invalid_client: 'invalid_client',
    missing_client_id: 'missing_client_id',
    opt_out_or_no_session: 'opt_out_or_no_session',
    secure_http_required: 'secure_http_required',
    suppressed_by_user: 'suppressed_by_user',
    unregistered_origin: 'unregistered_origin',
    unknown_reason: 'unknown_reason',
  };

  function describeGoogleFailure(code, extra) {
    const origin = location.origin;
    const key = GIS_REASONS[code] || code || 'unknown_reason';
    const detail = {
      no_client_id: 'No OAuth client ID is saved in this browser.',
      bad_client_id: 'The client ID does not look like a Web client (it should end in .apps.googleusercontent.com). Desktop, Android and iOS clients will not work on this page.',
      script_blocked: 'The Google sign-in script did not load. Check the network, then try again.',
      browser_not_supported: 'This browser cannot show the Google prompt.',
      invalid_client: 'Google rejected the client ID. Create an OAuth client ID of type Web application, not Desktop or Android.',
      missing_client_id: 'Google received no client ID.',
      opt_out_or_no_session: 'Google skipped the prompt because there is no signed-in session, or the prompt was dismissed. Try again.',
      secure_http_required: 'Google only allows http://localhost or https. Open the page on localhost, or use https.',
      suppressed_by_user: 'The prompt is in a cooldown. Wait a moment, or clear the site’s Google cookies, then try again.',
      unregistered_origin: `Origin mismatch. In Google Cloud, Authorised JavaScript origins must include exactly ${origin}. Add http://localhost and http://127.0.0.1 as separate entries when the port differs.`,
      unknown_reason: 'Google did not show the sign-in prompt.',
      backend_down: 'The MeshForge Python server is not running, so the ID token cannot be checked. Start it, then sign in again.',
      token_rejected: 'Google or the MeshForge server rejected the ID token.',
    }[key] || extra || 'Google sign-in failed.';
    return [
      detail,
      extra && extra !== detail ? extra : '',
      `This page’s origin is ${origin}.`,
      'Setup: Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.',
      `Authorised JavaScript origins: add ${origin} exactly (scheme, host and port). If you open both localhost and 127.0.0.1, add each one.`,
      'OAuth consent screen: if Publishing status is Testing, add the Google account you sign in with under Test users.',
      'The MeshForge backend must be running so POST /api/auth/google can verify the token.',
      'This sign-in identifies you. It does not create a Gemini API key. Save a Gemini key separately.',
    ].filter(Boolean).join(' ');
  }

  async function checkGoogleSetup() {
    const id = googleClientId();
    const notes = [];
    if (!id) notes.push(describeGoogleFailure('no_client_id'));
    else if (!id.endsWith('.apps.googleusercontent.com')) notes.push(describeGoogleFailure('bad_client_id'));
    else notes.push(`Client ID is saved. This page’s origin is ${location.origin}. That exact origin must be an Authorised JavaScript origin on a Web application OAuth client.`);
    try {
      const res = await fetch('/api/auth/session');
      if (!res.ok) notes.push(describeGoogleFailure('backend_down'));
      else notes.push('The MeshForge server answered /api/auth/session.');
    } catch {
      notes.push(describeGoogleFailure('backend_down'));
    }
    const message = notes.join(' ');
    status(message);
    return { ok: !!id && id.endsWith('.apps.googleusercontent.com'), message };
  }

  // Google Identity Services. This identifies the user. It does not mint a Gemini API key.
  async function loginGoogle(credential) {
    const clientId = googleClientId();
    if (!credential) {
      if (!clientId) throw new Error(describeGoogleFailure('no_client_id'));
      if (!clientId.endsWith('.apps.googleusercontent.com')) throw new Error(describeGoogleFailure('bad_client_id'));
      try { await loadGoogleScript(); }
      catch (err) { throw new Error(describeGoogleFailure('script_blocked', err.message)); }
      return new Promise((resolve, reject) => {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp) => {
            try { resolve(await loginGoogle(resp.credential)); }
            catch (err) { reject(err); }
          },
        });
        window.google.accounts.id.prompt((n) => {
          if (n.isNotDisplayed?.() || n.isSkippedMoment?.()) {
            const code = n.getNotDisplayedReason?.() || n.getSkippedReason?.() || 'unknown_reason';
            reject(new Error(describeGoogleFailure(code)));
          }
        });
      });
    }
    status('Checking the Google sign-in with the MeshForge server...');
    let res;
    try {
      res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, client_id: clientId }),
      });
    } catch (err) {
      throw new Error(describeGoogleFailure('backend_down', err.message));
    }
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (res.status === 404 || res.status === 501) throw new Error(describeGoogleFailure('backend_down'));
    if (!res.ok || !data.ok) throw new Error(describeGoogleFailure(res.status === 401 ? 'token_rejected' : 'token_rejected', data.detail || data.message || `HTTP ${res.status}`));
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
    checkGoogleSetup,
    describeGoogleFailure,
    loginOpenAI,
    logout,
    wallet: {
      get: () => S.user.wallet_credits,
      transact: processWalletTransaction,
    },
  };
}
