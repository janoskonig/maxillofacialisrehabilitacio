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
    // A tényleges UPDATE+audit a `revertWorkPhaseLinkToPending` helper-ben
    // van — itt ellenőrizzük, hogy a route hívja a helpert.
    expect(SRC).toMatch(/revertWorkPhaseLinkToPending/);
    expect(SRC).toMatch(/fázis visszanyitva/);
  });

  it('EWP completed vagy scheduled + appointment_id egyezés', () => {
    expect(SRC).toMatch(
      /\(ewp\.status === 'completed' \|\| ewp\.status === 'scheduled'\)/
    );
    expect(SRC).toMatch(/ewp\.appointmentId === appointmentId/);
  });

  it('episode / step / work_phase_id lekérdezés a tranzakció elején FOR UPDATE', () => {
    expect(SRC).toMatch(/episode_id\s+AS "episodeId"/);
    expect(SRC).toMatch(/work_phase_id\s+AS "workPhaseId"/);
    expect(SRC).toMatch(/FOR UPDATE/);
  });

  it('dedikált pool client tranzakcióhoz (nem pool.query BEGIN)', () => {
    // A pool.query('BEGIN') minta nem garantálja, hogy a következő query
    // ugyanazon connection-ön fut, így a FOR UPDATE lock értelmét veszti.
    // A status route most pool.connect()-tel dedikált client-et nyit.
    expect(SRC).toMatch(/await pool\.connect\(\)/);
    expect(SRC).toMatch(/client\.query\('BEGIN'\)/);
    expect(SRC).toMatch(/client\.release\(\)/);
    expect(SRC).not.toMatch(/await pool\.query\('BEGIN'\)/);
  });

  it('robusztus EWP-keresés helper-en keresztül (nem rows.length === 1 inline)', () => {
    expect(SRC).toMatch(/findEwpForAppointmentRevert/);
  });
});
