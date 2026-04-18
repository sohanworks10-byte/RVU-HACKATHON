import test from 'node:test';
import assert from 'node:assert/strict';

import { validateNoCycles, topologicalLayers } from '../../apps/backend/src/services/dag.service.js';

test('validateNoCycles returns ok for acyclic graph', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const edges = [{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }];
  const res = validateNoCycles(nodes, edges);
  assert.equal(res.ok, true);
});

test('validateNoCycles returns cycle nodes for cyclic graph', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }];
  const edges = [{ source: 'A', target: 'B' }, { source: 'B', target: 'A' }];
  const res = validateNoCycles(nodes, edges);
  assert.equal(res.ok, false);
  assert.ok(Array.isArray(res.cycle));
  assert.ok(res.cycle.includes('A') || res.cycle.includes('B'));
});

test('topologicalLayers returns valid layered ordering', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  const edges = [
    { source: 'A', target: 'C' },
    { source: 'B', target: 'C' },
    { source: 'C', target: 'D' },
  ];

  const layers = topologicalLayers(nodes, edges);
  // Expect first layer contains A,B in any order; second has C; third has D
  assert.equal(layers.length, 3);
  assert.equal(new Set(layers[0]).has('A'), true);
  assert.equal(new Set(layers[0]).has('B'), true);
  assert.deepEqual(layers[1], ['C']);
  assert.deepEqual(layers[2], ['D']);
});
