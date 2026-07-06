export type WtdModelLocator = {
  hfRepo: string;
  revision: string;
};

export type WtdAdvisorOptions = {
  bundlePath: string;
  verifyChecksums?: boolean;
};

export type WtdRetrieveRequest = {
  query?: string;
  draftDag?: TtasksGraphJson;
  k?: number;
};

export type WorkflowShapeExample = {
  id: string;
  title?: string;
  source?: string;
  goal?: string;
};

export type WorkflowShapeCandidate = {
  name: string;
  description: string;
  score: number;
  distance?: number;
  layerShape: number[];
  nodeCount: number;
  edgeCount: number;
  taskTypeMix: Record<string, number>;
  examples: WorkflowShapeExample[];
  guidance: string;
  id?: string;
};

export type TtasksGraphJson = {
  id: string;
  title: string;
  nodes: TtasksGraphNodeJson[];
  deps: Record<string, string[]>;
  finallyTasks: string[];
  optionalTasks: string[];
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

export type RuntimeManifest = {
  artifact_id?: string;
  artifactId?: string;
  version?: string;
  capabilities?: Record<string, unknown>;
};

export type RuntimeRelease = {
  model_id?: string;
  modelId?: string;
  version?: string;
  hf_repo?: string;
  hfRepo?: string;
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
};

export type RuntimeTextIndexEntry = {
  id?: string;
  pattern_id?: string;
  patternId?: string;
  name?: string;
  description?: string;
  text?: string;
  tokens?: string[];
};
