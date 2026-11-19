// Undo guard for MeshForge. Adding an object is one step. Undo removes only
// that object and restores anything a bad remove() also dropped.
// Original MIT code. No dependencies.

export function undoAdded(parent, nodes) {
  const doomed = new Set(nodes);
  const keep = (parent.children || []).filter((c) => !doomed.has(c));
  for (const n of nodes) {
    if (typeof parent.remove === 'function') parent.remove(n);
    else parent.children = parent.children.filter((c) => c !== n);
  }
  const missing = keep.filter((c) => !(parent.children || []).includes(c));
  if (missing.length) {
    for (const c of missing) {
      if (typeof parent.add === 'function') parent.add(c);
      else parent.children.push(c);
    }
    const names = missing.map((c) => c.name || c.id || 'object').join(', ');
    throw new Error('Undo refused to clear existing scene objects: ' + names);
  }
}

export function redoAdded(parent, nodes) {
  for (const n of nodes) {
    if ((parent.children || []).includes(n)) continue;
    if (typeof parent.add === 'function') parent.add(n);
    else parent.children.push(n);
  }
}

// In-memory stand-in used by the regression test and by callers that want
// the same add / undo / redo contract without a WebGL scene.
export function createHistorySim() {
  let seq = 1;
  const undoStack = [], redoStack = [];
  const root = {
    id: 'root', name: 'Scene', children: [],
    add(n) { n.parent = root; if (!root.children.includes(n)) root.children.push(n); },
    remove(n) { root.children = root.children.filter((c) => c !== n); if (n.parent === root) n.parent = null; },
  };
  function push(e) { undoStack.push(e); redoStack.length = 0; }
  function add(name) {
    const node = { id: 'n' + (seq++), name, parent: null };
    root.add(node);
    const nodes = [node];
    push({
      label: 'Add ' + name,
      undo() { undoAdded(root, nodes); },
      redo() { redoAdded(root, nodes); },
    });
    return node;
  }
  function undo() { const e = undoStack.pop(); if (!e) return null; e.undo(); redoStack.push(e); return e; }
  function redo() { const e = redoStack.pop(); if (!e) return null; e.redo(); undoStack.push(e); return e; }
  const ids = () => root.children.map((c) => c.id);
  return { root, add, undo, redo, ids, undoStack, redoStack };
}
