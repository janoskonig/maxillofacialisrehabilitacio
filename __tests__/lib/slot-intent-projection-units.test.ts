/**
 * Puzzle v2 — vizit-tudatos vetítési egységek (slot-intent projektor).
 *
 * Egy alkalom fázisai EGY egység: a horgony csak az egység után lép, a
 * lépésköz a vizit days_offset-je (fallback: az első tag fázis-offsetje).
 * Vizit nélküli sor egyfős egység — a korábbi, soronkénti működés.
 */
import { describe, it, expect } from 'vitest';
import { groupProjectionUnits } from '@/lib/slot-intent-projection-units';

const step = (code: string, offset: number, visitId: string | null, visitDaysOffset: number | null = null) => ({
  stepCode: code,
  offset,
  visitId,
  visitDaysOffset,
});

describe('groupProjectionUnits', () => {
  it('vizit nélküli sorok egyfős egységek (soronkénti működés)', () => {
    const units = groupProjectionUnits([step('a', 7, null), step('b', 14, null)]);
    expect(units.map((u) => u.members.map((m) => m.stepCode))).toEqual([['a'], ['b']]);
    expect(units.map((u) => u.offset)).toEqual([7, 14]);
  });

  it('egy vizit fázisai egy egységbe kerülnek — az offset a vizit days_offset-je', () => {
    const units = groupProjectionUnits([
      step('csonk', 7, 'v1', 7),
      step('lenyomat', 7, 'v1', 7),
      step('harapas', 7, 'v1', 7),
      step('atadas', 7, 'v2', 14),
    ]);
    expect(units).toHaveLength(2);
    expect(units[0].members.map((m) => m.stepCode)).toEqual(['csonk', 'lenyomat', 'harapas']);
    expect(units[0].offset).toBe(7);
    expect(units[1].members.map((m) => m.stepCode)).toEqual(['atadas']);
    expect(units[1].offset).toBe(14);
  });

  it('NULL vizit-offsetnél az első tag fázis-offsetje él (kompatibilitás)', () => {
    const units = groupProjectionUnits([step('a', 10, 'v1', null), step('b', 3, 'v1', null)]);
    expect(units).toHaveLength(1);
    expect(units[0].offset).toBe(10);
  });

  it('nem szomszédos tagok a vizit ELSŐ előfordulásához csatlakoznak', () => {
    const units = groupProjectionUnits([
      step('a', 7, 'v1', 7),
      step('b', 7, 'v2', 7),
      step('c', 7, 'v1', 7),
    ]);
    expect(units.map((u) => u.members.map((m) => m.stepCode))).toEqual([['a', 'c'], ['b']]);
  });

  it('üres bemenet → üres kimenet', () => {
    expect(groupProjectionUnits([])).toEqual([]);
  });
});
