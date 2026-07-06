import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ChecksumEntry = string | {
  sha256?: string;
  checksum?: string;
  hash?: string;
};

export type ChecksumsFile = Record<string, ChecksumEntry>;

export async function verifyBundleChecksums(bundlePath: string, checksums: ChecksumsFile): Promise<void> {
  const failures: string[] = [];

  for (const [file, entry] of Object.entries(checksums)) {
    const expected = expectedSha256(entry);
    if (!expected) {
      continue;
    }

    const actual = await sha256File(join(bundlePath, file));
    if (actual !== expected) {
      failures.push(`${file}: expected ${expected}, got ${actual}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`WTD runtime checksum verification failed:\n${failures.join('\n')}`);
  }
}

function expectedSha256(entry: ChecksumEntry): string | null {
  if (typeof entry === 'string') {
    return normalizeSha256(entry);
  }
  return normalizeSha256(entry.sha256 ?? entry.checksum ?? entry.hash ?? '');
}

function normalizeSha256(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('sha256:')) {
    return trimmed.slice('sha256:'.length);
  }
  return trimmed.length === 64 ? trimmed : null;
}

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}
