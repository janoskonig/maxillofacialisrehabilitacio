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
    // A tényleges UPDATE+audit a `revertWorkPhaseLinkToPending` helper-ben
    // van — itt ellenőrizzük, hogy a route hívja a helpert a completed-ágban.
    expect(SRC).toMatch(/revertWorkPhaseLinkToPending/);
    expect(SRC).toMatch(/completed fázis visszanyitva/);
  });

  it('EWP appointment_id lekérdezése a mark_unsuccessful ág előtt', () => {
    // Az EWP-keresés most a findEwpForAppointmentRevert helper-en megy
    // keresztül, ami appointment_id egyezést prefelálja a code-only
    // fallback-tel szemben.
    expect(SRC).toMatch(/findEwpForAppointmentRevert/);
    expect(SRC).toMatch(/ewpAppointmentId === appointmentId/);
  });

  it('completed revert csak ha nincs másik aktív appointment a step-re', () => {
    expect(SRC).toMatch(/!hasOtherActive/);
    expect(SRC).toMatch(/SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT/);
  });

  it('revert helyreállítja az ewp.appointment_id linket, ha nincs másik aktív', () => {
    // Az eredeti completed → mark_unsuccessful → revert lánc után az EWP
    // pending+NULL-on maradt, dangling-fordított állapotban (van active
    // foglalás, de senki nem mutat rá az EWP-ről). A revert most
    // visszakapcsolja a linket és scheduled-re viszi az EWP-t.
    expect(SRC).toMatch(/shouldReattachOnRevert/);
    expect(SRC).toMatch(
      /UPDATE episode_work_phases\s+SET status = \$1, appointment_id = \$2/
    );
    expect(SRC).toMatch(/sikertelen-jelölés visszavonva \(link helyreállítva\)/);
  });

  it('mark_unsuccessful (non-completed scheduled→pending) is nullázza a linket, ha rajta volt', () => {
    // Stale-link megelőzés: ha a foglalás unsuccessful-re megy és a
    // scheduled EWP éppen erre mutatott, az appointment_id-t is null-ozni
    // kell, különben EWP_DANGLING_APPOINTMENT_LINK violation marad.
    expect(SRC).toMatch(/shouldClearLink/);
  });

  it('dedikált pool client tranzakcióhoz', () => {
    expect(SRC).toMatch(/await pool\.connect\(\)/);
    expect(SRC).toMatch(/client\.query\('BEGIN'\)/);
    expect(SRC).toMatch(/client\.release\(\)/);
    expect(SRC).not.toMatch(/await pool\.query\('BEGIN'\)/);
  });
});
