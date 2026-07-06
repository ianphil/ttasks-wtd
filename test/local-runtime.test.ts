import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { WtdAdvisor } from '../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

test('loads a metadata runtime bundle and ranks text matches', async () => {
  const dir = await makeBundle();

  const advisor = await WtdAdvisor.load({ bundlePath: dir });
  const result = await advisor.retrieve({ query: 'dataset ingestion eval publish candidate', k: 1 });

  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]?.name).toBe('dataset-ingest-eval-publish');
  expect(result.candidates[0]?.score).toBeGreaterThan(0);
});

test('uses draft DAG text as retrieval input', async () => {
  const dir = await makeBundle();

  const advisor = await WtdAdvisor.load({ bundlePath: dir });
  const result = await advisor.retrieve({
    draftDag: {
      id: 'draft',
      title: 'branch fix verify merge',
      nodes: [],
      deps: {},
      finallyTasks: [],
      optionalTasks: [],
    },
    k: 1,
  });

  expect(result.candidates[0]?.name).toBe('branch-fix-verify-merge');
  expect(result.fallback?.used).toBe(true);
});

test('loads published WTD schema with descriptions from text index', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ttasks-wtd-published-'));
  tempDirs.push(dir);

  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ artifactId: 'wtd-mixed-v1' }));
  await writeFile(join(dir, 'patterns.json'), JSON.stringify([
    { id: 'n8n-small', name: 'n8n small', tokens: ['dataset', 'ingest', 'eval'] },
  ]));
  await writeFile(join(dir, 'text-index.json'), JSON.stringify([
    {
      id: 'n8n-small',
      name: 'n8n small',
      description: 'A compact n8n workflow shape for dataset ingest.',
      nodeCount: 12,
      edgeCount: 6,
      taskTypeMix: {},
      source: 'n8n',
      exampleCount: 42,
      depth: 3,
    },
  ]));

  const advisor = await WtdAdvisor.load({ bundlePath: dir });
  const result = await advisor.retrieve({ query: 'dataset ingest eval', k: 1 });
  const [candidate] = result.candidates;

  expect(candidate?.description).toBe('A compact n8n workflow shape for dataset ingest.');
  expect(candidate?.nodeCount).toBe(12);
  expect(candidate?.guidance).toContain('42 examples');
});

test('loads ranker config and attaches ranking explanations', async () => {
  const dir = await makeBundle();
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    artifactId: 'wtd-mixed-v1',
    files: { rankerConfig: 'ranker-config.json' },
  }));
  await writeFile(join(dir, 'ranker-config.json'), JSON.stringify({
    schema_version: 'wtd_ranker_config_v1',
    weights: {
      retrieval_score: 0.45,
      node_compatibility: 0.12,
      edge_compatibility: 0.08,
      depth_compatibility: 0.12,
      fanout_compatibility: 0.08,
      source_preference: 0.08,
      size_preference: 0.02,
      confidence: 0.05,
      preferred_sources: ['airflow', 'n8n'],
    },
  }));

  const advisor = await WtdAdvisor.load({ bundlePath: dir });
  const result = await advisor.retrieve({ query: 'dataset ingestion eval publish candidate', k: 1 });

  expect(result.candidates[0]?.rankReason).toContain('retrieval=');
  expect(result.candidates[0]?.retrievalScores?.retrieval_score).toBeGreaterThan(0);
});

test('rejects empty retrieval requests', async () => {
  const dir = await makeBundle();

  const advisor = await WtdAdvisor.load({ bundlePath: dir });

  await expect(advisor.retrieve({})).rejects.toThrow('WTD retrieval requires query text or a draft DAG.');
});

async function makeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ttasks-wtd-'));
  tempDirs.push(dir);

  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ artifact_id: 'wtd-mixed-v1' }));
  await writeFile(join(dir, 'patterns.json'), JSON.stringify({
    patterns: [
      {
        id: 'dataset',
        name: 'dataset-ingest-eval-publish',
        description: 'Ingest a dataset, run evals, and publish a candidate artifact.',
        layer_shape: [1, 2, 1],
        node_count: 4,
        edge_count: 3,
        task_type_mix: { bash: 4 },
        examples: [{ id: 'ex1', goal: 'dataset ingestion eval publish candidate' }],
        guidance: 'Use this when data preparation gates a publishable artifact.',
      },
      {
        id: 'branches',
        name: 'branch-fix-verify-merge',
        description: 'Fix issues across branches, verify them, and merge.',
        layer_shape: [1, 3, 1],
        node_count: 5,
        edge_count: 4,
        task_type_mix: { agent: 3, bash: 2 },
        examples: [{ id: 'ex2', goal: 'branch fix verify merge' }],
        guidance: 'Use this when independent branch fixes converge into verification.',
      },
    ],
  }));
  await writeFile(join(dir, 'text-index.json'), JSON.stringify({
    entries: [
      { pattern_id: 'dataset', tokens: ['dataset', 'ingestion', 'eval', 'publish', 'candidate'] },
      { pattern_id: 'branches', tokens: ['branch', 'fix', 'verify', 'merge'] },
    ],
  }));

  return dir;
}
