import { readFile } from 'node:fs/promises';

import { draftGraphStats } from './structural.js';
import type {
  CompactDraftDagJson,
  RankerConfig,
  RankingWeights,
  TtasksGraphJson,
  WorkflowShapeCandidate,
  WtdRetrieveRequest,
} from './types.js';

export type HeuristicRanker = {
  rank(
    candidates: WorkflowShapeCandidate[],
    request: Pick<WtdRetrieveRequest, 'draftDag' | 'preferredSource' | 'preferredSize'>,
  ): WorkflowShapeCandidate[];
};

const DEFAULT_WEIGHTS: RankingWeights = {
  retrieval_score: 0.45,
  node_compatibility: 0.12,
  edge_compatibility: 0.08,
  depth_compatibility: 0.12,
  fanout_compatibility: 0.08,
  source_preference: 0.08,
  size_preference: 0.02,
  confidence: 0.05,
  preferred_sources: ['airflow', 'github', 'n8n', 'synthetic'],
};

export async function loadHeuristicRanker(path: string): Promise<HeuristicRanker> {
  const config = JSON.parse(await readFile(path, 'utf8')) as RankerConfig;
  if (config.schema_version && config.schema_version !== 'wtd_ranker_config_v1') {
    throw new Error(`unsupported WTD ranker config schema: ${config.schema_version}`);
  }
  const weights = { ...DEFAULT_WEIGHTS, ...(config.weights ?? {}) };
  weights.preferred_sources = config.weights?.preferred_sources ?? DEFAULT_WEIGHTS.preferred_sources;
  return createHeuristicRanker(weights);
}

export function createHeuristicRanker(weights: RankingWeights = DEFAULT_WEIGHTS): HeuristicRanker {
  return {
    rank(
      candidates: WorkflowShapeCandidate[],
      request: Pick<WtdRetrieveRequest, 'draftDag' | 'preferredSource' | 'preferredSize'>,
    ): WorkflowShapeCandidate[] {
      const stats = request.draftDag ? draftGraphStats(request.draftDag) : null;
      return candidates
        .map((candidate) => scoreCandidate(candidate, {
          weights,
          draftDag: request.draftDag,
          preferredSource: request.preferredSource,
          preferredSize: request.preferredSize,
          draftNodes: stats?.nodeCount,
          draftEdges: stats?.edgeCount,
          draftDepth: stats?.depth,
          draftFanout: stats?.maxFanout,
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    },
  };
}

function scoreCandidate(candidate: WorkflowShapeCandidate, args: {
  weights: RankingWeights;
  draftDag?: TtasksGraphJson | CompactDraftDagJson;
  preferredSource?: string;
  preferredSize?: string;
  draftNodes?: number;
  draftEdges?: number;
  draftDepth?: number;
  draftFanout?: number;
}): WorkflowShapeCandidate {
  const retrievalScore = Math.max(candidate.score, ...(Object.values(candidate.retrievalScores ?? {})));
  const nodeScore = compatibility(args.draftNodes, candidate.nodeCount);
  const edgeScore = compatibility(args.draftEdges, candidate.edgeCount);
  const depthScore = compatibility(args.draftDepth, candidate.depth ?? 0);
  const fanoutScore = compatibility(args.draftFanout, Math.max(...candidate.layerShape, 0));
  const sourceScore = sourcePreference(candidate.source, args.preferredSource, args.weights.preferred_sources);
  const sizeScore = sizePreference(candidate, args.preferredSize);
  const confidence = retrievalScore;
  const features = {
    retrieval_score: retrievalScore,
    node_compatibility: nodeScore,
    edge_compatibility: edgeScore,
    depth_compatibility: depthScore,
    fanout_compatibility: fanoutScore,
    source_preference: sourceScore,
    size_preference: sizeScore,
    confidence,
  };
  const score =
    args.weights.retrieval_score * retrievalScore
    + args.weights.node_compatibility * nodeScore
    + args.weights.edge_compatibility * edgeScore
    + args.weights.depth_compatibility * depthScore
    + args.weights.fanout_compatibility * fanoutScore
    + args.weights.source_preference * sourceScore
    + args.weights.size_preference * sizeScore
    + args.weights.confidence * confidence;
  const reason = (
    `score=${score.toFixed(3)}: retrieval=${retrievalScore.toFixed(3)}, `
    + `nodes=${nodeScore.toFixed(3)}, edges=${edgeScore.toFixed(3)}, depth=${depthScore.toFixed(3)}, `
    + `fanout=${fanoutScore.toFixed(3)}, source=${sourceScore.toFixed(3)}, size=${sizeScore.toFixed(3)}`
  );
  return {
    ...candidate,
    score,
    retrievalScores: {
      ...(candidate.retrievalScores ?? {}),
      ...features,
    },
    rankReason: reason,
    guidance: reason,
  };
}

function compatibility(actual: number | undefined, candidate: number): number {
  if (actual === undefined || candidate <= 0) {
    return 0.5;
  }
  return 1 / (1 + Math.abs(actual - candidate) / Math.max(actual, 1));
}

function sourcePreference(source: string | undefined, preferredSource: string | undefined, preferredSources: string[]): number {
  if (preferredSource) {
    return source === preferredSource ? 1 : 0;
  }
  if (!source) {
    return 0.5;
  }
  const index = preferredSources.indexOf(source);
  return index === -1 ? 0.5 : 1 - index * 0.1;
}

function sizePreference(candidate: WorkflowShapeCandidate, preferredSize: string | undefined): number {
  if (!preferredSize) {
    return 0.5;
  }
  return candidateSize(candidate) === preferredSize ? 1 : 0;
}

function candidateSize(candidate: WorkflowShapeCandidate): string | undefined {
  if (candidate.sizeBucket) {
    return candidate.sizeBucket;
  }
  const key = (candidate.id ?? candidate.name).replaceAll(' ', '_');
  for (const size of ['small', 'medium', 'large', 'oversized']) {
    if (key.endsWith(`_${size}`)) {
      return size;
    }
  }
  return undefined;
}
