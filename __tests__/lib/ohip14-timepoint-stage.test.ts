import { describe, expect, it } from 'vitest';
import { getTimepointAvailability } from '@/lib/ohip14-timepoint-stage';

describe('getTimepointAvailability', () => {
  const delivery = new Date('2026-04-22T12:00:00+02:00');

  it('allows T1 within 21–56 days after delivery', () => {
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

  it('blocks T0 after prosthetic phase (STAGE_5+)', () => {
    const avail = getTimepointAvailability('T0', 'STAGE_5', delivery);
    expect(avail.allowed).toBe(false);
  });
});
