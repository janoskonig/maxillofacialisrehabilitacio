import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { buildNeakExportPlan, NEAK_EXPORT_LIMITS, withNeakDownloadTimeout } from '@/lib/neak-export';
import type { Patient } from '@/lib/types';

const patient = {
  nev: 'Teszt Elek', nem: 'férfi', szuletesiDatum: '1980-01-01', taj: '123456789',
  kezelesreErkezesIndoka: 'rehabilitáció', diagnozis: 'teszt', meglevoFogak: ['11'],
} as unknown as Patient;
const op = { id: 'op', filename: 'op.jpg', tags: [' OP '], fileSize: '123' };

describe('NEAK export plan', () => {
  it('blocks missing hard fields even with the required attachment present', () => {
    const plan = buildNeakExportPlan({ ...patient, nev: '' }, [op]);
    expect(plan.isReady).toBe(false);
    expect(plan.missingFields).toContainEqual({ key: 'nev', label: 'Név' });
    expect(plan.missingDocRules).toEqual([]);
    expect(plan.checklistSummary.hasErrors).toBe(true);
  });

  it('normalizes document tags and numeric database sizes; email is a warning', () => {
    const plan = buildNeakExportPlan(patient, [op]);
    expect(plan.isReady).toBe(true);
    expect(plan.estimatedTotalBytes).toBe(123);
    expect(plan.warnings).toContain('Ajánlott adat hiányzik: Email.');
  });

  it('reports required document counts using human readable labels', () => {
    const plan = buildNeakExportPlan(patient, []);
    expect(plan.isReady).toBe(false);
    expect(plan.missingDocRules).toEqual([{ tag: 'op', label: 'OP röntgenfelvétel', minCount: 1, actualCount: 0 }]);
  });

  it('selects the latest quote even if it also has another export tag, and orders deterministically', () => {
    const docs = [op,
      { id: 'a', tags: ['árajánlat'], uploadedAt: '2026-01-02' },
      { id: 'b', tags: ['árajánlat', 'technikus méltányossági'], uploadedAt: '2026-01-03' },
      { id: 'c', tags: ['allergia_vizsgálat'] },
      { id: 'z', tags: ['egyéb'] },
    ];
    const plan = buildNeakExportPlan(patient, docs);
    expect(plan.includedDocuments.map((doc) => doc.id)).toEqual(['b', 'c', 'op']);
    expect(buildNeakExportPlan(patient, [...docs].reverse()).includedDocuments).toEqual(plan.includedDocuments);
  });

  it('breaks equal quote timestamps by id and falls back to creation time', () => {
    const plan = buildNeakExportPlan(patient, [op,
      { id: 'a', tags: ['arajanlat'], createdAt: '2026-01-02' },
      { id: 'b', tags: ['arajanlat'], createdAt: '2026-01-02' },
    ]);
    expect(plan.includedDocuments.map((doc) => doc.id)).toEqual(['b', 'op']);
  });

  it('preserves technician tag aliases with punctuation and accents', () => {
    const plan = buildNeakExportPlan(patient, [op,
      { id: 'technician', tags: ['Technikus.Méltányossági'] },
    ]);
    expect(plan.includedDocuments.find((doc) => doc.id === 'technician')?.category).toBe('technikus_meltanyossagi');
  });

  it('reports file and total size limits before downloads', () => {
    const plan = buildNeakExportPlan(patient, [{ ...op, fileSize: NEAK_EXPORT_LIMITS.maxTotalBytes + 1 }]);
    expect(plan.isReady).toBe(false);
    expect(plan.limitErrors.map((e) => e.code)).toEqual(['FILE_TOO_LARGE', 'ZIP_TOO_LARGE']);
  });

  it('reports attachment count limits', () => {
    const docs = Array.from({ length: 201 }, (_, i) => ({ ...op, id: String(i) }));
    expect(buildNeakExportPlan(patient, docs).limitErrors[0].code).toBe('TOO_MANY_DOCS');
  });
});

describe('NEAK download deadlines', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('clears the timeout after success', async () => {
    await expect(withNeakDownloadTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears the timeout after failure', async () => {
    await expect(withNeakDownloadTimeout(Promise.reject(new Error('FTP')), 1000)).rejects.toThrow('FTP');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a stalled download', async () => {
    const result = withNeakDownloadTimeout(new Promise(() => {}), 1000);
    const assertion = expect(result).rejects.toThrow('időkorlátot');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
