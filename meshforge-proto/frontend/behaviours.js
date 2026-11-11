// MeshForge play-mode behaviours. Original MIT code.
// Data lives on object.userData.behaviours and is evaluated only while Play is running.

export const BEHAVIOUR_TYPES = [
  { type: 'spin', label: 'Spin', defaults: { axis: 'y', speed: 90 } },
  { type: 'oscillate', label: 'Oscillate', defaults: { axis: 'y', amplitude: 0.25, speed: 2 } },
  { type: 'character', label: 'Character', defaults: { speed: 4.5, jump: 6, camera: 'follow' } },
  { type: 'follow', label: 'Follow', defaults: { target: '', distance: 1.6, height: 1.4 } },
  { type: 'script', label: 'Script', defaults: { source: '// api.position.y += Math.sin(api.time) * api.dt;\n' } },
];

const TYPES = new Set(BEHAVIOUR_TYPES.map((t) => t.type));

export function behaviourDefaults(type) {
  return BEHAVIOUR_TYPES.find((t) => t.type === type)?.defaults || {};
}

export function normaliseBehaviour(raw) {
  if (!raw || !TYPES.has(raw.type)) return null;
  const params = { ...behaviourDefaults(raw.type), ...(raw.params || {}) };
  return { type: raw.type, enabled: raw.enabled !== false, params };
}

export function listBehaviours(obj) {
  if (!obj) return [];
  if (!Array.isArray(obj.userData.behaviours)) return [];
  return obj.userData.behaviours.map(normaliseBehaviour).filter(Boolean);
}

export function setBehaviours(obj, list) {
  obj.userData.behaviours = (list || []).map(normaliseBehaviour).filter(Boolean);
  return obj.userData.behaviours;
}
