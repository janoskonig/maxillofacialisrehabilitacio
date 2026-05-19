import { describe, it, expect } from 'vitest';
import {
  assertResearchExportModeAllowsCohortExport,
  ResearchExportBlockedError,
} from '@/lib/research-registry/research-export-gate';

describe('research-export-gate', () => {
  it('blocks cohort export while RESEARCH_EXPORT_MODE is disabled', () => {
    expect(() => assertResearchExportModeAllowsCohortExport()).toThrow(
      ResearchExportBlockedError
    );
  });
});
