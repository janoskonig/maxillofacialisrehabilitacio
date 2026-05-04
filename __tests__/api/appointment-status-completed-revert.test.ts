/**
 * Source-level guard tests for `PATCH /api/appointments/[id]/status`.
 *
 * `completed` → `cancelled_by_*` / `no_show`: ha az EWP ehhez az appointmenthez
 * kötődött (completed vagy scheduled), a fázis vissza `pending`-re.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'app', 'api', 'appointments', '[id]', 'status', 'route.ts'),
  'utf8'
);

describe('PATCH /api/appointments/[id]/status — completed → cancel / no_show EWP revert', () => {
  it('importálja az aktív-appointment SQL fragmentet', () => {
    expect(SRC).toMatch(/SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT/);
  });

  it('completed régi státusz + cancel/no_show esetén EWP pending + appointment_id NULL', () => {
    expect(SRC).toMatch(/oldStatus === 'completed'/);
    expect(SRC).toMatch(
      /UPDATE episode_work_phases\s+SET status = 'pending', appointment_id = NULL/
    );
    expect(SRC).toMatch(/fázis visszanyitva/);
  });

  it('EWP completed vagy scheduled + appointment_id egyezés', () => {
    expect(SRC).toMatch(
      /\(ewpStatus === 'completed' \|\| ewpStatus === 'scheduled'\)/
    );
    expect(SRC).toMatch(/ewpApptId === appointmentId/);
  });

  it('episode / step / work_phase_id lekérdezés a tranzakció elején FOR UPDATE', () => {
    expect(SRC).toMatch(/episode_id\s+AS "episodeId"/);
    expect(SRC).toMatch(/work_phase_id\s+AS "workPhaseId"/);
    expect(SRC).toMatch(/FOR UPDATE/);
  });
});
