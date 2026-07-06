import { blake2b } from '@noble/hashes/blake2.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';

import type {
  CompactDraftDagJson,
  RuntimeManifest,
  RuntimePattern,
  RuntimeTextIndexEntry,
  TtasksGraphJson,
  TtasksGraphNodeJson,
  WorkflowShapeCandidate,
} from './types.js';

export type StructuralRuntime = {
  retrieve(draftDag: TtasksGraphJson | CompactDraftDagJson, k: number): Promise<WorkflowShapeCandidate[]>;
  encode(draftDag: TtasksGraphJson | CompactDraftDagJson): Promise<Float32Array>;
};

type EncodedDraftGraph = {
  nodeFeatures: Float32Array;
  adjacency: Float32Array;
  nodeMask: boolean[];
  structFeatures: Float32Array;
  nodeCount: number;
};

const TASK_TYPE_ORDER = ['bash', 'powershell', 'prompt', 'agent'];
const textEncoder = new TextEncoder();

export async function createStructuralRuntime(args: {
  bundlePath: string;
  manifest: RuntimeManifest;
  patternRecords: RuntimePattern[];
  textEntries: RuntimeTextIndexEntry[];
  candidates: WorkflowShapeCandidate[];
}): Promise<StructuralRuntime | null> {
  const files = args.manifest.files ?? {};
  const structural = args.manifest.structuralEncoder?.expectedFiles;
  const encoderPath = files.encoder ?? structural?.encoder?.path;
  const latentsPath = files.latents ?? structural?.latents?.path;
  const textProjectionPath = files.textProjection ?? structural?.textProjection?.path;
  const latentShape = structural?.latents?.shape;
  const projectionShape = structural?.textProjection?.shape;

  if (!encoderPath || !latentsPath || !textProjectionPath || !latentShape || !projectionShape) {
    return null;
  }

  const [session, patternLatents, textProjection] = await Promise.all([
    ort.InferenceSession.create(join(args.bundlePath, encoderPath), { executionProviders: ['cpu'] }),
    readFloat16Matrix(join(args.bundlePath, latentsPath), latentShape),
    readFloat32Matrix(join(args.bundlePath, textProjectionPath), projectionShape),
  ]);

  return {
    async encode(draftDag: TtasksGraphJson | CompactDraftDagJson): Promise<Float32Array> {
      const encoded = encodeDraftGraph(draftDag, textProjection, projectionShape);
      return runEncoder(session, encoded);
    },

    async retrieve(draftDag: TtasksGraphJson | CompactDraftDagJson, k: number): Promise<WorkflowShapeCandidate[]> {
      const encoded = encodeDraftGraph(draftDag, textProjection, projectionShape);
      const latent = await runEncoder(session, encoded);
      const distances = euclideanDistances(latent, patternLatents, latentShape[1] ?? latent.length);
      return distances
        .map((distance, index) => ({ distance, index }))
        .sort((a, b) => a.distance - b.distance || (args.patternRecords[a.index]?.id ?? '').localeCompare(args.patternRecords[b.index]?.id ?? ''))
        .slice(0, k)
        .map(({ distance, index }) => {
          const pattern = args.patternRecords[index];
          const base = args.candidates[index];
          if (!pattern || !base) {
            throw new Error(`WTD structural result referenced missing pattern row ${index}.`);
          }
          return {
            ...base,
            id: pattern.id ?? base.id,
            score: 1 / (1 + distance),
            distance,
            retrievalScores: {
              ...(base.retrievalScores ?? {}),
              structural: 1 / (1 + distance),
            },
            source: pattern.source ?? base.source,
            sizeBucket: pattern.sizeBucket ?? base.sizeBucket ?? 'unknown',
            depth: pattern.depth ?? base.depth,
            examples: pattern.exampleIndices ?? base.examples,
            guidance: pattern.guidance ?? `Use the ${pattern.id ?? pattern.name} topology as the starting shape.`,
            risks: ['Validate task semantics before execution; WTD recommends topology, not task content.'],
          };
        });
    },
  };
}

export function normalizeDraftDag(input: TtasksGraphJson | CompactDraftDagJson): TtasksGraphJson {
  if ('nodes' in input) {
    return input;
  }

  const nodes = input.steps.map((title, index): TtasksGraphNodeJson => ({
    id: `step-${String(index + 1).padStart(2, '0')}`,
    title,
    type: 'prompt',
    description: '',
    payload: title,
    timeout: null,
    metadata: {},
  }));
  return {
    id: slug(input.title ?? 'draft-dag'),
    title: input.title ?? 'draft-dag',
    nodes,
    deps: Object.fromEntries(nodes.map((node, index) => [node.id, index === 0 ? [] : [nodes[index - 1].id]])),
    finallyTasks: [],
    optionalTasks: [],
  };
}

export function draftGraphStats(input: TtasksGraphJson | CompactDraftDagJson): {
  nodeCount: number;
  edgeCount: number;
  depth: number;
  maxFanout: number;
  meanFanout: number;
} {
  const graph = normalizeDraftDag(input);
  const taskIds = graph.nodes.map((node) => node.id);
  const edgeCount = taskIds.reduce((sum, id) => sum + (graph.deps[id]?.length ?? 0), 0);
  return {
    nodeCount: taskIds.length,
    edgeCount,
    depth: longestPath(graph.deps, taskIds),
    maxFanout: maxFanout(graph.deps, taskIds),
    meanFanout: meanFanout(graph.deps, taskIds),
  };
}

function encodeDraftGraph(
  input: TtasksGraphJson | CompactDraftDagJson,
  projection: Float32Array,
  projectionShape: number[],
): EncodedDraftGraph {
  const graph = normalizeDraftDag(input);
  if (graph.nodes.length === 0) {
    throw new Error('draft DAG must contain at least one task');
  }

  const n = graph.nodes.length;
  const textDim = projectionShape[1];
  if (!textDim) {
    throw new Error('WTD text projection shape is missing text dimension.');
  }

  const nodeFeatureDim = 4 + 1 + 3 * textDim + 3 + 1;
  const nodeFeatures = new Float32Array(n * nodeFeatureDim);
  const adjacency = new Float32Array(n * n);
  const nodeMask = Array.from({ length: n }, () => true);
  const idToPos = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const indegrees = graph.nodes.map((node) => graph.deps[node.id]?.length ?? 0);

  for (const [index, node] of graph.nodes.entries()) {
    const offset = index * nodeFeatureDim;
    const typeIndex = TASK_TYPE_ORDER.indexOf(node.type);
    if (typeIndex >= 0) {
      nodeFeatures[offset + typeIndex] = 1;
    }
    if (node.timeout !== null && node.timeout > 0) {
      nodeFeatures[offset + 4] = Math.log(node.timeout);
    }
    nodeFeatures[offset + 5] = graph.finallyTasks.includes(node.id) ? 1 : 0;
    nodeFeatures[offset + 6] = graph.optionalTasks.includes(node.id) ? 1 : 0;
    nodeFeatures[offset + 7] = indegrees[index] === 0 ? 1 : 0;

    const base = offset + 8;
    nodeFeatures.set(hashTextEmbedding(node.title, projection, projectionShape), base);
    nodeFeatures.set(hashTextEmbedding(node.description, projection, projectionShape), base + textDim);
    nodeFeatures.set(hashTextEmbedding(payloadText(node.payload), projection, projectionShape), base + 2 * textDim);
    nodeFeatures[offset + nodeFeatureDim - 1] = indegrees[index] / Math.max(n, 1);
  }

  for (const [taskId, depIds] of Object.entries(graph.deps)) {
    const taskIndex = idToPos.get(taskId);
    if (taskIndex === undefined) {
      continue;
    }
    for (const depId of depIds) {
      const depIndex = idToPos.get(depId);
      if (depIndex !== undefined) {
        adjacency[depIndex * n + taskIndex] = 1;
      }
    }
  }

  return {
    nodeFeatures,
    adjacency,
    nodeMask,
    structFeatures: new Float32Array([
      n,
      longestPath(graph.deps, graph.nodes.map((node) => node.id)),
      maxFanout(graph.deps, graph.nodes.map((node) => node.id)),
      meanFanout(graph.deps, graph.nodes.map((node) => node.id)),
    ]),
    nodeCount: n,
  };
}

async function runEncoder(session: ort.InferenceSession, encoded: EncodedDraftGraph): Promise<Float32Array> {
  const feeds = {
    node_features: new ort.Tensor('float32', encoded.nodeFeatures, [1, encoded.nodeCount, encoded.nodeFeatures.length / encoded.nodeCount]),
    adjacency: new ort.Tensor('float32', encoded.adjacency, [1, encoded.nodeCount, encoded.nodeCount]),
    node_mask: new ort.Tensor('bool', encoded.nodeMask, [1, encoded.nodeCount]),
    struct_features: new ort.Tensor('float32', encoded.structFeatures, [1, 4]),
  };
  const result = await session.run(feeds);
  const latent = result.latent;
  if (!latent || !(latent.data instanceof Float32Array)) {
    throw new Error('WTD encoder did not return a float32 latent tensor.');
  }
  return latent.data;
}

function hashTextEmbedding(text: string, projection: Float32Array, projectionShape: number[]): Float32Array {
  const [bucketCount, textDim] = projectionShape;
  const tokens = text.toLowerCase().split(/\s+/u).filter(Boolean);
  const out = new Float32Array(textDim);
  if (tokens.length === 0) {
    return out;
  }

  for (const token of tokens) {
    const digest = blake2b(textEncoder.encode(token), { dkLen: 4 });
    const bucket = readUInt32HexDigest(digest) % bucketCount;
    const offset = bucket * textDim;
    for (let i = 0; i < textDim; i += 1) {
      out[i] += projection[offset + i];
    }
  }
  for (let i = 0; i < textDim; i += 1) {
    out[i] /= tokens.length;
  }
  return out;
}

function readUInt32HexDigest(bytes: Uint8Array): number {
  return Number.parseInt(Buffer.from(bytes).toString('hex'), 16);
}

async function readFloat32Matrix(path: string, shape: number[]): Promise<Float32Array> {
  const buffer = await readFile(path);
  const expected = shape.reduce((product, value) => product * value, 1);
  const data = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
  if (data.length !== expected) {
    throw new Error(`WTD float32 matrix ${path} has ${data.length} values; expected ${expected}.`);
  }
  return new Float32Array(data);
}

async function readFloat16Matrix(path: string, shape: number[]): Promise<Float32Array> {
  const buffer = await readFile(path);
  const expected = shape.reduce((product, value) => product * value, 1);
  const half = new Uint16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT);
  if (half.length !== expected) {
    throw new Error(`WTD float16 matrix ${path} has ${half.length} values; expected ${expected}.`);
  }
  const out = new Float32Array(half.length);
  for (let i = 0; i < half.length; i += 1) {
    out[i] = float16ToFloat32(half[i]);
  }
  return out;
}

function float16ToFloat32(value: number): number {
  const sign = (value & 0x8000) ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) {
    return sign * 2 ** -14 * (fraction / 2 ** 10);
  }
  if (exponent === 0x1f) {
    return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  }
  return sign * 2 ** (exponent - 15) * (1 + fraction / 2 ** 10);
}

function euclideanDistances(query: Float32Array, matrix: Float32Array, dim: number): number[] {
  const rows = matrix.length / dim;
  const distances: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    let sum = 0;
    const offset = row * dim;
    for (let col = 0; col < dim; col += 1) {
      const diff = query[col] - matrix[offset + col];
      sum += diff * diff;
    }
    distances.push(Math.sqrt(sum));
  }
  return distances;
}

function longestPath(deps: Record<string, string[]>, taskIds: string[]): number {
  const memo = new Map<string, number>();
  const depth = (taskId: string): number => {
    const cached = memo.get(taskId);
    if (cached !== undefined) {
      return cached;
    }
    const parents = deps[taskId] ?? [];
    const value = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((parent) => depth(parent)));
    memo.set(taskId, value);
    return value;
  };
  return Math.max(0, ...taskIds.map((taskId) => depth(taskId)));
}

function maxFanout(deps: Record<string, string[]>, taskIds: string[]): number {
  const counts = fanoutCounts(deps, taskIds);
  return Math.max(0, ...counts.values());
}

function meanFanout(deps: Record<string, string[]>, taskIds: string[]): number {
  const counts = fanoutCounts(deps, taskIds);
  return [...counts.values()].reduce((sum, count) => sum + count, 0) / Math.max(counts.size, 1);
}

function fanoutCounts(deps: Record<string, string[]>, taskIds: string[]): Map<string, number> {
  const counts = new Map(taskIds.map((taskId) => [taskId, 0]));
  for (const depIds of Object.values(deps)) {
    for (const depId of depIds) {
      const count = counts.get(depId);
      if (count !== undefined) {
        counts.set(depId, count + 1);
      }
    }
  }
  return counts;
}

function payloadText(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  return payload === null || payload === undefined ? '' : JSON.stringify(payload);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'draft-dag';
}
