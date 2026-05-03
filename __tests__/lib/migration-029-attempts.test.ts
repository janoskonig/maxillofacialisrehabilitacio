/**
 * Source-level pinning test for migration 029
 * (`database/migrations/029_appointment_attempts.sql`).
 *
 * The migration:
 *   1. Adds the `attempt_*` columns (with sane defaults / nullables).
 *   2. Extends the canonical `appointment_status` CHECK constraint to include
 *      the new `'unsuccessful'` value (idempotent, drops legacy duplicates).
 *   3. Rebuilds `idx_appointments_unique_work_phase_active` so that
 *      `'unsuccessful'` releases the work-phase slot (alongside cancelled).
 *   4. Adds an index for fast attempt-history queries.
 *   5. Backfills `attempt_number = 1` for existing rows.
 *
 * If any of these structural assertions fail, the booking guards in
 * `lib/appointment-service.ts` / `lib/convert-slot-intent.ts` and the
 * canonical taxonomy in `lib/active-appointment.ts` will silently disagree
 * with the database — exactly the failure mode that the work-phase
 * stabilization plan was meant to close.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL = readFileSync(
  join(__dirname, '..', '..', 'database', 'migrations', '029_appointment_attempts.sql'),
  'utf8'
);

describe('migration 029 — appointment attempts', () => {
  it('adds the four attempt_* columns with the right types / defaults', () => {
    expect(SQL).toMatch(/attempt_number\s+INT\s+NOT\s+NULL\s+DEFAULT\s+1/i);
    expect(SQL).toMatch(/attempt_failed_reason\s+TEXT/i);
    expect(SQL).toMatch(/attempt_failed_at\s+TIMESTAMPTZ/i);
    expect(SQL).toMatch(/attempt_failed_by\s+VARCHAR\(\s*255\s*\)/i);
  });

  it('uses ADD COLUMN IF NOT EXISTS so the migration is idempotent', () => {
    expect(SQL).toMatch(/ALTER TABLE appointments[\s\S]*?ADD COLUMN IF NOT EXISTS attempt_number/i);
  });

  it('CHECK constraint contains all 5 canonical statuses + explicit IS NULL', () => {
    const checkBodyMatch = SQL.match(
      /ADD CONSTRAINT appointments_appointment_status_check[\s\S]*?CHECK \(([\s\S]*?)\);/
    );
    expect(checkBodyMatch, 'canonical CHECK block missing').toBeTruthy();
    const checkBody = checkBodyMatch![1];

    for (const value of [
      'cancelled_by_doctor',
      'cancelled_by_patient',
      'completed',
      'no_show',
      'unsuccessful',
    ]) {
      expect(
        checkBody.includes(`'${value}'`),
        `migration 029 CHECK is missing canonical value: ${value}`
      ).toBe(true);
    }

    expect(
      /\bappointment_status\s+IS\s+NULL\b/i.test(checkBody),
      "migration 029 CHECK must explicitly accept NULL"
    ).toBe(true);
  });

  it("drops legacy CHECK constraints idempotently before re-adding the new one", () => {
    // A loop over pg_constraint matches & drops any existing
    // appointment_status CHECK constraint regardless of name.
    expect(SQL).toMatch(/FROM pg_constraint c[\s\S]*?relname\s*=\s*'appointments'/i);
    expect(SQL).toMatch(/EXECUTE format\('ALTER TABLE appointments DROP CONSTRAINT %I'/);
  });

  it('rebuilds idx_appointments_unique_work_phase_active to release on unsuccessful', () => {
    expect(SQL).toMatch(/DROP INDEX IF EXISTS idx_appointments_unique_work_phase_active/);
    // The new partial index must EXCLUDE 'unsuccessful' (alongside the
    // cancelled set) — that is what frees the work_phase slot for a fresh
    // attempt_number row.
    const idxMatch = SQL.match(
      /CREATE UNIQUE INDEX idx_appointments_unique_work_phase_active[\s\S]*?WHERE([\s\S]*?)(?:\$sql\$|;)/
    );
    expect(idxMatch, 'new partial unique index definition missing').toBeTruthy();
    const where = idxMatch![1];
    expect(where).toContain("'cancelled_by_doctor'");
    expect(where).toContain("'cancelled_by_patient'");
    expect(where).toContain("'unsuccessful'");
    // It must NOT exclude 'no_show' or 'completed' — those remain "active"
    // for the work_phase uniqueness check.
    expect(where).not.toContain("'no_show'");
    expect(where).not.toContain("'completed'");
  });

  it('adds an index on (episode_id, step_code, attempt_number) for fast attempt-history lookup', () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS idx_appointments_attempts_per_step[\s\S]*?ON appointments\s*\(episode_id,\s*step_code,\s*attempt_number\)/);
  });

  it('backfills attempt_number = 1 for any pre-existing rows', () => {
    expect(SQL).toMatch(/UPDATE appointments\s+SET attempt_number\s*=\s*1\s+WHERE attempt_number IS NULL/i);
  });

  it('runs everything in a single BEGIN ... COMMIT transaction', () => {
    expect(SQL).toMatch(/^[\s\S]*?BEGIN;[\s\S]*?COMMIT;\s*$/m);
  });

  it('is package.json-discoverable by the migration runner naming convention', () => {
    // Filename naming convention: 029_*.sql so scripts/run-all-migrations.js
    // applies it after 028 in lexicographic order.
    expect(SQL).toMatch(/Migration 029/);
  });
});
