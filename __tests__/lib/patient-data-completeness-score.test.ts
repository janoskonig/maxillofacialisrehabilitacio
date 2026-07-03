import { describe, it, expect } from 'vitest';
import {
  computeCompletenessScore,
  completenessItemWeight,
  NA_ELIGIBLE_KEYS,
  naFieldLabel,
} from '@/lib/patient-data-completeness';
import {
  WEIGHT_IDENTITY,
  WEIGHT_CLINICAL,
  WEIGHT_SUPPLEMENTARY,
  RESEARCH_FIELD_WEIGHT,
} from '@/lib/clinical-rules';

describe('computeCompletenessScore (súlyozott)', () => {
  it('100, ha semmi nem hiányzik', () => {
    expect(computeCompletenessScore({ applicableWeight: 20, missingWeight: 0 })).toBe(100);
  });

  it('0, ha minden értelmezhető tétel hiányzik', () => {
    expect(computeCompletenessScore({ applicableWeight: 20, missingWeight: 20 })).toBe(0);
  });

  it('a meglévő súly arányát számolja', () => {
    // 20 összsúlyból 5 hiányzik → 75
    expect(computeCompletenessScore({ applicableWeight: 20, missingWeight: 5 })).toBe(75);
  });

  it('egészre kerekít', () => {
    // 9-ből 1 hiányzik → 88.88 → 89
    expect(computeCompletenessScore({ applicableWeight: 9, missingWeight: 1 })).toBe(89);
  });

  it('100 degenerált esetben (nincs értelmezhető tétel)', () => {
    expect(computeCompletenessScore({ applicableWeight: 0, missingWeight: 0 })).toBe(100);
  });

  it('0–100 közé szorít', () => {
    expect(computeCompletenessScore({ applicableWeight: 2, missingWeight: 5 })).toBe(0);
  });

  it('a súlyos tétel hiánya többet nyom, mint a könnyűé', () => {
    const applicableWeight = 17; // klinikai minimum összsúlya (4×3 + 3×2 + 1×1... a lényeg a reláció)
    const heavyMissing = computeCompletenessScore({
      applicableWeight,
      missingWeight: WEIGHT_IDENTITY,
    });
    const lightMissing = computeCompletenessScore({
      applicableWeight,
      missingWeight: WEIGHT_SUPPLEMENTARY,
    });
    expect(heavyMissing).toBeLessThan(lightMissing);
  });
});

describe('completenessItemWeight', () => {
  it('identitás-mezők 3× súlyt kapnak', () => {
    for (const key of ['nev', 'taj', 'szuletesiDatum', 'diagnozis', 'kezelesreErkezesIndoka']) {
      expect(completenessItemWeight(key)).toBe(WEIGHT_IDENTITY);
    }
  });

  it('klinikai osztályozás / dokumentum 2×', () => {
    expect(completenessItemWeight('nem')).toBe(WEIGHT_CLINICAL);
    expect(completenessItemWeight('meglevoFogak')).toBe(WEIGHT_CLINICAL);
    expect(completenessItemWeight('doc:op')).toBe(WEIGHT_CLINICAL);
  });

  it('kontakt és kutatási mezők 1×', () => {
    expect(completenessItemWeight('email')).toBe(WEIGHT_SUPPLEMENTARY);
    expect(completenessItemWeight('tnmStaging')).toBe(RESEARCH_FIELD_WEIGHT);
    expect(completenessItemWeight('ohipT0')).toBe(RESEARCH_FIELD_WEIGHT);
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
