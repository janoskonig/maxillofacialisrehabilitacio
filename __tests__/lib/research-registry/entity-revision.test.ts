import { describe, it, expect } from 'vitest';
import { RevisionConflictError } from '@/lib/research-registry/entity-revision';
import { canTransitionQuality, isExportEligible } from '@/lib/research-registry/quality-state';

describe('entity-revision', () => {
  it('RevisionConflictError exposes code and revisions', () => {
    const err = new RevisionConflictError('patient', 'uuid-1', 2, 3);
    expect(err.code).toBe('REVISION_CONFLICT');
    expect(err.expected).toBe(2);
    expect(err.actual).toBe(3);
  });
});

describe('quality-state', () => {
  it('allows DRAFT -> LOCAL_REVIEW', () => {
    expect(canTransitionQuality('DRAFT', 'LOCAL_REVIEW')).toBe(true);
  });

  it('blocks LOCKED_FOR_ANALYSIS transitions', () => {
    expect(canTransitionQuality('LOCKED_FOR_ANALYSIS', 'DRAFT')).toBe(false);
  });

  it('export eligible only for approved states', () => {
    expect(isExportEligible('REGISTRY_APPROVED')).toBe(true);
    expect(isExportEligible('DRAFT')).toBe(false);
    expect(isExportEligible('LEGACY_UNVERIFIED')).toBe(false);
  });
});
