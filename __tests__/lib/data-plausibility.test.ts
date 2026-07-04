import { describe, it, expect } from 'vitest';
import {
  isValidTajChecksum,
  getPlausibilityWarnings,
  countToothEntriesWithoutStatus,
} from '@/lib/data-plausibility';

describe('isValidTajChecksum', () => {
  // d9 = (3*(d1+d3+d5+d7) + 7*(d2+d4+d6+d8)) % 10
  // 12345678 → 3*(1+3+5+7) + 7*(2+4+6+8) = 48 + 140 = 188 → 8
  it('accepts a number with a correct check digit', () => {
    expect(isValidTajChecksum('123456788')).toBe(true);
  });

  it('accepts despite separators/spaces', () => {
    expect(isValidTajChecksum('123-456-788')).toBe(true);
    expect(isValidTajChecksum(' 123 456 788 ')).toBe(true);
  });

  it('rejects a wrong check digit (typo)', () => {
    expect(isValidTajChecksum('123456789')).toBe(false);
  });

  it('rejects a transposition typo', () => {
    // swap last two of the base → different checksum
    expect(isValidTajChecksum('123456878')).toBe(false);
  });

  it('rejects non-9-digit input', () => {
    expect(isValidTajChecksum('12345678')).toBe(false);
    expect(isValidTajChecksum('')).toBe(false);
    expect(isValidTajChecksum(null)).toBe(false);
  });
});

describe('getPlausibilityWarnings', () => {
  it('returns no warnings for plausible data', () => {
    expect(
      getPlausibilityWarnings({ taj: '123456788', szuletesiDatum: '1980-05-01' })
    ).toEqual([]);
  });

  it('flags an invalid TAJ checksum', () => {
    const w = getPlausibilityWarnings({ taj: '123456789' });
    expect(w.map((x) => x.code)).toContain('taj_checksum');
  });

  it('does not flag TAJ that is not yet 9 digits (incomplete, not wrong)', () => {
    expect(getPlausibilityWarnings({ taj: '1234' })).toEqual([]);
  });

  it('flags a future birth date', () => {
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const w = getPlausibilityWarnings({ szuletesiDatum: future });
    expect(w.map((x) => x.code)).toContain('birth_future');
  });

  it('flags an implausible age (>120)', () => {
    const w = getPlausibilityWarnings({ szuletesiDatum: '1850-01-01' });
    expect(w.map((x) => x.code)).toContain('age_implausible');
  });

  it('flags death before birth', () => {
    const w = getPlausibilityWarnings({
      szuletesiDatum: '1980-01-01',
      halalDatum: '1979-01-01',
    });
    expect(w.map((x) => x.code)).toContain('death_before_birth');
  });
});

describe('countToothEntriesWithoutStatus / fogak_statusz_nelkul', () => {
  it('nem jelez string státuszú (D/F/M) bejegyzésre', () => {
    expect(countToothEntriesWithoutStatus({ '18': 'M', '17': 'F', '16': 'D' })).toBe(0);
  });

  it('nem jelez objektumra, ha van státusza', () => {
    expect(
      countToothEntriesWithoutStatus({ '18': { status: 'M', description: 'régen eltávolítva' } })
    ).toBe(0);
  });

  it('számolja a csak leírásos (státusz nélküli) bejegyzést', () => {
    expect(
      countToothEntriesWithoutStatus({
        '18': { description: 'korona' },
        '17': { status: 'F' },
        '16': { description: 'csapos fog' },
      })
    ).toBe(2);
  });

  it('üres/hiányzó odontogramra 0', () => {
    expect(countToothEntriesWithoutStatus(null)).toBe(0);
    expect(countToothEntriesWithoutStatus({})).toBe(0);
    expect(countToothEntriesWithoutStatus({ '18': {} })).toBe(0);
  });

  it('a getPlausibilityWarnings figyelmeztetést ad rá', () => {
    const w = getPlausibilityWarnings({ meglevoFogak: { '18': { description: 'korona' } } });
    expect(w.map((x) => x.code)).toContain('fogak_statusz_nelkul');
  });

  it('státuszos odontogramra nincs figyelmeztetés', () => {
    const w = getPlausibilityWarnings({ meglevoFogak: { '18': 'M' } });
    expect(w.map((x) => x.code)).not.toContain('fogak_statusz_nelkul');
  });
});
