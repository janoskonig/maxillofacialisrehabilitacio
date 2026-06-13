import { describe, expect, it } from 'vitest';
import { getTimepointAvailability } from '@/lib/ohip14-timepoint-stage';

describe('getTimepointAvailability', () => {
  const delivery = new Date('2026-04-22T12:00:00+02:00');

  const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);

  it('allows T1 from its open day (21d) after delivery', () => {
    const now = new Date('2026-05-27T12:00:00+02:00');
    const avail = getTimepointAvailability('T1', 'STAGE_5', delivery, now);
    expect(avail.allowed).toBe(true);
    expect(avail.opensAt).toBeDefined();
    expect(avail.closesAt).toBeDefined();
  });

  it('blocks T1 before the window opens', () => {
    const now = new Date('2026-05-01T12:00:00+02:00');
    const avail = getTimepointAvailability('T1', 'STAGE_5', delivery, now);
    expect(avail.allowed).toBe(false);
  });

  it('keeps T1 fillable past the old 56-day cap, until T2 opens', () => {
    // Day 100: previously closed (old window 21–56), now still open (closes at T2 = day 150)
    const now = addDays(delivery, 100);
    const avail = getTimepointAvailability('T1', 'STAGE_5', delivery, now);
    expect(avail.allowed).toBe(true);
  });

  it('closes T1 exactly when T2 opens (no gap, no overlap)', () => {
    const atT2Open = addDays(delivery, 150);
    expect(getTimepointAvailability('T1', 'STAGE_5', delivery, atT2Open).allowed).toBe(false);
    expect(getTimepointAvailability('T2', 'STAGE_5', delivery, atT2Open).allowed).toBe(true);
  });

  it('allows a later timepoint even if earlier ones were never filled', () => {
    // No gaps anywhere: every day after T1 opens, exactly one timepoint is open.
    for (const day of [21, 80, 150, 400, 912, 2000]) {
      const now = addDays(delivery, day);
      const anyOpen = (['T1', 'T2', 'T3'] as const).some(
        (tp) => getTimepointAvailability(tp, 'STAGE_5', delivery, now).allowed,
      );
      expect(anyOpen).toBe(true);
    }
  });

  it('keeps T3 open indefinitely (no upper bound)', () => {
    const avail = getTimepointAvailability('T3', 'STAGE_5', delivery, addDays(delivery, 5000));
    expect(avail.allowed).toBe(true);
    expect(avail.closesAt).toBeUndefined();
  });

  it('blocks T0 after prosthetic phase (STAGE_5+)', () => {
    const avail = getTimepointAvailability('T0', 'STAGE_5', delivery);
    expect(avail.allowed).toBe(false);
  });
});
