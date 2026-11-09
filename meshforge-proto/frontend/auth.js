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

  // Google Sign-In
  async function loginGoogle(credentialOrProfile) {
    status('Signing in with Google...');
    try {
      const payload = typeof credentialOrProfile === 'string'
        ? { credential: credentialOrProfile }
        : { profile: credentialOrProfile };

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Google authentication failed');
      const data = await res.json();
      if (data.ok) {
        S.token = data.token;
        S.user = data.user;
        localStorage.setItem('mf_auth_token', S.token);
        dispatchUpdate();
        status(`Welcome, ${S.user.name}! Connected to Google Agent Wallet.`);
        return S.user;
      }
    } catch (err) {
      status('Sign-in error: ' + err.message);
      // Fallback local simulation if server offline
      S.user = {
        user_id: 'google_local_dev',
        email: 'creator@gmail.com',
        name: 'Google Creator',
        picture: 'https://www.gstatic.com/images/branding/product/1x/avatar_circle_blue_512dp.png',
        provider: 'google',
        wallet_credits: 1000,
      };
      dispatchUpdate();
      return S.user;
    }
  }

  // OpenAI Connect
  async function loginOpenAI(apiKey, nickname = 'OpenAI Pilot') {
    status('Verifying OpenAI API credentials...');
    const key = apiKey?.trim();
    if (!key) throw new Error('API key required');

    try {
      const res = await fetch('/api/auth/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, nickname }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to authenticate OpenAI key');
      }

      const data = await res.json();
      S.token = data.token;
      S.user = data.user;
      S.openaiKey = key;
      localStorage.setItem('mf_auth_token', S.token);
      localStorage.setItem('mf_openai_key', key);
      dispatchUpdate();
      status(`Connected as ${S.user.name}. OpenAI models unlocked!`);
      return S.user;
    } catch (err) {
      // Local storage fallback
      S.openaiKey = key;
      localStorage.setItem('mf_openai_key', key);
      S.user = {
        user_id: 'openai_local',
        email: `sk-...${key.slice(-4)}@openai.agent`,
        name: nickname,
        picture: '',
        provider: 'openai',
        wallet_credits: 1000,
      };
      dispatchUpdate();
      status('OpenAI key saved locally.');
      return S.user;
    }
  }

  // Gemini API Key config
  function setGeminiKey(key) {
    S.geminiKey = key?.trim() || '';
    if (S.geminiKey) localStorage.setItem('mf_gemini_key', S.geminiKey);
    else localStorage.removeItem('mf_gemini_key');
    status('Gemini API key updated.');
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
    getOpenAIKey: () => S.openaiKey,
    getGeminiKey: () => S.geminiKey,
    setGeminiKey,
    loginGoogle,
    loginOpenAI,
    logout,
    wallet: {
      get: () => S.user.wallet_credits,
      transact: processWalletTransaction,
    },
  };
}
