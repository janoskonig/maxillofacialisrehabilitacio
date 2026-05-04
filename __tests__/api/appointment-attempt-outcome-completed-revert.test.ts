/**
 * Source-level guard tests for `PATCH /api/appointments/[id]/attempt-outcome`.
 *
 * Completed `episode_work_phases` + `mark_unsuccessful`: a fázisnak
 * vissza kell nyílnia `pending`-re, ha az `appointment_id` link erre a
 * foglalásra mutat és nincs másik aktív appointment a lépésre.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'appointments', '[id]', 'attempt-outcome', 'route.ts'),
  'utf8'
);

describe('PATCH /api/appointments/[id]/attempt-outcome — completed EWP revert', () => {
  it('mark_unsuccessful: completed fázis + appointment_id egyezés → pending + NULL link', () => {
    expect(SRC).toMatch(/shouldRevertCompletedPhase/);
    expect(SRC).toMatch(
      /UPDATE episode_work_phases\s+SET status = 'pending', appointment_id = NULL/
    );
    expect(SRC).toMatch(/completed fázis visszanyitva/);
  });

  it('EWP appointment_id lekérdezése a mark_unsuccessful ág előtt', () => {
    expect(SRC).toMatch(/appointment_id AS "appointmentId"/);
    expect(SRC).toMatch(/ewpAppointmentId === appointmentId/);
  });

  it('completed revert csak ha nincs másik aktív appointment a step-re', () => {
    expect(SRC).toMatch(/!hasOtherActive/);
    expect(SRC).toMatch(/SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT/);
  });
});
