import { expect, test, vi } from 'vitest';

import { downloadWtdRuntime } from '../src/index.js';

test('downloads runtime files from a pinned Hugging Face revision', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  fetchMock.mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/models/')) {
      return jsonResponse({
        siblings: [
          { rfilename: '.gitattributes' },
          { rfilename: 'manifest.json' },
          { rfilename: 'evals/gold-queries.json' },
        ],
      });
    }
    return bytesResponse(`body:${url}`);
  });

  const dir = await import('node:fs/promises').then(async ({ mkdtemp }) =>
    mkdtemp(`${await import('node:os').then(({ tmpdir }) => tmpdir())}/ttasks-wtd-download-`),
  );

  try {
    const result = await downloadWtdRuntime({ outDir: dir });

    expect(result.repo).toBe('ianphil/wtd-mixed-v1');
    expect(result.revision).toBe('v0.4.0');
    expect(result.files).toEqual(['manifest.json', 'evals/gold-queries.json']);
    expect(fetchMock).toHaveBeenCalledWith('https://huggingface.co/ianphil/wtd-mixed-v1/resolve/v0.4.0/evals/gold-queries.json');
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(dir, { force: true, recursive: true }));
    fetchMock.mockRestore();
  }
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
