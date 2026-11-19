# Contributing to MeshForge

MeshForge is MIT. Contributions should be original MIT code. Do not copy source, names, logos or assets from GPL programs.

## Setup

Use the Windows steps in `meshforge-proto/WINDOWS.md` or the Linux steps in the root README. The editor is `meshforge-proto/frontend/`. The server is `meshforge-proto/meshforge/`.

## Checks

From `meshforge-proto`:

```bash
node scripts/test_v8_logic.mjs
python scripts/test_v8_server.py
```

The browser check needs Chrome and `puppeteer-core`:

```bash
node scripts/test_v8_browser.mjs "http://127.0.0.1:8000/?noautosave=1"
```

## Secrets

Never commit API keys, tokens, `.env` files, `*.mfproj` projects, autosaves, or `plugins/*/secrets*`. Plugin keys are session-only. A test that needs a fake key must assert the key is absent from the repo afterwards.

## Pull requests

Describe what changed, how you tested it, and what you could not test (Windows, a real GPU, TripoSR weights, a real mouse). Keep `window.MeshForge` and scene.json version 1 working. New plugin hooks should be additive.
