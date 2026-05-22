import { describe, it, expect } from 'vitest';
import { computePhaseWindowChain } from '@/lib/phase-window-chain';

describe('computePhaseWindowChain', () => {
  const anchor = new Date('2025-01-01T10:00:00Z');

  it('következő fázis nem kezdődhet a korábbi foglalás előtt', () => {
    const booked = new Date('2025-02-10T09:00:00Z');
    const chain = computePhaseWindowChain(
      [
        {
          workPhaseCode: 'phase_a',
          defaultDaysOffset: 0,
          status: 'scheduled',
          completedAt: null,
          bookedStart: booked,
        },
        {
          workPhaseCode: 'phase_b',
          defaultDaysOffset: 7,
          status: 'pending',
          completedAt: null,
          bookedStart: null,
        },
      ],
      anchor
    );

    const phaseB = chain.get('phase_b');
    expect(phaseB).toBeDefined();
    // offset 7 → minimum 2025-02-17 (10. + 7 nap), nem lehet február 2.
    expect(phaseB!.earliestAllowedStart.getTime()).toBeGreaterThanOrEqual(
      new Date('2025-02-17T00:00:00Z').getTime()
    );
    expect(phaseB!.earliestAllowedStart.getTime()).toBeGreaterThan(
      new Date('2025-02-10T09:00:00Z').getTime()
    );
  });
});
