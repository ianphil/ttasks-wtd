import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { DEFAULT_WTD_MODEL, downloadWtdRuntime } from '../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

test('downloads and verifies runtime files from the default pinned Hugging Face revision', async () => {
  const files = runtimeFiles();
  const fetchMock = mockRuntimeFetch(files);
  const dir = await makeTempDir();
  const outDir = join(dir, 'runtime');

  const result = await downloadWtdRuntime({ outDir });

  expect(DEFAULT_WTD_MODEL).toEqual({ hfRepo: 'ianphil/wtd-mixed-v1', revision: 'v0.4.3' });
  expect(result.repo).toBe('ianphil/wtd-mixed-v1');
  expect(result.revision).toBe('v0.4.3');
  expect(result.cacheHit).toBe(false);
  expect(result.files).toEqual(['manifest.json', 'release.json', 'checksums.json']);
  expect(fetchMock).toHaveBeenCalledWith('https://huggingface.co/ianphil/wtd-mixed-v1/resolve/v0.4.3/manifest.json');
  expect(await readFile(join(outDir, 'manifest.json'), 'utf8')).toBe(files['manifest.json']);
});

test('reuses a verified cached runtime without contacting Hugging Face', async () => {
  const files = runtimeFiles();
  const fetchMock = mockRuntimeFetch(files);
  const dir = await makeTempDir();
  const outDir = join(dir, 'runtime');
  await downloadWtdRuntime({ outDir });
  fetchMock.mockClear();

  const result = await downloadWtdRuntime({ outDir });

  expect(result.cacheHit).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('rejects unsafe repository file paths', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
    siblings: [{ rfilename: '../escape.json' }],
  }));
  const dir = await makeTempDir();

  await expect(downloadWtdRuntime({ outDir: join(dir, 'runtime') }))
    .rejects.toThrow('Unsafe Hugging Face runtime file path');
});

test('preserves an existing runtime when a replacement download fails', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/models/')) {
      return jsonResponse({ siblings: [{ rfilename: 'manifest.json' }, { rfilename: 'checksums.json' }] });
    }
    if (url.endsWith('/checksums.json')) {
      return new Response(null, { status: 500, statusText: 'Server Error' });
    }
    return bytesResponse('{}');
  });
  const dir = await makeTempDir();
  const outDir = join(dir, 'runtime');
  await mkdir(outDir);
  await writeFile(join(outDir, 'sentinel.txt'), 'working runtime');

  await expect(downloadWtdRuntime({ outDir, reuseExisting: false }))
    .rejects.toThrow('Failed to download');

  expect(await readFile(join(outDir, 'sentinel.txt'), 'utf8')).toBe('working runtime');
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function bytesResponse(body: string): Response {
  return new Response(Buffer.from(body), { status: 200 });
}

function runtimeFiles(): Record<string, string> {
  const manifest = JSON.stringify({ version: '0.4.3' });
  const release = JSON.stringify({
    hfRepo: 'ianphil/wtd-mixed-v1',
    hfRevision: 'v0.4.3',
    version: '0.4.3',
  });
  const checksums = JSON.stringify({
    'manifest.json': sha256(manifest),
    'release.json': sha256(release),
  });
  return {
    'manifest.json': manifest,
    'release.json': release,
    'checksums.json': checksums,
  };
}

function mockRuntimeFetch(files: Record<string, string>) {
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  fetchMock.mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/models/')) {
      return jsonResponse({
        siblings: Object.keys(files).map((rfilename) => ({ rfilename })),
      });
    }
    const filename = decodeURIComponent(url.split('/').at(-1) ?? '');
    return bytesResponse(files[filename] ?? '');
  });
  return fetchMock;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ttasks-wtd-download-'));
  tempDirs.push(dir);
  return dir;
}
