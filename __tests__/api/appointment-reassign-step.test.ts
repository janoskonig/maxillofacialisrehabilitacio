/**
 * Source-level guard tests for `PATCH /api/appointments/[id]/reassign-step`.
 *
 * A funkció célja egy jövőbeli foglalás fázis-hovatartozásának
 * (`step_code / step_seq / work_phase_id` + `episode_work_phases.appointment_id`)
 * biztonságos átkötése ugyanazon epizód egy másik pending munkafázisára.
 *
 * Ezek a tesztek NEM futtatnak DB-t — a route forráskódjára adnak
 * regressziós védelmet, hogy a fontos invariánsok véletlenül ki ne essenek:
 *
 *  - role-based auth (admin / beutalo_orvos / fogpótlástanász),
 *  - stale-link felismerés (cancelled / unsuccessful / törölt appointmentre
 *    mutató `ewp.appointment_id`) és takarítása a tranzakcióban,
 *  - ugyanaz az epizód, ugyanaz a pool invariánsok,
 *  - audit bejegyzések a régi és új EWP sorok státuszváltásáról,
 *  - `projectRemainingSteps` + scheduling_events emit.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'app',
    'api',
    'appointments',
    '[id]',
    'reassign-step',
    'route.ts'
  ),
  'utf8'
);

describe('PATCH /api/appointments/[id]/reassign-step — source-level invariants', () => {
  it('role-guarded: admin / beutalo_orvos / fogpótlástanász', () => {
    expect(SRC).toMatch(
      /roleHandler\(\s*\[\s*'admin'\s*,\s*'beutalo_orvos'\s*,\s*'fogpótlástanász'\s*\]/
    );
  });

  it('csak jövőbeli és aktív foglalást enged át-rendelni', () => {
    expect(SRC).toMatch(/!appt\.isFuture/);
    expect(SRC).toMatch(/!appt\.isActiveStatus/);
  });

  it('ugyanannak az epizódnak a cél fázisára (kereszt-epizód tilos)', () => {
    expect(SRC).toMatch(/target\.episodeId\s*!==\s*appt\.episodeId/);
  });

  it('azonos pool-t követel (control/work/consult nem keveredhet)', () => {
    expect(SRC).toMatch(/target\.pool\s*!==\s*appt\.pool/);
  });

  it('merged / completed / skipped cél fázist nem fogad el', () => {
    expect(SRC).toMatch(/target\.mergedIntoWorkPhaseId/);
    expect(SRC).toMatch(
      /target\.status\s*===\s*'completed'\s*\|\|\s*target\.status\s*===\s*'skipped'/
    );
  });

  it('stale-link detektálás isAppointmentActive-en keresztül', () => {
    // A join-t ellenőrizzük, hogy a linked appointment státusz elérhető
    expect(SRC).toMatch(
      /LEFT JOIN appointments ta ON ta\.id\s*=\s*ewp\.appointment_id/
    );
    expect(SRC).toMatch(/isAppointmentActive\(target\.linkedAppointmentStatus\)/);
    expect(SRC).toMatch(/targetHasStaleLink/);
  });

  it('csak AKTÍV másik foglalást utasít el (stale-t takarítja)', () => {
    // A blokkoló ág feltétele NEGÁLJA a staleLink flaget
    expect(SRC).toMatch(/\s!targetHasStaleLink\s*\)/);
  });

  it('stale-clear szakasz lenullázza az appointment_id-t és auditálja', () => {
    // A tranzakció sztale-takarító blokkja
    expect(SRC).toMatch(/stale appointment_id takarítása/);
    expect(SRC).toMatch(/SET appointment_id = NULL/);
    // Audit bejegyzés
    expect(SRC).toMatch(/INSERT INTO episode_work_phase_audit/);
  });

  it('a régi linkelt EWP sorokról is lekapcsolja az appointment_id-t', () => {
    expect(SRC).toMatch(
      /SELECT id, work_phase_code AS "workPhaseCode", status\s+FROM episode_work_phases\s+WHERE episode_id = \$1 AND appointment_id = \$2 AND id <> \$3/
    );
  });

  it('cél EWP scheduled-re áll, státuszváltás auditálva', () => {
    expect(SRC).toMatch(
      /UPDATE episode_work_phases\s+SET appointment_id = \$1, status = 'scheduled'/
    );
    expect(SRC).toMatch(/targetCurrentStatus\s*!==\s*'scheduled'/);
  });

  it('appointments step_code / step_seq / work_phase_id szinkronban frissül', () => {
    expect(SRC).toMatch(
      /UPDATE appointments\s+SET step_code = \$1, step_seq = \$2, work_phase_id = \$3/
    );
  });

  it('projektor + scheduling event event a commit után (non-blocking)', () => {
    expect(SRC).toMatch(/projectRemainingSteps\(appt\.episodeId\)/);
    expect(SRC).toMatch(/emitSchedulingEvent\(\s*'appointment'/);
    expect(SRC).toMatch(/'REPROJECT_INTENTS'/);
  });

  it('activity log az átrendezésről', () => {
    expect(SRC).toMatch(/appointment_reassigned_step/);
  });

  it('válasz jelzi, ha stale-link takarítás történt', () => {
    expect(SRC).toMatch(/cleanedStaleLink/);
    expect(SRC).toMatch(/staleLinkedAppointmentId/);
    expect(SRC).toMatch(/staleLinkedAppointmentStatus/);
  });
});
