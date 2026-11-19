# Security

MeshForge runs on your machine. The browser and the local server share one process boundary with any plugin you install. Plugins are trusted code. There is no sandbox.

## Secrets are session-only

A plugin may ask for an API key through `mf.secrets`. That value lives in a JavaScript map for the tab:

- It is not written to `localStorage`, `sessionStorage`, cookies, autosaves, `.mfproj` files, `plugins-state.json`, job folders, or logs.
- `secrets.set` does not call the server. If the plugin list failed to load, there is no key field until you reload with the server running. That is a missing plugin, not a rejected key.
- The status line says the key is held for this session and is not verified. MeshForge does not check it with a provider.
- If the plugin never attaches the key to a request, the status says the plugin has not used it yet.
- The key is cleared when the tab is closed. A back-forward cache restore keeps it. Reload clears it, because the map is gone.
- The server redacts `X-Plugin-Secret-*` header values if a log line contains them. Do not log the header yourself inside a plugin.

There is no MeshForge account and no OAuth login. A plugin that shows a key field is not signing you in. Scene From Photo (not in this repo) stores a Google key and does not call a model provider yet, so nothing in the view changes when you enter it.

## What not to commit

`data/` job output, `data/autosave/`, `*.mfproj`, `.env*`, `plugins/*/secrets*` and plugin folders other than `_example` are gitignored. Do not force-add them.

## Reporting

Open a private GitHub security advisory on this repository, or contact the owner directly. Say what you saw and which version. Do not paste a real API key, token, or a scene you do not want public. A fake value is enough.
