// Asset categories and landscape placement counts. Original MIT code. No dependencies.

const NAME_RULES = [
  ['character', /(char|character|human|person|hero|npc|mannequin|body|avatar)/i],
  ['tree', /(tree|pine|oak|palm|birch|bush|shrub|foliage|hedge)/i],
  ['building', /(house|building|cottage|tower|shed|barn|roof|cabin|villa)/i],
  ['prop', /(prop|rock|crate|barrel|fence|bench|lamp|sign|boat|cart)/i],
];

export function classifyAsset(name, size) {
  const text = String(name || '');
  for (const [cat, re] of NAME_RULES) if (re.test(text)) return cat;
  if (size && size.x > 0 && size.y > 0 && size.z > 0) {
    const footprint = Math.max(size.x, size.z);
    const tall = size.y / Math.max(footprint, 1e-6);
    if (size.rigged) return 'character';
    if (tall > 2.2 && footprint < Math.max(size.y * 0.45, 0.01)) return 'tree';
    if (tall > 1.3 && tall < 2.4 && footprint < size.y * 0.7) return 'character';
    if (tall < 1.05 && footprint > size.y * 1.4) return 'building';
  }
  return 'prop';
}

// One seeded pass per building or tree type. `count` 0 means no cap.
export function scatterTypes(spec) {
  const { cells, density, count, rng, accept } = spec;
  const cap = count > 0 ? count : Infinity;
  const out = [];
  for (let i = 0; i < cells && out.length < cap; i++) {
    const roll = rng();
    if (roll > density) continue;
    const spot = accept(i, rng);
    if (!spot) continue;
    out.push(spot);
    if (out.length >= cap) break;
  }
  return out;
}
