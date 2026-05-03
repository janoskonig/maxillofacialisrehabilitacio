import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  APPOINTMENT_STATUS_VALUES,
  isAppointmentStatus,
  parseAppointmentStatus,
  type AppointmentStatus,
} from '@/lib/appointment-status';

/**
 * Drift detector: the TS canonical list (lib/appointment-status.ts) and the
 * SQL CHECK constraint asserted by migrations 026 (4 values) and 029
 * (`'unsuccessful'` added — sikertelen próba) MUST stay in sync. If they
 * drift, the partial unique index parity tests, the worklist guard, and the
 * status PATCH endpoint will all subtly disagree with the database — exactly
 * the failure mode that the work-phase stabilization plan was meant to close.
 *
 * If this test fails, the fix is ALWAYS one of:
 *   - Add the new value to APPOINTMENT_STATUS_VALUES, AND to the latest
 *     constraint-defining migration, AND update lib/active-appointment.ts to
 *     decide whether the new value is "active" / "visible" / "cancelled" /
 *     "step-releasing".
 *   - OR drop the new value from the migration if it shouldn't be there.
 *
 * Never edit the test to make it pass without doing one of those two things.
 */
const STATUS_CONSTRAINT_MIGRATIONS = [
  '026_assert_appointment_status_check.sql',
  '029_appointment_attempts.sql',
] as const;

function readMigration(name: string): string {
  return readFileSync(join(__dirname, '..', '..', 'database', 'migrations', name), 'utf8');
}

describe('Appointment status taxonomy — TS ↔ SQL parity', () => {
  it('the canonical TS list contains exactly 5 non-null values', () => {
    expect(APPOINTMENT_STATUS_VALUES).toEqual([
      'cancelled_by_doctor',
      'cancelled_by_patient',
      'completed',
      'no_show',
      'unsuccessful',
    ]);
  });

  it('migration 029 lists all 5 canonical values inside its ADD CONSTRAINT block', () => {
    const sql = readMigration('029_appointment_attempts.sql');

    const checkBodyMatch = sql.match(
      /ADD CONSTRAINT appointments_appointment_status_check[\s\S]*?CHECK \(([\s\S]*?)\);/
    );
    expect(checkBodyMatch, 'canonical CHECK block missing from migration 029').toBeTruthy();
    const checkBody = checkBodyMatch![1];

    for (const value of APPOINTMENT_STATUS_VALUES) {
      expect(
        checkBody.includes(`'${value}'`),
        `migration 029 CHECK is missing canonical value: ${value}`
      ).toBe(true);
    }

    // And the migration must NOT contain any string literals that look like
    // appointment statuses but aren't on our list (catches "appointment_status_v2" etc).
    const literalRegex = /'([a-z_]+(?:_by_[a-z]+)?)'/g;
    const allowed = new Set<string>(APPOINTMENT_STATUS_VALUES as readonly string[]);
    let match: RegExpExecArray | null;
    const seen: string[] = [];
    while ((match = literalRegex.exec(checkBody)) !== null) {
      if (!seen.includes(match[1])) seen.push(match[1]);
    }
    seen.forEach((lit) => {
      expect(
        allowed.has(lit),
        `migration 029 CHECK references an unknown appointment_status literal: ${lit}`
      ).toBe(true);
    });
  });

  it.each(STATUS_CONSTRAINT_MIGRATIONS)(
    '%s explicitly accepts NULL (no reliance on SQL 3-valued-logic loophole)',
    (migrationName) => {
      const sql = readMigration(migrationName);
      const checkBodyMatch = sql.match(
        /ADD CONSTRAINT appointments_appointment_status_check[\s\S]*?CHECK \(([\s\S]*?)\);/
      );
      expect(checkBodyMatch, `${migrationName}: canonical CHECK block missing`).toBeTruthy();
      const checkBody = checkBodyMatch![1];

      // NULL must be explicitly accepted, NOT just allowed via SQL three-valued
      // logic ("x IN (...)" returns UNKNOWN for NULL x, which CHECK ignores).
      // See docs/APPOINTMENT_STATUS_TAXONOMY.md → "NULL semantika".
      expect(
        /\bappointment_status\s+IS\s+NULL\b/i.test(checkBody),
        `${migrationName} CHECK must explicitly accept NULL via 'appointment_status IS NULL'`
      ).toBe(true);

      // And must not have an inadvertent NOT NULL constraint snuck in alongside.
      expect(
        /\bappointment_status\s+IS\s+NOT\s+NULL\b/i.test(checkBody),
        `${migrationName} CHECK must NOT require NOT NULL (would break the pending semantic)`
      ).toBe(false);
    }
  );

  it('isAppointmentStatus accepts every canonical value and rejects everything else', () => {
    for (const v of APPOINTMENT_STATUS_VALUES) {
      expect(isAppointmentStatus(v)).toBe(true);
    }
    for (const v of [null, undefined, '', 'pending', 'CANCELLED_BY_DOCTOR', 42, {}]) {
      expect(isAppointmentStatus(v)).toBe(false);
    }
  });

  it('parseAppointmentStatus normalises null/undefined/"" to null and rejects unknowns', () => {
    expect(parseAppointmentStatus(null)).toEqual({ ok: true, status: null });
    expect(parseAppointmentStatus(undefined)).toEqual({ ok: true, status: null });
    expect(parseAppointmentStatus('')).toEqual({ ok: true, status: null });
    expect(parseAppointmentStatus('completed')).toEqual({ ok: true, status: 'completed' });
    expect(parseAppointmentStatus('unsuccessful')).toEqual({ ok: true, status: 'unsuccessful' });

    const bad = parseAppointmentStatus('foo');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/foo/);
  });

  it('compile-time exhaustiveness: every canonical value must be reachable through AppointmentStatus', () => {
    // If a new value gets added to the union, the switch will fail to compile
    // — Vitest will surface it as a TS error at run time.
    function classify(s: AppointmentStatus): 'active' | 'unsuccessful' | 'cancelled' {
      switch (s) {
        case 'completed':
        case 'no_show':
          return 'active';
        case 'unsuccessful':
          return 'unsuccessful';
        case 'cancelled_by_doctor':
        case 'cancelled_by_patient':
          return 'cancelled';
      }
    }
    expect(classify('completed')).toBe('active');
    expect(classify('unsuccessful')).toBe('unsuccessful');
    expect(classify('cancelled_by_doctor')).toBe('cancelled');
  });
});
