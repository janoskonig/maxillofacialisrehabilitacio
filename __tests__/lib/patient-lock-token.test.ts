import { describe, it, expect } from 'vitest';
import {
  compareLockToken,
  parseLockToken,
  shouldAdoptLockToken,
} from '@/lib/patient-lock-token';

const T0 = '2026-08-15T10:00:00.000Z';
const T1 = '2026-08-15T10:00:05.000Z';

describe('parseLockToken', () => {
  it('Date-et, ISO stringet és null-t is kezel', () => {
    expect(parseLockToken(new Date(T0))?.toISOString()).toBe(T0);
    expect(parseLockToken(T0)?.toISOString()).toBe(T0);
    expect(parseLockToken(`  ${T0}  `)?.toISOString()).toBe(T0);
    expect(parseLockToken(null)).toBeNull();
    expect(parseLockToken(undefined)).toBeNull();
  });

  it('olvashatatlan értékre null (nem dob, nem Invalid Date)', () => {
    expect(parseLockToken('nem-datum')).toBeNull();
    expect(parseLockToken('')).toBeNull();
  });
});

describe('compareLockToken', () => {
  it('egyező token → ok', () => {
    expect(compareLockToken(T0, T0).verdict).toBe('ok');
    // A szerver oldala Date-ként is jöhet (SELECT *), a kliensé mindig string.
    expect(compareLockToken(T0, new Date(T0)).verdict).toBe('ok');
  });

  it('eltérő token → stale, és mindkét oldalt visszaadja', () => {
    const result = compareLockToken(T0, T1);
    expect(result.verdict).toBe('stale');
    expect(result.client?.toISOString()).toBe(T0);
    expect(result.server?.toISOString()).toBe(T1);
  });

  it('hiányzó If-Match → skipped (backward compat)', () => {
    expect(compareLockToken(null, T1).verdict).toBe('skipped');
    expect(compareLockToken('', T1).verdict).toBe('skipped');
  });

  it('olvashatatlan If-Match → skipped, nem stale', () => {
    // A régi viselkedés: parse-hiba esetén figyelmeztetünk és átengedjük.
    expect(compareLockToken('nem-datum', T1).verdict).toBe('skipped');
  });

  it('szerveroldali token hiányában nincs konfliktus', () => {
    expect(compareLockToken(T0, null).verdict).toBe('skipped');
  });

  it('ezredmásodperc pontossággal hasonlít', () => {
    expect(compareLockToken('2026-08-15T10:00:00.001Z', '2026-08-15T10:00:00.002Z').verdict).toBe('stale');
  });
});

describe('shouldAdoptLockToken', () => {
  it('átveszi, ha a kliens naprakész volt és az új token újabb', () => {
    expect(shouldAdoptLockToken(T0, T0, T1)).toBe(true);
  });

  it('NEM veszi át, ha a művelet előtti szerver-token nem egyezik a kliensével', () => {
    // Ez a token-mosás elleni védelem: a fog-lezáró végponton nincs If-Match, így
    // a friss token önmagában nem bizonyítja, hogy a kliens snapshotja aktuális volt.
    // Enélkül egy elavult fül a következő mentésével némán felülírna egy idegen írást.
    const clientToken = '2026-08-15T09:59:00.000Z';
    expect(shouldAdoptLockToken(clientToken, T0, T1)).toBe(false);
  });

  it('NEM veszi át a régebbi tokent (monotonitás)', () => {
    expect(shouldAdoptLockToken(T1, T1, T0)).toBe(false);
  });

  it('azonos tokent sem vesz át (nincs szigorú növekedés)', () => {
    expect(shouldAdoptLockToken(T0, T0, T0)).toBe(false);
  });

  it('hiányzó mezőknél nem vesz át', () => {
    expect(shouldAdoptLockToken(null, T0, T1)).toBe(false);
    expect(shouldAdoptLockToken(T0, null, T1)).toBe(false);
    expect(shouldAdoptLockToken(T0, T0, null)).toBe(false);
  });
});
