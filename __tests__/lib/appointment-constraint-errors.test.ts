import { describe, it, expect } from 'vitest';
import {
  translateUniqueViolation,
  isKnownUniqueViolation,
} from '@/lib/appointment-constraint-errors';

function pgUniqueViolation(constraint?: string, detail?: string): { code: string; constraint?: string; detail?: string } {
  return { code: '23505', constraint, detail };
}

describe('translateUniqueViolation', () => {
  it('returns null for non-23505 errors', () => {
    expect(translateUniqueViolation(null)).toBeNull();
    expect(translateUniqueViolation(undefined)).toBeNull();
    expect(translateUniqueViolation({ code: '23503' })).toBeNull();
    expect(translateUniqueViolation(new Error('boom'))).toBeNull();
  });

  it.each([
    ['idx_appointments_unique_pending_step', 'STEP_ALREADY_BOOKED'],
    ['idx_appointments_unique_slot_intent', 'INTENT_ALREADY_CONVERTED'],
    ['idx_appointments_one_hard_next', 'ONE_HARD_NEXT_VIOLATION'],
    ['appointments_time_slot_id_key', 'SLOT_ALREADY_BOOKED'],
    ['idx_appointments_unique_work_phase_active', 'WORK_PHASE_ALREADY_BOOKED'],
  ])('translates %s → %s', (constraint, expectedCode) => {
    const t = translateUniqueViolation(pgUniqueViolation(constraint));
    expect(t).not.toBeNull();
    expect(t?.code).toBe(expectedCode);
    expect(t?.status).toBe(409);
    expect(t?.error).toMatch(/\S/);
  });

  it('falls back to detail/message scan when constraint is missing', () => {
    const t = translateUniqueViolation(
      pgUniqueViolation(undefined, 'duplicate key violates unique index "idx_appointments_one_hard_next"')
    );
    expect(t?.code).toBe('ONE_HARD_NEXT_VIOLATION');
  });

  it('returns null for an unrecognised 23505 (caller should rethrow)', () => {
    const t = translateUniqueViolation(pgUniqueViolation('totally_unknown_index'));
    expect(t).toBeNull();
  });

  it('isKnownUniqueViolation matches translateUniqueViolation', () => {
    expect(isKnownUniqueViolation(pgUniqueViolation('idx_appointments_one_hard_next'))).toBe(true);
    expect(isKnownUniqueViolation(pgUniqueViolation('totally_unknown_index'))).toBe(false);
    expect(isKnownUniqueViolation({ code: '23503' })).toBe(false);
  });
});
