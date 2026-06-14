import { describe, it, expect } from 'vitest';
import { detectSequenceViolations, type SequenceStepInput } from '@/lib/plan-sequence-check';

const step = (over: Partial<SequenceStepInput> & { workPhaseCode: string; orderIndex: number }): SequenceStepInput => ({
  status: 'pending',
  bookedStart: null,
  ...over,
});

const D = (iso: string) => `${iso}T09:00:00.000Z`;

describe('detectSequenceViolations', () => {
  it('no violation when phases are booked in order', () => {
    const v = detectSequenceViolations([
      step({ workPhaseCode: 'w1', orderIndex: 0, status: 'scheduled', bookedStart: D('2026-07-01') }),
      step({ workPhaseCode: 'w2', orderIndex: 1, status: 'scheduled', bookedStart: D('2026-07-15') }),
    ]);
    expect(v).toEqual([]);
  });

  it('no violation when earlier phases are completed', () => {
    const v = detectSequenceViolations([
      step({ workPhaseCode: 'w1', orderIndex: 0, status: 'completed' }),
      step({ workPhaseCode: 'w2', orderIndex: 1, status: 'scheduled', bookedStart: D('2026-07-15') }),
    ]);
    expect(v).toEqual([]);
  });

  it('flags a later booked phase when an earlier phase reverted to pending (unbooked)', () => {
    // w1 failed → pending, unbooked; w2 still booked → out of sequence
    const v = detectSequenceViolations([
      step({ workPhaseCode: 'w1', orderIndex: 0, status: 'pending', bookedStart: null }),
      step({ workPhaseCode: 'w2', orderIndex: 1, status: 'scheduled', bookedStart: D('2026-07-15') }),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].workPhaseCode).toBe('w2');
    expect(v[0].blockingWorkPhaseCode).toBe('w1');
    expect(v[0].reason).toBe('EARLIER_PHASE_NOT_DONE');
  });

  it('flags when an earlier phase is booked LATER than a later phase', () => {
    const v = detectSequenceViolations([
      step({ workPhaseCode: 'w1', orderIndex: 0, status: 'scheduled', bookedStart: D('2026-08-01') }),
      step({ workPhaseCode: 'w2', orderIndex: 1, status: 'scheduled', bookedStart: D('2026-07-15') }),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].workPhaseCode).toBe('w2');
    expect(v[0].reason).toBe('EARLIER_PHASE_BOOKED_LATER');
  });

  it('ignores unbooked later phases (only booked phases can be out of sequence)', () => {
    const v = detectSequenceViolations([
      step({ workPhaseCode: 'w1', orderIndex: 0, status: 'pending', bookedStart: null }),
      step({ workPhaseCode: 'w2', orderIndex: 1, status: 'pending', bookedStart: null }),
    ]);
    expect(v).toEqual([]);
  });

  it('reports at most one violation per booked phase (earliest blocker)', () => {
    const v = detectSequenceViolations([
      step({ workPhaseCode: 'w1', orderIndex: 0, status: 'pending', bookedStart: null }),
      step({ workPhaseCode: 'w2', orderIndex: 1, status: 'pending', bookedStart: null }),
      step({ workPhaseCode: 'w3', orderIndex: 2, status: 'scheduled', bookedStart: D('2026-07-15') }),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].workPhaseCode).toBe('w3');
    expect(v[0].blockingWorkPhaseCode).toBe('w1'); // earliest blocker
  });

  it('uses label in the message when present', () => {
    const v = detectSequenceViolations([
      step({ workPhaseCode: 'w1', orderIndex: 0, status: 'pending', bookedStart: null, label: 'Csavarozás' }),
      step({ workPhaseCode: 'w2', orderIndex: 1, status: 'scheduled', bookedStart: D('2026-07-15'), label: 'Kontroll' }),
    ]);
    expect(v[0].message).toContain('Kontroll');
    expect(v[0].message).toContain('Csavarozás');
  });

  it('sorts by orderIndex regardless of input order', () => {
    const v = detectSequenceViolations([
      step({ workPhaseCode: 'w2', orderIndex: 1, status: 'scheduled', bookedStart: D('2026-07-15') }),
      step({ workPhaseCode: 'w1', orderIndex: 0, status: 'pending', bookedStart: null }),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].workPhaseCode).toBe('w2');
  });
});
