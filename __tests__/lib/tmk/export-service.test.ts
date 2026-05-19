import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tmk/feature-flags', () => ({
  getComplianceFeatureFlag: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDbPool: vi.fn(),
}));

import { getComplianceFeatureFlag } from '@/lib/tmk/feature-flags';
import { createAnalysisExport } from '@/lib/tmk/export-service';

describe('createAnalysisExport', () => {
  beforeEach(() => {
    vi.mocked(getComplianceFeatureFlag).mockReset();
  });

  it('returns null when research_export_pipeline is off', async () => {
    vi.mocked(getComplianceFeatureFlag).mockResolvedValue(false);
    const result = await createAnalysisExport({
      exportLabel: 'test',
      schemaVersion: '1.0',
      queryDefinition: {},
      rows: [{ anonymizedSubjectKey: 'abc' }],
      keyColumns: ['anonymizedSubjectKey'],
    });
    expect(result).toBeNull();
  });

  it('rejects PHI rows when flag is on', async () => {
    vi.mocked(getComplianceFeatureFlag).mockResolvedValue(true);
    await expect(
      createAnalysisExport({
        exportLabel: 'test',
        schemaVersion: '1.0',
        queryDefinition: {},
        rows: [{ nev: 'Teszt' }],
        keyColumns: ['nev'],
      })
    ).rejects.toThrow(/PHI/);
  });
});
