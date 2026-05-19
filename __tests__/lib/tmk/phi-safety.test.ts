import { describe, it, expect } from 'vitest';
import { scanForPhiLeaks, assertExportPhiSafe } from '@/lib/tmk/phi-safety';

describe('phi-safety', () => {
  it('detects TAJ pattern', () => {
    const result = scanForPhiLeaks('beteg TAJ: 123 456 789');
    expect(result.clean).toBe(false);
    expect(result.findings.some((f) => f.pattern === 'taj')).toBe(true);
  });

  it('allows clean de-identified rows', () => {
    expect(() =>
      assertExportPhiSafe([
        { anonymizedSubjectKey: 'abc', ageBandStart: 50, regionPrefix: '10' },
      ])
    ).not.toThrow();
  });

  it('blocks forbidden PHI keys in export', () => {
    expect(() => assertExportPhiSafe([{ nev: 'Teszt Elek' }])).toThrow(/PHI field/);
  });
});
