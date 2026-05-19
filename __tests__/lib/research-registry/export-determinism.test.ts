import { describe, it, expect } from 'vitest';
import {
  canonicalizeValue,
  computeExportContentHash,
  sortRowsCanonically,
  buildChecksumHierarchy,
} from '@/lib/research-registry/export-determinism';

describe('export-determinism (golden)', () => {
  const sampleRows = [
    { patientId: 'b', score: 10.5, note: null },
    { patientId: 'a', score: 20, note: 'x' },
  ];

  it('produces identical hash regardless of input row order', () => {
    const h1 = computeExportContentHash(sampleRows, ['patientId']);
    const h2 = computeExportContentHash([...sampleRows].reverse(), ['patientId']);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('canonicalizes null as empty string by default', () => {
    expect(canonicalizeValue(null)).toBe('');
    expect(canonicalizeValue(undefined)).toBe('');
  });

  it('sorts rows by key columns', () => {
    const sorted = sortRowsCanonically(sampleRows, ['patientId']);
    expect(sorted[0].patientId).toBe('a');
    expect(sorted[1].patientId).toBe('b');
  });

  it('checksum hierarchy is stable', () => {
    const contentHash = computeExportContentHash(sampleRows, ['patientId']);
    const h1 = buildChecksumHierarchy(contentHash);
    const h2 = buildChecksumHierarchy(contentHash);
    expect(h1).toEqual(h2);
  });
});
