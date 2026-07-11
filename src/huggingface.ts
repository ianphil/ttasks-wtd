import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { verifyBundleChecksums, type ChecksumsFile } from './checksums.js';
import type {
  DownloadedWtdRuntime,
  DownloadWtdRuntimeOptions,
  RuntimeRelease,
  WtdModelLocator,
} from './types.js';

type HuggingFaceModelInfo = {
  siblings?: Array<{ rfilename?: string }>;
};

type RuntimeCacheMetadata = {
  repo: string;
  revision: string;
  files: string[];
};

const CACHE_METADATA_FILE = '.wtd-runtime.json';

export const DEFAULT_WTD_MODEL: Readonly<WtdModelLocator> = Object.freeze({
  hfRepo: 'ianphil/wtd-mixed-v1',
  revision: 'v0.4.3',
});

export async function downloadWtdRuntime(options: DownloadWtdRuntimeOptions): Promise<DownloadedWtdRuntime> {
  const repo = options.repo ?? DEFAULT_WTD_MODEL.hfRepo;
  const revision = options.revision ?? DEFAULT_WTD_MODEL.revision;
  const verifyChecksums = options.verifyChecksums ?? true;
  const reuseExisting = options.reuseExisting ?? true;

  if (reuseExisting) {
    const cached = await loadCachedRuntime(options.outDir, repo, revision, verifyChecksums);
    if (cached) {
      return {
        bundlePath: options.outDir,
        repo,
        revision,
        files: cached.files,
        cacheHit: true,
      };
    }
  }

  const files = await listRepoFiles(repo, revision);
  const runtimeFiles = files
    .filter((file) => file !== '.gitattributes' && !file.endsWith('/'))
    .map(validateRuntimeFile);

  const parentDir = dirname(resolve(options.outDir));
  await mkdir(parentDir, { recursive: true });
  const stagingDir = await mkdtemp(join(parentDir, `.${basename(options.outDir)}.partial-`));

  try {
    await downloadRuntimeFiles(repo, revision, runtimeFiles, stagingDir);
    await validateDownloadedRuntime(stagingDir, repo, revision, verifyChecksums);
    await writeJson(join(stagingDir, CACHE_METADATA_FILE), { repo, revision, files: runtimeFiles });
    await replaceDirectory(stagingDir, options.outDir);

    return {
      bundlePath: options.outDir,
      repo,
      revision,
      files: runtimeFiles,
      cacheHit: false,
    };
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
}

async function downloadRuntimeFiles(
  repo: string,
  revision: string,
  files: string[],
  outDir: string,
): Promise<void> {
  const results = await Promise.allSettled(
    files.map((file) => downloadRepoFile(repo, revision, file, outDir)),
  );
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
}

async function listRepoFiles(repo: string, revision: string): Promise<string[]> {
  const url = `https://huggingface.co/api/models/${repo}/revision/${revision}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to list Hugging Face files for ${repo}@${revision}: ${response.status} ${response.statusText}`);
  }

  const info = await response.json() as HuggingFaceModelInfo;
  return (info.siblings ?? [])
    .map((sibling) => sibling.rfilename)
    .filter((filename): filename is string => Boolean(filename));
}

async function downloadRepoFile(repo: string, revision: string, file: string, outDir: string): Promise<void> {
  const url = `https://huggingface.co/${repo}/resolve/${revision}/${encodePath(file)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${repo}@${revision}/${file}: ${response.status} ${response.statusText}`);
  }

  const outPath = resolveRuntimeFile(outDir, file);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}

async function loadCachedRuntime(
  outDir: string,
  repo: string,
  revision: string,
  verifyChecksums: boolean,
): Promise<RuntimeCacheMetadata | null> {
  try {
    const metadata = await readJson<RuntimeCacheMetadata>(join(outDir, CACHE_METADATA_FILE));
    if (metadata.repo !== repo || metadata.revision !== revision) {
      return null;
    }
    if (verifyChecksums) {
      await verifyRuntimeChecksums(outDir);
    }
    return metadata;
  } catch {
    return null;
  }
}

async function validateDownloadedRuntime(
  bundlePath: string,
  repo: string,
  revision: string,
  verifyChecksums: boolean,
): Promise<void> {
  const release = await readOptionalJson<RuntimeRelease>(join(bundlePath, 'release.json'));
  const releaseRepo = release?.hfRepo ?? release?.hf_repo;
  const releaseRevision = release?.hfRevision ?? release?.revision;
  if (releaseRepo && releaseRepo !== repo) {
    throw new Error(`Downloaded WTD runtime repo mismatch: requested ${repo}, received ${releaseRepo}.`);
  }
  if (releaseRevision && releaseRevision !== revision) {
    throw new Error(`Downloaded WTD runtime revision mismatch: requested ${revision}, received ${releaseRevision}.`);
  }
  if (verifyChecksums) {
    await verifyRuntimeChecksums(bundlePath);
  }
}

async function verifyRuntimeChecksums(bundlePath: string): Promise<void> {
  let checksums: ChecksumsFile;
  try {
    checksums = await readJson<ChecksumsFile>(join(bundlePath, 'checksums.json'));
  } catch (error) {
    throw new Error('Downloaded WTD runtime is missing a readable checksums.json.', { cause: error });
  }
  await verifyBundleChecksums(bundlePath, checksums);
}

async function replaceDirectory(stagingDir: string, outDir: string): Promise<void> {
  const backupDir = `${outDir}.backup-${randomUUID()}`;
  let hasBackup = false;
  try {
    await rename(outDir, backupDir);
    hasBackup = true;
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  try {
    await rename(stagingDir, outDir);
  } catch (installError) {
    if (hasBackup) {
      try {
        await rename(backupDir, outDir);
      } catch (restoreError) {
        throw new AggregateError(
          [installError, restoreError],
          `Failed to install the downloaded WTD runtime and restore the previous runtime. The previous runtime remains at ${backupDir}.`,
        );
      }
    }
    throw installError;
  }

  if (hasBackup) {
    await rm(backupDir, { force: true, recursive: true });
  }
}

function validateRuntimeFile(file: string): string {
  if (!file || file.includes('\\') || isAbsolute(file)) {
    throw new Error(`Unsafe Hugging Face runtime file path: ${JSON.stringify(file)}.`);
  }
  resolveRuntimeFile('.', file);
  return file;
}

function resolveRuntimeFile(rootDir: string, file: string): string {
  const root = resolve(rootDir);
  const resolved = resolve(root, file);
  const relativePath = relative(root, resolved);
  if (
    relativePath === ''
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error(`Unsafe Hugging Face runtime file path: ${JSON.stringify(file)}.`);
  }
  return resolved;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
