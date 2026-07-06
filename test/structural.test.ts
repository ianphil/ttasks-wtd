import { expect, test } from 'vitest';

import { draftGraphStats, normalizeDraftDag } from '../src/index.js';

test('normalizes compact draft DAG steps to canonical ttasks graph JSON', () => {
  const graph = normalizeDraftDag({
    title: 'dataset-ingest',
    steps: ['Collect raw workflow sources', 'Validate source files', 'Normalize workflow records'],
  });

  expect(graph.id).toBe('dataset-ingest');
  expect(graph.nodes.map((node) => node.id)).toEqual(['step-01', 'step-02', 'step-03']);
  expect(graph.nodes.map((node) => node.type)).toEqual(['prompt', 'prompt', 'prompt']);
  expect(graph.deps).toEqual({
    'step-01': [],
    'step-02': ['step-01'],
    'step-03': ['step-02'],
  });
});

test('computes draft DAG structural stats', () => {
  const stats = draftGraphStats({
    id: 'fanout',
    title: 'fanout',
    nodes: [
      { id: 'root', title: 'root', type: 'bash', description: '', payload: '', timeout: null, metadata: {} },
      { id: 'a', title: 'a', type: 'bash', description: '', payload: '', timeout: null, metadata: {} },
      { id: 'b', title: 'b', type: 'bash', description: '', payload: '', timeout: null, metadata: {} },
      { id: 'join', title: 'join', type: 'bash', description: '', payload: '', timeout: null, metadata: {} },
    ],
    deps: { root: [], a: ['root'], b: ['root'], join: ['a', 'b'] },
    finallyTasks: [],
    optionalTasks: [],
  });

  expect(stats).toEqual({
    nodeCount: 4,
    edgeCount: 4,
    depth: 2,
    maxFanout: 2,
    meanFanout: 1,
  });
});
