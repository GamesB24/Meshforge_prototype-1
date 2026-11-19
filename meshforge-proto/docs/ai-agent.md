# AI Agent plugin

The Agent tab is a normal MeshForge plugin in `plugins/ai-agent/`. It uses `mf.registerTab`, `mf.api` (`window.MeshForge`), `mf.secrets`, and `mf.backend`. It does not run code the model writes. There is no `eval`.

## Connect

Pick a provider:

| Provider | Endpoint the plugin calls |
|---|---|
| Anthropic Claude | `https://api.anthropic.com` |
| OpenAI ChatGPT | `https://api.openai.com/v1` |
| xAI Grok | `https://api.x.ai/v1` |
| OpenAI-compatible | The base URL you type. This covers Ollama (`http://127.0.0.1:11434/v1`) and other local servers |

Paste an API key and press **Connect**. The key is put in `mf.secrets` under the name `Provider` and sent only on that request as `X-Plugin-Secret-Provider`. The plugin backend reads the header and makes one cheap models request. The page then shows **Connected**, **Invalid key**, or **Network error**. Disconnect, closing the tab, or leaving the page clears the key. It is not written to disk, autosave, or logs.

An optional Google key (`X-Plugin-Secret-Google`) is used only for the four-view step.

## Chat and voice

Type in the box, or use **Mic** where the browser has the Web Speech API (`SpeechRecognition`). That is Chrome and Edge, including Windows. Other browsers hide the button and say speech input is unavailable. **Speak replies** uses `speechSynthesis`. **Stop** ends the current turn. **Ask before each action** confirms every tool except that delete always asks on its own.

Drop an image on the chat to attach it. The agent can send that image to the existing TripoSR job.

## Tools

The model only sees the names in `plugins/ai-agent/tools.js`. Each editor change goes through `MeshForge.actions` (or an existing undoable API such as duplicate, delete, and material assign) so it is one undo step.

- List and select objects
- Add a cube, sphere, plane, sky, or water
- Move, rotate, scale
- Duplicate, and delete after you confirm
- Create, duplicate, assign, and edit materials (colour and Chibili fields)
- Set mode, set camera, select all in Edit Mode
- Generate or edit the landscape, and send it into the level
- Decimate, retopo, snap to floor
- Start a generate job from a dropped image
- Export GLB or OBJ

## Text to image, and four views

**Text to image** calls the provider image API when that provider has one (OpenAI images, xAI image, or a compatible `/images/generations` endpoint). The chat says this spends API credit. Anthropic has no image call here.

**Make views** is optional. It uses Google's Gemini image model and the separate Google key. It makes four paid calls: front, back, left, right. The chat says that before the pictures are used.

**Views to mesh** then either:

- `carve` (default): `meshOps.voxelCarve` from those four silhouettes, added as one undoable mesh, or
- `triposr`: the front view only, through the existing single-image generator

Voxel carve and TripoSR do not call the image APIs again.

## Tests

`scripts/test_v8_agent_tools.mjs` runs the whitelist against a fake editor. `scripts/test_v8_server.py` points the plugin at a local mock provider. Neither test calls Anthropic, OpenAI, xAI, or Google, and neither spends credit.
