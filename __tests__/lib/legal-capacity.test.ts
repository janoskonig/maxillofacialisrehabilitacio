import { describe, it, expect } from 'vitest';
import {
  computeAgeYears,
  requiresGuardian,
  GUARDIAN_REQUIRED_BELOW_AGE,
} from '@/lib/legal/legal-capacity';

const NOW = new Date('2026-06-14T00:00:00Z');

describe('computeAgeYears', () => {
  it('returns null for missing/invalid input', () => {
    expect(computeAgeYears(null, NOW)).toBeNull();
    expect(computeAgeYears('', NOW)).toBeNull();
    expect(computeAgeYears('not-a-date', NOW)).toBeNull();
  });

  it('computes whole years, accounting for birthday not yet reached', () => {
    expect(computeAgeYears('2000-01-01', NOW)).toBe(26);
    expect(computeAgeYears('2000-12-31', NOW)).toBe(25); // birthday later this year
  });

  it('handles a birthday exactly today', () => {
    expect(computeAgeYears('2008-06-14', NOW)).toBe(18);
  });
});

describe('requiresGuardian', () => {
  it('is true below the threshold', () => {
    expect(requiresGuardian('2015-06-14', NOW)).toBe(true);
  });

  it('is false at/above the threshold', () => {
    expect(requiresGuardian('2008-06-14', NOW)).toBe(false); // exactly 18
    expect(requiresGuardian('1990-01-01', NOW)).toBe(false);
  });

  it('is false when birth date is unknown (handled elsewhere)', () => {
    expect(requiresGuardian(null, NOW)).toBe(false);
  });

  it('uses the documented threshold constant', () => {
    expect(GUARDIAN_REQUIRED_BELOW_AGE).toBe(18);
  });
});
