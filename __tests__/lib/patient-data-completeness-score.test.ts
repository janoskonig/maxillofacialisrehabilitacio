import { describe, it, expect } from 'vitest';
import {
  computeCompletenessScore,
  NA_ELIGIBLE_KEYS,
  naFieldLabel,
} from '@/lib/patient-data-completeness';

describe('computeCompletenessScore', () => {
  it('is 100 when nothing is missing', () => {
    expect(
      computeCompletenessScore({
        clinicalApplicable: 9,
        clinicalMissing: 0,
        researchApplicable: 2,
        researchMissing: 0,
      })
    ).toBe(100);
  });

  it('is 0 when everything applicable is missing', () => {
    expect(
      computeCompletenessScore({
        clinicalApplicable: 9,
        clinicalMissing: 9,
        researchApplicable: 1,
        researchMissing: 1,
      })
    ).toBe(0);
  });

  it('computes the proportion of present applicable items', () => {
    // 10 applicable, 2 missing → 8/10 = 80
    expect(
      computeCompletenessScore({
        clinicalApplicable: 9,
        clinicalMissing: 1,
        researchApplicable: 1,
        researchMissing: 1,
      })
    ).toBe(80);
  });

  it('rounds to the nearest integer', () => {
    // 9 applicable, 1 missing → 8/9 = 88.88 → 89
    expect(
      computeCompletenessScore({
        clinicalApplicable: 9,
        clinicalMissing: 1,
        researchApplicable: 0,
        researchMissing: 0,
      })
    ).toBe(89);
  });

  it('ignores non-applicable research fields in the denominator', () => {
    // A patient with no applicable research fields: only clinical counts.
    // 9 applicable, 0 missing → 100 (OHIP/Brown/etc. not held against them)
    expect(
      computeCompletenessScore({
        clinicalApplicable: 9,
        clinicalMissing: 0,
        researchApplicable: 0,
        researchMissing: 0,
      })
    ).toBe(100);
  });

  it('returns 100 when nothing is applicable (degenerate case)', () => {
    expect(
      computeCompletenessScore({
        clinicalApplicable: 0,
        clinicalMissing: 0,
        researchApplicable: 0,
        researchMissing: 0,
      })
    ).toBe(100);
  });

  it('clamps to the 0–100 range', () => {
    expect(
      computeCompletenessScore({
        clinicalApplicable: 2,
        clinicalMissing: 5,
        researchApplicable: 0,
        researchMissing: 0,
      })
    ).toBe(0);
  });
});

describe('N/A field eligibility', () => {
  it('allows the conditional research fields to be marked N/A', () => {
    for (const key of ['ohipT0', 'tnmStaging', 'brownFuggoleges', 'kovacsDobak', 'radioterapiaDozis']) {
      expect(NA_ELIGIBLE_KEYS.has(key)).toBe(true);
    }
  });

  it('does not allow clinical-minimum fields to be marked N/A', () => {
    for (const key of ['nev', 'taj', 'email', 'diagnozis', 'doc:op']) {
      expect(NA_ELIGIBLE_KEYS.has(key)).toBe(false);
    }
  });

  it('resolves a human-readable label for eligible keys, null otherwise', () => {
    expect(naFieldLabel('tnmStaging')).toBe('TNM-staging');
    expect(naFieldLabel('nev')).toBeNull();
  });
});
