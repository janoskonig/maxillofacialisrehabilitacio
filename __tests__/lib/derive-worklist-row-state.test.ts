import { describe, it, expect } from 'vitest';
import {
  deriveWorklistRowState,
  type WorklistItemBackend,
  type WorklistLocalState,
} from '@/lib/worklist-types';

function baseItem(overrides: Partial<WorklistItemBackend> = {}): WorklistItemBackend {
  return {
    episodeId: 'ep-1',
    patientId: 'p-1',
    currentStage: 'STAGE_1',
    nextStep: 'consultation',
    stepCode: 'consultation',
    overdueByDays: 0,
    windowStart: '2026-05-01T08:00:00.000Z',
    windowEnd: '2026-05-15T16:00:00.000Z',
    durationMinutes: 30,
    pool: 'work',
    priorityScore: 50,
    noShowRisk: 0.05,
    ...overrides,
  };
}

const local: WorklistLocalState = {};

describe('deriveWorklistRowState — precedence', () => {
  it('BOOKING_IN_PROGRESS wins over everything', () => {
    const item = baseItem({ status: 'blocked', stepStatus: 'completed', bookedAppointmentId: 'a' });
    const localBusy: WorklistLocalState = { bookingInProgressKeys: new Set(['k']) };
    expect(deriveWorklistRowState(item, localBusy, 'k').state).toBe('BOOKING_IN_PROGRESS');
  });

  it('OVERRIDE_REQUIRED wins over status / stepStatus', () => {
    const item = baseItem({ status: 'blocked' });
    const localOverride: WorklistLocalState = { overrideRequiredKeys: new Set(['k']) };
    expect(deriveWorklistRowState(item, localOverride, 'k').state).toBe('OVERRIDE_REQUIRED');
  });

  it('COMPLETED stepStatus short-circuits', () => {
    expect(deriveWorklistRowState(baseItem({ stepStatus: 'completed' }), local, 'k').state).toBe('COMPLETED');
  });

  it('SKIPPED stepStatus short-circuits', () => {
    expect(deriveWorklistRowState(baseItem({ stepStatus: 'skipped' }), local, 'k').state).toBe('SKIPPED');
  });

  it('BOOKED when bookedAppointmentId is set (and stepStatus is not terminal)', () => {
    const item = baseItem({ bookedAppointmentId: 'a-1', stepStatus: 'scheduled' });
    expect(deriveWorklistRowState(item, local, 'k').state).toBe('BOOKED');
  });

  it('BLOCKED is checked BEFORE NEEDS_REVIEW (regression: blocked episodes were misreported as NEEDS_REVIEW)', () => {
    // A blocked episode often comes back without windows / duration because the
    // backend skips computation; the old precedence ladder reported NEEDS_REVIEW
    // (WINDOW_MISSING) hiding the real BLOCKED reason.
    const item = baseItem({
      status: 'blocked',
      blockedReason: 'NO_CARE_PATHWAY',
      windowStart: null,
      windowEnd: null,
      durationMinutes: 0,
      pool: '',
    });
    expect(deriveWorklistRowState(item, local, 'k').state).toBe('BLOCKED');
  });

  it('NEEDS_REVIEW (MISSING_DURATION) when not blocked and duration missing', () => {
    const item = baseItem({ durationMinutes: 0 });
    const result = deriveWorklistRowState(item, local, 'k');
    expect(result.state).toBe('NEEDS_REVIEW');
    expect(result.reviewReason).toBe('MISSING_DURATION');
  });

  it('NEEDS_REVIEW (WINDOW_MISSING) when not blocked and windows missing', () => {
    const item = baseItem({ windowStart: null });
    const result = deriveWorklistRowState(item, local, 'k');
    expect(result.state).toBe('NEEDS_REVIEW');
    expect(result.reviewReason).toBe('WINDOW_MISSING');
  });

  it('READY when everything is fine', () => {
    expect(deriveWorklistRowState(baseItem({ status: 'ready' }), local, 'k').state).toBe('READY');
  });
});
