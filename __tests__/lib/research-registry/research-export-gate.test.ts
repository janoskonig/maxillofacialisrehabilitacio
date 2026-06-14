import { describe, it, expect } from 'vitest';
import {
  assertResearchExportModeAllowsCohortExport,
  ResearchExportBlockedError,
} from '@/lib/research-registry/research-export-gate';

describe('research-export-gate', () => {
  it('blocks cohort export while RESEARCH_EXPORT_MODE is disabled', async () => {
    // Mode is 'disabled', so the gate throws before touching the DB (ethics check).
    await expect(assertResearchExportModeAllowsCohortExport()).rejects.toBeInstanceOf(
      ResearchExportBlockedError
    );
  });
});
