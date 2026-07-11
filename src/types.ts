export type WtdModelLocator = {
  hfRepo: string;
  revision: string;
};

export type DownloadWtdRuntimeOptions = {
  repo?: string;
  revision?: string;
  outDir: string;
  verifyChecksums?: boolean;
  reuseExisting?: boolean;
};

export type DownloadedWtdRuntime = {
  bundlePath: string;
  repo: string;
  revision: string;
  files: string[];
  cacheHit: boolean;
};

export type WtdAdvisorOptions = {
  bundlePath: string;
  verifyChecksums?: boolean;
  enableStructuralRuntime?: boolean;
  enableRanker?: boolean;
};

export type WtdRetrieveRequest = {
  query?: string;
  draftDag?: TtasksGraphJson | CompactDraftDagJson;
  k?: number;
  mode?: 'auto' | 'structural' | 'metadata';
  rank?: boolean;
  preferredSource?: string;
  preferredSize?: string;
};

export type WtdRetrieveResult = {
  queryKind: 'text' | 'draftDag';
  querySummary: string;
  candidates: WorkflowShapeCandidate[];
  fallback?: WtdRetrieveFallback;
};

export type WtdRetrieveFallback = {
  used: boolean;
  from: 'draftDagStructuralRetrieval';
  to: 'metadataFallbackRetrieval';
  reason: string;
};

export type WorkflowShapeExample = {
  id: string;
  title?: string;
  source?: string;
  goal?: string;
};

export type WorkflowShapeCandidate = {
  id?: string;
  name: string;
  description: string;
  score: number;
  distance?: number;
  source?: string;
  sizeBucket?: string;
  layerShape: number[];
  nodeCount: number;
  edgeCount: number;
  depth?: number;
  taskTypeMix: Record<string, number>;
  examples: WorkflowShapeExample[] | number[];
  guidance: string;
  risks?: string[];
  retrievalScores?: Record<string, number>;
  rankReason?: string;
};

export type RankingWeights = {
  retrieval_score: number;
  node_compatibility: number;
  edge_compatibility: number;
  depth_compatibility: number;
  fanout_compatibility: number;
  source_preference: number;
  size_preference: number;
  confidence: number;
  preferred_sources: string[];
};

export type RankerConfig = {
  schema_version?: string;
  weights?: Partial<RankingWeights>;
};

export type TtasksGraphJson = {
  id: string;
  title: string;
  nodes: TtasksGraphNodeJson[];
  deps: Record<string, string[]>;
  finallyTasks: string[];
  optionalTasks: string[];
};

export type CompactDraftDagJson = {
  title?: string;
  steps: string[];
};

export type TtasksGraphNodeJson = {
  id: string;
  title: string;
  type: string;
  description: string;
  payload: unknown;
  timeout: number | null;
  metadata: Record<string, unknown>;
};

export type RuntimeRelease = {
  model_id?: string;
  modelId?: string;
  version?: string;
  hf_repo?: string;
  hfRepo?: string;
  hfRevision?: string;
  revision?: string;
};

export type RuntimePattern = Partial<WorkflowShapeCandidate> & {
  id?: string;
  name: string;
  description?: string;
  examples?: WorkflowShapeExample[];
  guidance?: string;
  layer_shape?: number[];
  layerShape?: number[];
  node_count?: number;
  nodeCount?: number;
  edge_count?: number;
  edgeCount?: number;
  task_type_mix?: Record<string, number>;
  taskTypeMix?: Record<string, number>;
  tokens?: string[];
  source?: string;
  sizeBucket?: string;
  depth?: number;
  exampleIndices?: number[];
};

export type RuntimeTextIndexEntry = {
  id?: string;
  pattern_id?: string;
  patternId?: string;
  name?: string;
  description?: string;
  text?: string;
  tokens?: string[];
  depth?: number;
  edgeCount?: number;
  exampleCount?: number;
  exampleIndices?: number[];
  layerShape?: number[];
  nodeCount?: number;
  source?: string;
  taskTypeMix?: Record<string, number>;
  sizeBucket?: string;
};

export type RuntimeFiles = {
  checksums?: string;
  draftDagGold?: string;
  encoder?: string;
  encoderVectors?: string;
  goldQueries?: string;
  labels?: string;
  latents?: string;
  modelCard?: string;
  patterns?: string;
  rankerConfig?: string;
  rankerSchema?: string;
  release?: string;
  textIndex?: string;
  textProjection?: string;
  topK?: string;
};

export type HeuristicRankerManifest = {
  expectedFiles?: {
    config?: { path?: string };
    schema?: { path?: string };
  };
  status?: string;
};

export type StructuralEncoderManifest = {
  expectedFiles?: {
    encoder?: { path?: string };
    latents?: { path?: string; shape?: number[] };
    textProjection?: { path?: string; shape?: number[] };
  };
  status?: string;
};

export type RuntimeManifest = {
  artifact_id?: string;
  artifactId?: string;
  version?: string;
  mode?: string;
  capabilities?: Record<string, unknown>;
  files?: RuntimeFiles;
  structuralEncoder?: StructuralEncoderManifest;
  heuristicRanker?: HeuristicRankerManifest;
  provenance?: Record<string, unknown>;
};
