import { expect, test } from 'vitest';

import { createHeuristicRanker } from '../src/index.js';
import type { WorkflowShapeCandidate } from '../src/index.js';

test('reranks candidates with draft DAG compatibility features', () => {
  const ranker = createHeuristicRanker();
  const candidates = ranker.rank([
    candidate({ id: 'large', source: 'n8n', nodeCount: 40, edgeCount: 60, depth: 12, score: 0.5 }),
    candidate({ id: 'small', source: 'airflow', nodeCount: 4, edgeCount: 3, depth: 2, score: 0.45 }),
  ], {
    draftDag: {
      id: 'draft',
      title: 'draft',
      nodes: [
        { id: 'a', title: 'a', type: 'bash', description: '', payload: '', timeout: null, metadata: {} },
        { id: 'b', title: 'b', type: 'bash', description: '', payload: '', timeout: null, metadata: {} },
        { id: 'c', title: 'c', type: 'bash', description: '', payload: '', timeout: null, metadata: {} },
        { id: 'd', title: 'd', type: 'bash', description: '', payload: '', timeout: null, metadata: {} },
      ],
      deps: { a: [], b: ['a'], c: ['b'], d: ['c'] },
      finallyTasks: [],
      optionalTasks: [],
    },
  });

  expect(candidates[0]?.id).toBe('small');
  expect(candidates[0]?.rankReason).toContain('nodes=');
  expect(candidates[0]?.retrievalScores?.node_compatibility).toBe(1);
});

function candidate(overrides: Partial<WorkflowShapeCandidate>): WorkflowShapeCandidate {
  return {
    id: 'candidate',
    name: 'candidate',
    description: '',
    score: 0,
    layerShape: [],
    nodeCount: 1,
    edgeCount: 0,
    taskTypeMix: {},
    examples: [],
    guidance: '',
    ...overrides,
  };
}
