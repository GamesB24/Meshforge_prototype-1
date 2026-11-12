// Round 3: sign-in does not fake success, Add sphere keeps the scene, agent tools are discoverable.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const puppeteer = createRequire(process.env.PUPPETEER_PKG || '/tmp/mf-test/package.json')('puppeteer-core');
const base = process.argv[2] || 'http://127.0.0.1:8765/frontend/index.html';
const outDir = process.env.SHOTS || '/opt/cursor/artifacts';
await mkdir(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--window-size=1400,900'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.setViewport({ width: 1400, height: 900 });
const url = new URL(base);
url.searchParams.set('noautosave', '1');
await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.MeshForge?.agent?.listTools && window.__meshforge?.newSphere, { timeout: 30000 });
const report = { ok: true, checks: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (!pass) report.ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`);
}

const signin = await page.evaluate(async () => {
  document.getElementById('btnOpenAIConsole')?.click();
  document.getElementById('aiSettingsBtn')?.click();
  const providers = [...document.querySelectorAll('#inpProvider option')].map((o) => o.value);
  const before = window.MeshForge.auth.getUser().name;
  document.getElementById('btnGoogleAuth').click();
  await new Promise((r) => setTimeout(r, 50));
  const afterGoogle = window.MeshForge.auth.getUser().name;
  const googleMsg = document.getElementById('keyStatus').textContent;
  document.getElementById('inpKey').value = '';
  document.getElementById('btnSaveKey').click();
  await new Promise((r) => setTimeout(r, 30));
  const emptyMsg = document.getElementById('keyStatus').textContent;
  document.getElementById('inpKey').value = 'sk-not-a-real-key';
  document.getElementById('btnSaveKey').click();
  await new Promise((r) => setTimeout(r, 200));
  const rejected = document.getElementById('keyStatus').textContent;
  const stored = localStorage.getItem('mf_provider_keys') || '';
  localStorage.setItem('mf_provider_keys', JSON.stringify({ openai: { apiKey: 'sk-secret-should-not-export' } }));
  const projectText = window.MeshForge.project.serializeText();
  localStorage.removeItem('mf_provider_keys');
  return { providers, before, afterGoogle, googleMsg, emptyMsg, rejected, stored, leaked: projectText.includes('sk-secret-should-not-export') };
});
check('settings list every provider', ['openai', 'anthropic', 'gemini', 'xai', 'custom'].every((id) => signin.providers.includes(id)), signin.providers);
check('Google sign-in without a client ID does not invent a user', signin.afterGoogle === signin.before && /client ID/i.test(signin.googleMsg), signin);
check('an empty key is rejected and a failed check is not stored', /API key/i.test(signin.emptyMsg) && !signin.stored.includes('sk-not-a-real-key'), signin);
check('project files do not contain API keys', signin.leaked === false, { leaked: signin.leaked });
await page.screenshot({ path: `${outDir}/agent_signin_settings.png` });

const added = await page.evaluate(async () => {
  await window.MeshForge.agent.executeTool('spawn_primitive', { type: 'cube', name: 'KeepMe', position: [2, 0.5, 0], scale: [1, 1, 1], color: '#6bbf59' });
  window.MeshForge.addSky();
  window.MeshForge.addWater();
  const before = window.__meshforge.editor.debug.meshes().map((o) => o.name);
  await window.__meshforge.newSphere(2, 1);
  const after = window.__meshforge.editor.debug.meshes().map((o) => o.name);
  return { before, after };
});
check('Add sphere keeps existing objects', ['KeepMe', 'Sky dome', 'Water', 'Sphere'].every((n) => added.after.includes(n)), added);
await page.evaluate(() => window.MeshForge.setMode('object'));
await page.screenshot({ path: `${outDir}/add_sphere_keeps_scene.png` });

const agent = await page.evaluate(async () => {
  const listed = await window.MeshForge.agent.executeTool('list_tools');
  const names = (listed.tools || []).map((t) => t.name);
  const summary = await window.MeshForge.agent.executeTool('get_scene_summary');
  const attached = await window.MeshForge.agent.executeTool('attach_script', { target: 'KeepMe', source: 'api.position.x += api.dt;' });
  const withScript = (window.MeshForge.getBehaviours('KeepMe') || []).some((b) => b.type === 'script');
  window.__meshforge.editor.undo();
  const afterUndo = (window.MeshForge.getBehaviours('KeepMe') || []).some((b) => b.type === 'script');
  return { ok: listed.ok && summary.ok, names, count: summary.count, attached, withScript, afterUndo };
});
check('agent publishes tools and a scene summary', agent.ok && agent.names.includes('attach_script') && agent.names.includes('build_level') && agent.count >= 4, agent);
check('a custom script can be attached and undone', agent.attached.ok && agent.withScript && agent.afterUndo === false, agent);

if (pageErrors.length) { report.ok = false; console.log('page errors', pageErrors); }
console.log(report.ok ? 'ALL PASS' : 'FAILED');
await browser.close();
process.exit(report.ok ? 0 : 1);
