import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { loadNeakTreatmentSources } from '@/lib/neak-treatment-sources';

describe('NEAK treatment source loading', () => {
  it('uses patient-scoped queries and catalog labels', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ code: 'complete', label: 'Teljes fogpótlás' }] })
      .mockResolvedValueOnce({ rows: [{ hasToothTreatments: true, hasToothCatalog: true, hasEpisodes: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 't1', toothNumber: 15, status: 'pending', labelHu: 'Tömés' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'e1', status: 'open' }] });
    const result = await loadNeakTreatmentSources({ query } as unknown as Pick<Pool, 'query'>, 'p1');
    expect(result.labels.get('complete')).toBe('Teljes fogpótlás');
    expect(result.toothTreatments[0].labelHu).toBe('Tömés');
    expect(result.episodes[0].id).toBe('e1');
    expect(query.mock.calls[2][1]).toEqual(['p1']);
    expect(query.mock.calls[3][1]).toEqual(['p1']);
    expect(result.warnings).toEqual([]);
  });
  it('reports unavailable optional sources explicitly', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{}] });
    const result = await loadNeakTreatmentSources({ query } as unknown as Pick<Pool, 'query'>, 'p1');
    expect(query).toHaveBeenCalledTimes(2);
    expect(result.warnings).toHaveLength(2);
  });
  it('propagates query failures instead of exporting a false empty plan', async () => {
    const query = vi.fn().mockRejectedValue(new Error('DB unavailable'));
    await expect(loadNeakTreatmentSources({ query } as unknown as Pick<Pool, 'query'>, 'p1')).rejects.toThrow('DB unavailable');
  });
});
