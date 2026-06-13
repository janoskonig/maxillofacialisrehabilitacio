import { describe, it, expect } from 'vitest';
import {
  scoreUwqol,
  isValidDomainScore,
  UWQOL_DOMAINS,
  UWQOL_DOMAIN_KEYS,
} from '@/lib/pro/uwqol';

describe('UW-QOL structure', () => {
  it('has 12 domains split 6/6 across the two subscales', () => {
    expect(UWQOL_DOMAINS).toHaveLength(12);
    expect(UWQOL_DOMAINS.filter((d) => d.subscale === 'physical')).toHaveLength(6);
    expect(UWQOL_DOMAINS.filter((d) => d.subscale === 'social_emotional')).toHaveLength(6);
  });
});

describe('isValidDomainScore', () => {
  it('accepts 0..100 numbers', () => {
    expect(isValidDomainScore(0)).toBe(true);
    expect(isValidDomainScore(100)).toBe(true);
    expect(isValidDomainScore(55)).toBe(true);
  });
  it('rejects out-of-range / non-numbers', () => {
    expect(isValidDomainScore(-1)).toBe(false);
    expect(isValidDomainScore(101)).toBe(false);
    expect(isValidDomainScore('50')).toBe(false);
    expect(isValidDomainScore(null)).toBe(false);
    expect(isValidDomainScore(undefined)).toBe(false);
    expect(isValidDomainScore(NaN)).toBe(false);
  });
});

describe('scoreUwqol', () => {
  it('averages all 12 domains for the composite and 6 each for subscales', () => {
    const answers: Record<string, number> = {};
    for (const k of UWQOL_DOMAIN_KEYS) answers[k] = 100;
    const s = scoreUwqol(answers);
    expect(s.composite).toBe(100);
    expect(s.physicalSubscale).toBe(100);
    expect(s.socialEmotionalSubscale).toBe(100);
    expect(s.answeredDomains).toBe(12);
  });

  it('computes correct subscale means when subscales differ', () => {
    const answers: Record<string, number> = {};
    for (const d of UWQOL_DOMAINS) answers[d.key] = d.subscale === 'physical' ? 60 : 30;
    const s = scoreUwqol(answers);
    expect(s.physicalSubscale).toBe(60);
    expect(s.socialEmotionalSubscale).toBe(30);
    expect(s.composite).toBe(45); // (6*60 + 6*30)/12
  });

  it('ignores missing domains rather than treating them as zero', () => {
    // Only two physical domains answered.
    const s = scoreUwqol({ chewing: 80, swallowing: 40 });
    expect(s.answeredDomains).toBe(2);
    expect(s.physicalSubscale).toBe(60); // (80+40)/2
    expect(s.socialEmotionalSubscale).toBeNull();
    expect(s.composite).toBe(60);
  });

  it('ignores invalid values', () => {
    const s = scoreUwqol({ pain: 50, mood: 150, anxiety: 'x' as unknown as number });
    expect(s.answeredDomains).toBe(1);
    expect(s.socialEmotionalSubscale).toBe(50);
  });

  it('returns nulls for an empty response', () => {
    const s = scoreUwqol({});
    expect(s).toEqual({
      physicalSubscale: null,
      socialEmotionalSubscale: null,
      composite: null,
      answeredDomains: 0,
    });
  });

  it('rounds to 2 decimals', () => {
    const s = scoreUwqol({ pain: 33, mood: 34 });
    expect(s.socialEmotionalSubscale).toBe(33.5);
  });
});
