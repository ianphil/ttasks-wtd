import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { verifyBundleChecksums, type ChecksumsFile } from './checksums.js';
import { createStructuralRuntime, normalizeDraftDag, type StructuralRuntime } from './structural.js';
import type {
  RuntimeManifest,
  RuntimePattern,
  RuntimeRelease,
  RuntimeTextIndexEntry,
  WorkflowShapeCandidate,
  WtdAdvisorOptions,
  WtdRetrieveRequest,
  WtdRetrieveResult,
} from './types.js';

export class WtdAdvisor {
  readonly bundlePath: string;
  readonly manifest: RuntimeManifest;
  readonly release: RuntimeRelease | null;

  #patterns: WorkflowShapeCandidate[];
  #patternRecords: RuntimePattern[];
  #textEntries: RuntimeTextIndexEntry[];
  #structural: StructuralRuntime | null;

  private constructor(args: {
    bundlePath: string;
    manifest: RuntimeManifest;
    release: RuntimeRelease | null;
    patterns: WorkflowShapeCandidate[];
    patternRecords: RuntimePattern[];
    textEntries: RuntimeTextIndexEntry[];
    structural: StructuralRuntime | null;
  }) {
    this.bundlePath = args.bundlePath;
    this.manifest = args.manifest;
    this.release = args.release;
    this.#patterns = args.patterns;
    this.#patternRecords = args.patternRecords;
    this.#textEntries = args.textEntries;
    this.#structural = args.structural;
  }

  static async load(options: WtdAdvisorOptions): Promise<WtdAdvisor> {
    const manifest = await readJson<RuntimeManifest>(join(options.bundlePath, 'manifest.json'));
    const release = await readOptionalJson<RuntimeRelease>(join(options.bundlePath, 'release.json'));

    if (options.verifyChecksums ?? true) {
      const checksums = await readOptionalJson<ChecksumsFile>(join(options.bundlePath, 'checksums.json'));
      if (checksums) {
        await verifyBundleChecksums(options.bundlePath, checksums);
      }
    }

    const patternRecordsInput = await readJson<RuntimePattern[] | { patterns: RuntimePattern[] }>(join(options.bundlePath, 'patterns.json'));
    const patternRecords = Array.isArray(patternRecordsInput) ? patternRecordsInput : patternRecordsInput.patterns;
    const textEntries = normalizeTextIndex(
      await readOptionalJson<RuntimeTextIndexEntry[] | { entries?: RuntimeTextIndexEntry[]; documents?: RuntimeTextIndexEntry[] }>(
        join(options.bundlePath, 'text-index.json'),
      ),
    );
    const patterns = normalizePatterns(patternRecords, textEntries);
    const structural = options.enableStructuralRuntime === false
      ? null
      : await createStructuralRuntime({
        bundlePath: options.bundlePath,
        manifest,
        patternRecords,
        textEntries,
        candidates: patterns,
      });

    return new WtdAdvisor({
      bundlePath: options.bundlePath,
      manifest,
      release,
      patterns,
      patternRecords,
      textEntries,
      structural,
    });
  }

  async retrieve(request: WtdRetrieveRequest): Promise<WtdRetrieveResult> {
    const k = request.k ?? 5;
    const queryKind = request.draftDag ? 'draftDag' : 'text';
    if (request.draftDag && request.mode !== 'metadata') {
      if (this.#structural) {
        const candidates = await this.#structural.retrieve(request.draftDag, k);
        return {
          queryKind,
          querySummary: normalizeDraftDag(request.draftDag).title,
          candidates,
          fallback: { used: false, from: 'draftDagStructuralRetrieval', to: 'metadataFallbackRetrieval', reason: '' },
        };
      }
      if (request.mode === 'structural') {
        throw new Error('WTD structural runtime is unavailable for this bundle.');
      }
    }

    const queryText = buildQueryText(request);
    if (!queryText) {
      throw new Error('WTD retrieval requires query text or a draft DAG.');
    }

    const queryTokens = tokenize(queryText);
    const ranked = this.#patterns
      .map((pattern) => ({ pattern, score: this.#scorePattern(pattern, queryTokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.pattern.name.localeCompare(b.pattern.name))
      .slice(0, k)
      .map(({ pattern, score }) => ({ ...pattern, score }));

    return {
      queryKind,
      querySummary: queryText,
      candidates: ranked,
      fallback: request.draftDag
        ? {
          used: true,
          from: 'draftDagStructuralRetrieval',
          to: 'metadataFallbackRetrieval',
          reason: 'structural runtime unavailable',
        }
        : undefined,
    };
  }

  #scorePattern(pattern: WorkflowShapeCandidate, queryTokens: Set<string>): number {
    const entryTexts = this.#textEntries
      .filter((entry) => entryPatternId(entry) === pattern.id || entry.name === pattern.name)
      .map(entryText);
    const haystack = [
      pattern.name,
      pattern.description,
      pattern.guidance,
      ...pattern.examples.flatMap((example) => typeof example === 'number' ? [] : [example.title, example.goal, example.source]),
      ...entryTexts,
    ].filter(Boolean).join(' ');
    const patternTokens = tokenize(haystack);

    let matches = 0;
    for (const token of queryTokens) {
      if (patternTokens.has(token)) {
        matches += 1;
      }
    }

    return queryTokens.size === 0 ? 0 : matches / queryTokens.size;
  }
}

function normalizePatterns(
  patterns: RuntimePattern[],
  textEntries: RuntimeTextIndexEntry[],
): WorkflowShapeCandidate[] {
  const textById = new Map(textEntries.map((entry) => [entryPatternId(entry), entry]));
  return patterns.map((pattern) => {
    const textEntry = textById.get(pattern.id) ?? textById.get(pattern.name);
    return {
    id: pattern.id,
    name: pattern.name,
    description: pattern.description ?? textEntry?.description ?? '',
    score: pattern.score ?? 0,
    distance: pattern.distance,
    source: pattern.source ?? textEntry?.source,
    sizeBucket: pattern.sizeBucket ?? textEntry?.sizeBucket,
    layerShape: pattern.layerShape ?? pattern.layer_shape ?? textEntry?.layerShape ?? [],
    nodeCount: pattern.nodeCount ?? pattern.node_count ?? textEntry?.nodeCount ?? 0,
    edgeCount: pattern.edgeCount ?? pattern.edge_count ?? textEntry?.edgeCount ?? 0,
    depth: pattern.depth ?? textEntry?.depth,
    taskTypeMix: pattern.taskTypeMix ?? pattern.task_type_mix ?? textEntry?.taskTypeMix ?? {},
    examples: pattern.examples ?? pattern.exampleIndices ?? textEntry?.exampleIndices ?? [],
    guidance: pattern.guidance ?? textEntryGuidance(textEntry),
  };
});
}

function normalizeTextIndex(
  input: RuntimeTextIndexEntry[] | { entries?: RuntimeTextIndexEntry[]; documents?: RuntimeTextIndexEntry[] } | null,
): RuntimeTextIndexEntry[] {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input;
  }
  return input.entries ?? input.documents ?? [];
}

function buildQueryText(request: WtdRetrieveRequest): string {
  const parts = [request.query];
  if (request.draftDag) {
    const draftDag = normalizeDraftDag(request.draftDag);
    parts.push(draftDag.title);
    for (const node of draftDag.nodes) {
      parts.push(node.title, node.description, node.type);
    }
  }
  return parts.filter(Boolean).join(' ');
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 2),
  );
}

function entryPatternId(entry: RuntimeTextIndexEntry): string | undefined {
  return entry.patternId ?? entry.pattern_id ?? entry.id;
}

function entryText(entry: RuntimeTextIndexEntry): string {
  return [entry.name, entry.description, entry.text, ...(entry.tokens ?? [])].filter(Boolean).join(' ');
}

function textEntryGuidance(entry: RuntimeTextIndexEntry | undefined): string {
  if (!entry) {
    return '';
  }
  const details = [
    entry.source ? `source: ${entry.source}` : null,
    entry.exampleCount !== undefined ? `${entry.exampleCount} examples` : null,
    entry.depth !== undefined ? `depth ${entry.depth}` : null,
  ].filter(Boolean).join(', ');
  return details ? `Use this shape when its topology fits the draft workflow (${details}).` : '';
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}
