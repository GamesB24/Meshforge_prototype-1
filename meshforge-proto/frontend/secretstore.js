// Session-only plugin secrets. The map lives in memory. Nothing here writes
// to localStorage, sessionStorage, cookies, or disk.
// Original MIT code.

const NAME = /^[A-Za-z0-9_-]+$/;

export function secretStatus({ name, held, used, pluginId, pluginName }) {
  const who = pluginName || pluginId || 'This plugin';
  const photo = pluginId === 'scene-from-photo' || /scene from photo/i.test(pluginName || '');
  if (!held) return `${name}: no key for this session.`;
  const base = `${name}: key held for this session, not verified.`;
  const tail = ' It is not saved, and it is cleared when this tab is closed.';
  if (!used) {
    const extra = photo
      ? ' Scene From Photo does not call a model provider yet, so entering the key will not sign you in or change the scene.'
      : ` ${who} has not used the key yet.`;
    return base + extra + tail;
  }
  const extra = photo
    ? ' The plugin attached it to a request, but its backend does not call a model provider yet, so nothing visible will change.'
    : ' The plugin attached it to a request. MeshForge does not check it with the provider.';
  return base + extra + tail;
}

export function createSecretStore(meta = {}) {
  const secrets = new Map();
  const used = new Set();
  function status(name) {
    return secretStatus({ name, held: secrets.has(name), used: used.has(name), pluginId: meta.pluginId, pluginName: meta.pluginName });
  }
  return {
    set(name, value) {
      if (!NAME.test(name)) throw new Error('Invalid secret name');
      const text = value == null ? '' : String(value);
      if (!text) { secrets.delete(name); used.delete(name); return status(name); }
      secrets.set(name, text);
      return status(name);
    },
    get: (name) => secrets.get(name),
    has: (name) => secrets.has(name),
    clear() { secrets.clear(); used.clear(); },
    markUsed(name) { if (secrets.has(name)) used.add(name); },
    header(name) {
      if (!secrets.has(name)) return {};
      used.add(name);
      return { ['X-Plugin-Secret-' + name]: secrets.get(name) };
    },
    status,
    // True when the page is actually going away. Back-forward cache must keep the key.
    shouldClearOnPageHide(event) { return !event?.persisted; },
  };
}
