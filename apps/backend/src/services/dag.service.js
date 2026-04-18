function buildGraph(nodes, edges) {
  const nodeIds = new Set(nodes.map((n) => String(n.id)));
  const out = new Map();
  const inDeg = new Map();

  for (const id of nodeIds) {
    out.set(id, new Set());
    inDeg.set(id, 0);
  }

  for (const e of edges || []) {
    const src = String(e.source);
    const dst = String(e.target);
    if (!nodeIds.has(src) || !nodeIds.has(dst)) continue;
    if (!out.get(src).has(dst)) {
      out.get(src).add(dst);
      inDeg.set(dst, (inDeg.get(dst) || 0) + 1);
    }
  }

  return { nodeIds: Array.from(nodeIds), out, inDeg };
}

export function validateNoCycles(nodes, edges) {
  const { nodeIds, out, inDeg } = buildGraph(nodes, edges);
  const q = [];
  for (const id of nodeIds) {
    if ((inDeg.get(id) || 0) === 0) q.push(id);
  }

  const visited = [];
  while (q.length) {
    const id = q.shift();
    visited.push(id);
    for (const nxt of out.get(id) || []) {
      inDeg.set(nxt, (inDeg.get(nxt) || 0) - 1);
      if ((inDeg.get(nxt) || 0) === 0) q.push(nxt);
    }
  }

  if (visited.length === nodeIds.length) return { ok: true };

  const cycleNodes = nodeIds.filter((id) => (inDeg.get(id) || 0) > 0);
  return { ok: false, cycle: cycleNodes };
}

export function topologicalLayers(nodes, edges) {
  const { nodeIds, out, inDeg } = buildGraph(nodes, edges);
  const remainingInDeg = new Map(inDeg);

  const layers = [];
  const processed = new Set();

  let frontier = nodeIds.filter((id) => (remainingInDeg.get(id) || 0) === 0);

  while (frontier.length) {
    layers.push([...frontier]);
    const nextFrontier = [];

    for (const id of frontier) {
      processed.add(id);
      for (const nxt of out.get(id) || []) {
        remainingInDeg.set(nxt, (remainingInDeg.get(nxt) || 0) - 1);
      }
    }

    for (const id of nodeIds) {
      if (processed.has(id)) continue;
      if ((remainingInDeg.get(id) || 0) === 0) nextFrontier.push(id);
    }

    frontier = nextFrontier;
  }

  if (processed.size !== nodeIds.length) throw new Error('Cycle detected');
  return layers;
}
