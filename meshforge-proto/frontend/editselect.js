// Edit Mode selection helpers. Original MIT code.
// Topology arrays come from the editor's welded mesh (verts, edges, triangles).

function otherVert(E, edge, vert) {
  const a = E.edges[edge * 2], b = E.edges[edge * 2 + 1];
  return a === vert ? b : a;
}
function direction(E, from, to) {
  const ax = E.U[to * 3] - E.U[from * 3];
  const ay = E.U[to * 3 + 1] - E.U[from * 3 + 1];
  const az = E.U[to * 3 + 2] - E.U[from * 3 + 2];
  const l = Math.hypot(ax, ay, az) || 1;
  return [ax / l, ay / l, az / l];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

export function buildAdjacency(E) {
  const vertEdges = Array.from({ length: E.nv }, () => []);
  const edgeFaces = Array.from({ length: E.ne }, () => []);
  const vertFaces = Array.from({ length: E.nv }, () => []);
  for (let t = 0; t < E.nt; t++) {
    for (let k = 0; k < 3; k++) {
      const e = E.triEdges[t * 3 + k];
      if (e >= 0) edgeFaces[e].push(t);
      vertFaces[E.tris[t * 3 + k]].push(t);
    }
  }
  for (let e = 0; e < E.ne; e++) {
    vertEdges[E.edges[e * 2]].push(e);
    vertEdges[E.edges[e * 2 + 1]].push(e);
  }
  return { vertEdges, edgeFaces, vertFaces };
}

// Straightest unused edge leaving `vert` along the incoming direction.
export function continueEdge(E, edge, vert) {
  const prev = otherVert(E, edge, vert);
  const incoming = direction(E, prev, vert);
  let best = -1, bestDot = 0.5;
  for (const e of E.adj.vertEdges[vert]) {
    if (e === edge) continue;
    const next = otherVert(E, e, vert);
    const d = dot(incoming, direction(E, vert, next));
    if (d > bestDot) { bestDot = d; best = e; }
  }
  return best;
}

export function edgeLoop(E, start) {
  if (start < 0 || start >= E.ne) return [];
  const chosen = new Set([start]);
  const walk = (firstVert) => {
    let edge = start, vert = firstVert, guard = 0;
    while (guard++ < E.ne + 2) {
      const next = continueEdge(E, edge, vert);
      if (next < 0 || chosen.has(next)) break;
      chosen.add(next);
      vert = otherVert(E, next, vert);
      edge = next;
    }
  };
  walk(E.edges[start * 2]);
  walk(E.edges[start * 2 + 1]);
  return [...chosen];
}

// Edges that step across faces, roughly perpendicular to the start edge.
export function edgeRing(E, start) {
  if (start < 0 || start >= E.ne) return [];
  const chosen = new Set([start]);
  const step = (edge) => {
    const faces = E.adj.edgeFaces[edge] || [];
    let best = -1, bestDot = 0.2;
    const a = E.edges[edge * 2], b = E.edges[edge * 2 + 1];
    const across = direction(E, a, b);
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        const e = E.triEdges[f * 3 + k];
        if (e < 0 || e === edge || chosen.has(e)) continue;
        const d = Math.abs(dot(across, direction(E, E.edges[e * 2], E.edges[e * 2 + 1])));
        if (d < 0.45 && (best < 0 || d < bestDot)) { bestDot = d; best = e; }
      }
    }
    return best;
  };
  let guard = 0, edge = start;
  while (guard++ < E.ne) {
    const next = step(edge);
    if (next < 0 || chosen.has(next)) break;
    chosen.add(next);
    edge = next;
  }
  return [...chosen];
}

export function faceLoop(E, edge) {
  const edges = edgeLoop(E, edge);
  const faces = new Set();
  for (const e of edges) for (const f of E.adj.edgeFaces[e] || []) faces.add(f);
  return [...faces];
}

export function linkedFaces(E, seeds) {
  const seen = new Uint8Array(E.nt);
  const stack = [];
  for (const t of seeds) if (t >= 0 && t < E.nt) stack.push(t);
  while (stack.length) {
    const t = stack.pop();
    if (seen[t]) continue;
    seen[t] = 1;
    for (let k = 0; k < 3; k++) {
      const faces = E.adj.vertFaces[E.tris[t * 3 + k]] || [];
      for (const n of faces) if (!seen[n]) stack.push(n);
    }
  }
  const out = [];
  for (let t = 0; t < E.nt; t++) if (seen[t]) out.push(t);
  return out;
}
