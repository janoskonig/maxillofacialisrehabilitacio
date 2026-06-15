import { describe, it, expect } from 'vitest';
import { budapestHour } from '@/lib/datetime';

/**
 * Regression test for the no-show-risk timezone fix: the clinic-local hour must
 * be Budapest time (DST-correct), not server-local. Asserting on UTC inputs so
 * the result is independent of where the test runs.
 */
describe('budapestHour', () => {
  it('uses summer offset (UTC+2) — 06:00Z is 08:00 in Budapest', () => {
    expect(budapestHour(new Date('2026-07-01T06:00:00Z'))).toBe(8);
  });

  it('uses winter offset (UTC+1) — 06:00Z is 07:00 in Budapest', () => {
    expect(budapestHour(new Date('2026-01-01T06:00:00Z'))).toBe(7);
  });

  it('normalises midnight to 0 (not 24)', () => {
    // 22:00Z in summer (UTC+2) → 00:00 Budapest next day.
    expect(budapestHour(new Date('2026-07-01T22:00:00Z'))).toBe(0);
  });

  it('flags the early-morning risk window correctly across DST', () => {
    // An 08:00 Budapest appointment is in the 7–9h risk window in BOTH seasons,
    // even though the UTC hour differs (06:00 summer vs 07:00 winter).
    const summer = budapestHour(new Date('2026-07-01T06:00:00Z')); // 08:00 local
    const winter = budapestHour(new Date('2026-01-01T07:00:00Z')); // 08:00 local
    expect(summer).toBe(8);
    expect(winter).toBe(8);
  });
});
