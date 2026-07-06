import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { DownloadedWtdRuntime, DownloadWtdRuntimeOptions } from './types.js';

type HuggingFaceModelInfo = {
  siblings?: Array<{ rfilename?: string }>;
};

const DEFAULT_REPO = 'ianphil/wtd-mixed-v1';
const DEFAULT_REVISION = 'v0.4.0';

export async function downloadWtdRuntime(options: DownloadWtdRuntimeOptions): Promise<DownloadedWtdRuntime> {
  const repo = options.repo ?? DEFAULT_REPO;
  const revision = options.revision ?? DEFAULT_REVISION;
  const files = await listRepoFiles(repo, revision);
  const runtimeFiles = files.filter((file) => file !== '.gitattributes' && !file.endsWith('/'));

  await mkdir(options.outDir, { recursive: true });
  await Promise.all(runtimeFiles.map((file) => downloadRepoFile(repo, revision, file, options.outDir)));

  return {
    bundlePath: options.outDir,
    repo,
    revision,
    files: runtimeFiles,
  };
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

  const outPath = join(outDir, file);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
