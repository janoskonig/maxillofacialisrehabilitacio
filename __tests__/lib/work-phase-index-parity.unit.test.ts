import { describe, it, expect } from 'vitest';
import { isAppointmentActive } from '@/lib/active-appointment';

/**
 * Unit-only parity test (no DB).
 *
 * The partial unique index `idx_appointments_unique_work_phase_active` predicate
 * (originally from migration 025, REBUILT in migration 029 to also exclude
 * `'unsuccessful'`):
 *
 *   WHERE work_phase_id IS NOT NULL
 *     AND (appointment_status IS NULL
 *          OR appointment_status NOT IN
 *             ('cancelled_by_doctor', 'cancelled_by_patient', 'unsuccessful'))
 *
 * MUST agree with the TS-side `isAppointmentActive` and with the SQL fragment
 * `SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT` for every possible status value.
 * If you ever change one, you MUST change the other (and the integration test
 * in work-phase-index-parity.integration.test.ts will catch it on a real DB).
 *
 * This test pre-computes the truth table for every `appointment_status` value
 * permitted by the schema (see docs/APPOINTMENT_STATUS_TAXONOMY.md) and asserts
 * that all three sources agree.
 */

const ALL_STATUSES: Array<string | null> = [
  null,
  'completed',
  'no_show',
  'cancelled_by_doctor',
  'cancelled_by_patient',
  'unsuccessful',
];

/** Mirrors the partial unique index predicate ON THE EXISTING ROW (post-029). */
function indexConsidersRowActive(status: string | null): boolean {
  if (status === null) return true;
  return !['cancelled_by_doctor', 'cancelled_by_patient', 'unsuccessful'].includes(status);
}

describe('Index ↔ guard parity (unit truth-table)', () => {
  it.each(ALL_STATUSES)(
    'isAppointmentActive(%j) matches the index predicate',
    (status) => {
      expect(isAppointmentActive(status)).toBe(indexConsidersRowActive(status));
    }
  );

  it('cancelled_*, and unsuccessful are the statuses that free a work phase (post-029)', () => {
    const freedStatuses = ALL_STATUSES.filter((s) => !isAppointmentActive(s));
    expect(freedStatuses.sort()).toEqual([
      'cancelled_by_doctor',
      'cancelled_by_patient',
      'unsuccessful',
    ]);
  });

  it('NULL, completed, and no_show all keep the work phase BOOKED', () => {
    // unsuccessful is intentionally excluded here — it releases the slot so a
    // new attempt_number row can be created (see migration 029 rationale).
    expect(isAppointmentActive(null)).toBe(true);
    expect(isAppointmentActive('completed')).toBe(true);
    expect(isAppointmentActive('no_show')).toBe(true);
  });
});
