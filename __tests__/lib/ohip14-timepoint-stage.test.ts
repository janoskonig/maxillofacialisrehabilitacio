import { describe, expect, it } from 'vitest';
import { getTimepointAvailability } from '@/lib/ohip14-timepoint-stage';
import { OHIP14_TIMEPOINTS } from '@/lib/types';

describe('getTimepointAvailability', () => {
  const delivery = new Date('2026-04-22T12:00:00+02:00');

  const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);

  it('opens T1 immediately at delivery', () => {
    const avail = getTimepointAvailability('T1', 'STAGE_6', delivery, delivery);
    expect(avail.allowed).toBe(true);
    expect(avail.opensAt).toEqual(delivery);
    expect(avail.closesAt).toBeDefined();
  });

  it('blocks T1 before the delivery date (future-dated stage event)', () => {
    const now = addDays(delivery, -1);
    const avail = getTimepointAvailability('T1', 'STAGE_6', delivery, now);
    expect(avail.allowed).toBe(false);
  });

  it('blocks T1..T5 without a delivery date', () => {
    for (const tp of ['T1', 'T2', 'T3', 'T4', 'T5'] as const) {
      const avail = getTimepointAvailability(tp, 'STAGE_5', null);
      expect(avail.allowed).toBe(false);
      expect(avail.opensAt).toBeUndefined();
    }
  });

  it('closes T1 exactly when T2 opens at 1 month (no gap, no overlap)', () => {
    const atT2Open = addDays(delivery, 30);
    expect(getTimepointAvailability('T1', 'STAGE_6', delivery, atT2Open).allowed).toBe(false);
    expect(getTimepointAvailability('T2', 'STAGE_6', delivery, atT2Open).allowed).toBe(true);
  });

  it('opens the windows on the new schedule (0d / 30d / 180d / 365d / 1095d)', () => {
    const expectOpen = (day: number) =>
      (['T1', 'T2', 'T3', 'T4', 'T5'] as const).find(
        (tp) => getTimepointAvailability(tp, 'STAGE_6', delivery, addDays(delivery, day)).allowed,
      );
    expect(expectOpen(0)).toBe('T1');
    expect(expectOpen(29)).toBe('T1');
    expect(expectOpen(30)).toBe('T2');
    expect(expectOpen(179)).toBe('T2');
    expect(expectOpen(180)).toBe('T3');
    expect(expectOpen(364)).toBe('T3');
    expect(expectOpen(365)).toBe('T4');
    expect(expectOpen(1094)).toBe('T4');
    expect(expectOpen(1095)).toBe('T5');
  });

  it('allows a later timepoint even if earlier ones were never filled', () => {
    // No gaps anywhere: every day from delivery on, exactly one timepoint is open.
    for (const day of [0, 15, 30, 100, 180, 365, 912, 1095, 3000]) {
      const now = addDays(delivery, day);
      const open = (['T1', 'T2', 'T3', 'T4', 'T5'] as const).filter(
        (tp) => getTimepointAvailability(tp, 'STAGE_6', delivery, now).allowed,
      );
      expect(open).toHaveLength(1);
    }
  });

  it('keeps T5 open indefinitely (no upper bound)', () => {
    const avail = getTimepointAvailability('T5', 'STAGE_6', delivery, addDays(delivery, 5000));
    expect(avail.allowed).toBe(true);
    expect(avail.closesAt).toBeUndefined();
  });

  it('uses the delivery-relative windows regardless of current stage (STAGE_7 too)', () => {
    const avail = getTimepointAvailability('T1', 'STAGE_7', delivery, addDays(delivery, 1));
    expect(avail.allowed).toBe(true);
  });

  it('blocks T0 after prosthetic phase (STAGE_5+)', () => {
    const avail = getTimepointAvailability('T0', 'STAGE_5', delivery);
    expect(avail.allowed).toBe(false);
  });

  it('allows T0 before the prosthetic phase and with no stage set', () => {
    expect(getTimepointAvailability('T0', 'STAGE_2', null).allowed).toBe(true);
    expect(getTimepointAvailability('T0', null, null).allowed).toBe(true);
  });

  it('has T0..T5 in the shared timepoint list, in order', () => {
    expect(OHIP14_TIMEPOINTS).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
  });
});
