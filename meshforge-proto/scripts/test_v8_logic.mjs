import { createHistorySim, undoAdded } from '../frontend/historyguard.js';
import { classifyAsset, scatterTypes } from '../frontend/catalog.js';
import { createSecretStore, secretStatus } from '../frontend/secretstore.js';

let failed = 0;
function check(name, cond, detail) {
  if (!cond) { failed++; console.log('FAIL', name, detail ?? ''); }
  else console.log('PASS', name);
}

const sim = createHistorySim();
const land = sim.add('Landscape');
const house = sim.add('House');
const before = sim.ids();
const boat = sim.add('Boat');
check('generate adds one object', sim.ids().length === before.length + 1);
const undone = sim.undo();
check('undo label is the add', undone?.label === 'Add Boat');
check('undo removes only the boat', sim.ids().join() === before.join() && !sim.ids().includes(boat.id));
check('landscape and house remain', sim.ids().includes(land.id) && sim.ids().includes(house.id));
sim.redo();
check('redo restores the boat', sim.ids().includes(boat.id) && sim.ids().includes(land.id));

const wiped = { children: [{ id: 'keep', name: 'Landscape' }, { id: 'new', name: 'Boat' }], add(n) { this.children.push(n); }, remove() { this.children = []; } };
const boatNode = wiped.children[1];
let threw = false;
try { undoAdded(wiped, [boatNode]); } catch (err) { threw = /existing scene objects/.test(err.message); }
check('a wipe during undo is refused and existing objects come back', threw && wiped.children.some((c) => c.id === 'keep') && !wiped.children.some((c) => c.id === 'new'));

check('tree by name', classifyAsset('Pine_01.glb') === 'tree');
check('building by name', classifyAsset('cottage_a') === 'building');
check('character by name', classifyAsset('hero_body') === 'character');
check('tall thin mesh is a tree', classifyAsset('asset', { x: 0.4, y: 3.2, z: 0.4 }) === 'tree');
check('wide low mesh is a building', classifyAsset('asset', { x: 2.4, y: 1.2, z: 2 }) === 'building');
check('rigged mesh is a character', classifyAsset('asset', { x: 0.6, y: 1.8, z: 0.4, rigged: true }) === 'character');
check('unknown mesh is a prop', classifyAsset('widget', { x: 0.4, y: 0.4, z: 0.4 }) === 'prop');

let n = 0;
const placed = scatterTypes({ cells: 20, density: 1, count: 3, rng: () => 0, accept: () => ({ i: n++ }) });
check('count caps placement', placed.length === 3);

const store = createSecretStore({ pluginId: 'scene-from-photo', pluginName: 'Scene From Photo' });
const held = store.set('Gemini', 'should-not-be-stored');
check('set does not need a server', held.includes('not verified') && held.includes('Scene From Photo') && held.includes('will not sign you in'));
check('status before use', store.status('Gemini').includes('does not call a model provider'));
store.header('Gemini');
check('status after the plugin attaches the key', store.status('Gemini').includes('does not call a model provider') && store.status('Gemini').includes('not verified'));
check('pagehide keeps the key when the page is cached', store.shouldClearOnPageHide({ persisted: true }) === false);
check('pagehide clears the key when the tab is really going away', store.shouldClearOnPageHide({ persisted: false }) === true);
check('empty value clears the key', store.set('Gemini', '') === secretStatus({ name: 'Gemini', held: false, used: false, pluginId: 'scene-from-photo', pluginName: 'Scene From Photo' }));

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('logic tests ok');
