/**
 * Deterministic hash spec for reproducible research exports.
 * Golden tests verify cross-locale stability.
 */

import { createHash } from 'crypto';

export const EXPORT_HASH_SPEC_VERSION = 'v1';

export interface DeterministicHashOptions {
  nullPolicy?: 'empty_string' | 'null_literal';
  timezone?: 'UTC';
  decimalPrecision?: number;
}

const DEFAULT_OPTIONS: Required<DeterministicHashOptions> = {
  nullPolicy: 'empty_string',
  timezone: 'UTC',
  decimalPrecision: 10,
};

/** Canonicalize a value for stable hashing. */
export function canonicalizeValue(
  value: unknown,
  opts: DeterministicHashOptions = {}
): string {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  if (value === null || value === undefined) {
    return o.nullPolicy === 'empty_string' ? '' : 'null';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NaN';
    return Number(value.toFixed(o.decimalPrecision)).toString();
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeValue(v, opts)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeValue(obj[k], opts)}`).join(',')}}`;
  }
  return JSON.stringify(String(value).normalize('NFC'));
}

/** Stable row ordering: sort by declared key columns ascending. */
export function sortRowsCanonically<T extends Record<string, unknown>>(
  rows: T[],
  keyColumns: (keyof T)[]
): T[] {
  return [...rows].sort((a, b) => {
    for (const col of keyColumns) {
      const av = canonicalizeValue(a[col]);
      const bv = canonicalizeValue(b[col]);
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
}

/** Compute SHA-256 content hash over canonical JSON rows. */
export function computeExportContentHash(
  rows: Record<string, unknown>[],
  keyColumns: string[],
  opts?: DeterministicHashOptions
): string {
  const sorted = sortRowsCanonically(rows, keyColumns);
  const canonical = sorted.map((row) => {
    const keys = Object.keys(row).sort();
    const normalized: Record<string, string> = {};
    for (const k of keys) {
      normalized[k] = canonicalizeValue(row[k], opts);
    }
    return normalized;
  });
  const payload = JSON.stringify(canonical);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Manifest checksum wraps export metadata + content hash. */
export function computeManifestHash(manifest: Record<string, unknown>): string {
  const canonical = canonicalizeValue(manifest);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function buildChecksumHierarchy(contentHash: string, chunkHashes: string[] = []): Record<string, unknown> {
  const chunkRoot =
    chunkHashes.length > 0
      ? createHash('sha256').update(chunkHashes.sort().join('|'), 'utf8').digest('hex')
      : contentHash;
  const manifestHash = computeManifestHash({ contentHash, chunkRoot });
  return {
    specVersion: EXPORT_HASH_SPEC_VERSION,
    contentHash,
    chunkRoot,
    manifestHash,
    chunks: chunkHashes,
  };
}
