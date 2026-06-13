import { describe, it, expect } from 'vitest';
import { extractFirstNumber } from '@/lib/derived-numerics';

describe('extractFirstNumber', () => {
  it('parses a plain integer', () => {
    expect(extractFirstNumber('60 Gy')).toBe(60);
  });

  it('parses a decimal with a dot', () => {
    expect(extractFirstNumber('1.5 Gy')).toBe(1.5);
  });

  it('parses a decimal with a comma (Hungarian)', () => {
    expect(extractFirstNumber('2,5')).toBe(2.5);
  });

  it('takes the first value from a range', () => {
    expect(extractFirstNumber('60–66 Gy')).toBe(60);
    expect(extractFirstNumber('60-66')).toBe(60);
  });

  it('handles a number with no unit', () => {
    expect(extractFirstNumber('20')).toBe(20);
  });

  it('returns null for non-numeric / empty / nullish input', () => {
    expect(extractFirstNumber('nincs adat')).toBeNull();
    expect(extractFirstNumber('')).toBeNull();
    expect(extractFirstNumber(null)).toBeNull();
    expect(extractFirstNumber(undefined)).toBeNull();
  });

  it('ignores leading text and grabs the embedded number', () => {
    expect(extractFirstNumber('kb. 30 szál/nap')).toBe(30);
  });
});
