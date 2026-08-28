/**
 * WP-4.1b — a step_code pszeudo-identitás kivezetése (viselkedési tesztek).
 *
 * Duplikált work_phase_code-ú epizódon (két 'lenyomat' fázis, külön step_seq —
 * az ismétlés, "N alkalom ugyanabból a fázisból" alapesete) az identitás
 * elsődleges kulcsa a work_phase_id; a step_code csak a work_phase_id IS NULL
 * legacy sorok fallbackje.
 *
 *   (a) Az egyik fázis soronkénti ÉS kötegelt konverzióját NEM blokkolja a
 *       testvér-fázis completed státusza (STEP_ALREADY_DONE) vagy aktív
 *       foglalása (STEP_ALREADY_BOOKED).
 *   (b) A próba-számlálás (attempt_number) fázisonként független — az egyik
 *       fázis unsuccessful próbája nem növeli a másik attempt_number-ét.
 *   (c) A worklist prior-attempts a helyes fázis próbáit mutatja.
 *   (d) Legacy (work_phase_id NULL) sorokra a step_code-fallback változatlan.
 *   (e) mark_unsuccessful: a testvér-fázis aktív foglalása nem tartja
 *       'scheduled'-ben a sikertelen próba fázisát.
 *
 * Route-handlereket hívó teszteknél a factory-k pool-lal (db nélkül) futnak és
 * afterEach-ben takarítunk (docs/INTEGRATION_TESTS.md, 2. minta); a route-ok
 * által létrehozott appointment-sorokat episode_id szerint töröljük előbb.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { POST as convertAllIntentsPost } from '@/app/api/episodes/[id]/convert-all-intents/route';
import { POST as convertIntentPost } from '@/app/api/slot-intents/[id]/convert/route';
import { PATCH as attemptOutcomePatch } from '@/app/api/appointments/[id]/attempt-outcome/route';
import { nextAttemptNumber } from '@/lib/appointment-attempts';
import { enrichWorklistPriorAttempts } from '@/lib/worklist-prior-attempts';
import type { WorklistItemBackend } from '@/lib/worklist-types';
import {
  cleanupCreated,
  createTestAppointment,
  createTestEpisode,
  createTestPatient,
  createTestSlot,
  createTestSlotIntent,
  createTestUser,
  createTestWorkPhase,
} from './helpers/factories';
import { assignEpisodeProvider } from './helpers/factories-wp41b';
import { withRollback } from './helpers/db';
import { authedRequest, type TestAuthUser } from './helpers/auth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A route-ok által (nem factory-n át) létrehozott sorok takarításához. */
const createdEpisodeIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  if (createdEpisodeIds.length > 0) {
    await pool.query(`DELETE FROM appointments WHERE episode_id = ANY($1::uuid[])`, [
      createdEpisodeIds,
    ]);
    await pool.query(`DELETE FROM scheduling_events WHERE entity_id = ANY($1::uuid[])`, [
      createdEpisodeIds,
    ]);
    createdEpisodeIds.length = 0;
  }
  await cleanupCreated();
});

async function authUser(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

/**
 * Duplikált kódú epizód-váz: két 'lenyomat' fázis külön step_seq-kel.
 * Az assigned provider rögzítése a közös teszt-DB miatt kell (a slot-picker
 * csak a teszt saját providerének slotjai közül választhasson).
 */
async function duplicatedPhaseEpisode(user: TestAuthUser): Promise<{
  patientId: string;
  episodeId: string;
  ewpA: { id: string };
  ewpB: { id: string };
}> {
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  createdEpisodeIds.push(episode.id);
  await assignEpisodeProvider(undefined, episode.id, user.id);

  const ewpA = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    seq: 0,
    pool: 'work',
    status: 'pending',
  });
  const ewpB = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    seq: 1,
    pool: 'work',
    status: 'pending',
  });
  return { patientId: patient.id, episodeId: episode.id, ewpA, ewpB };
}

describe('WP-4.1b/a — a testvér-fázis nem blokkolja a konverziót', () => {
  it('soronkénti konverzió: a testvér completed státusza nem ad STEP_ALREADY_DONE-t', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const { episodeId, ewpA, ewpB } = await duplicatedPhaseEpisode(user);

    // A testvér (A) már completed — a B fázis foglalása ettől még mehet.
    await pool.query(
      `UPDATE episode_work_phases SET status = 'completed', completed_at = now() WHERE id = $1`,
      [ewpA.id]
    );

    const intent = await createTestSlotIntent(undefined, episodeId, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      pool: 'work',
      workPhaseId: ewpB.id,
    });
    const slot = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 3 * MS_PER_DAY),
    });

    const req = await authedRequest(`http://test.local/api/slot-intents/${intent.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slot.id },
    });
    const res = await convertIntentPost(req, { params: { id: intent.id } });
    expect(res.status).toBe(201);
    const body = await res.json();

    const ewpBAfter = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [ewpB.id]
    );
    expect(ewpBAfter.rows[0].status).toBe('scheduled');
    expect(ewpBAfter.rows[0].appointment_id).toBe(body.appointment.id);

    // A testvér érintetlen maradt.
    const ewpAAfter = await pool.query(
      `SELECT status FROM episode_work_phases WHERE id = $1`,
      [ewpA.id]
    );
    expect(ewpAAfter.rows[0].status).toBe('completed');
  });

  it('soronkénti konverzió: a testvér AKTÍV foglalása nem ad STEP_ALREADY_BOOKED-ot', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const { patientId, episodeId, ewpA, ewpB } = await duplicatedPhaseEpisode(user);

    // A testvér (A) fázisnak aktív (pending) jövőbeli foglalása van.
    const slotA = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 5 * MS_PER_DAY),
      state: 'booked',
      status: 'booked',
    });
    const apptA = await createTestAppointment(undefined, {
      patientId,
      timeSlotId: slotA.id,
      episodeId,
      workPhaseId: ewpA.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() + 5 * MS_PER_DAY),
    });
    await pool.query(
      `UPDATE episode_work_phases SET status = 'scheduled', appointment_id = $1 WHERE id = $2`,
      [apptA.id, ewpA.id]
    );

    const intent = await createTestSlotIntent(undefined, episodeId, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      pool: 'work',
      workPhaseId: ewpB.id,
    });
    const slotB = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 20 * MS_PER_DAY),
    });

    const req = await authedRequest(`http://test.local/api/slot-intents/${intent.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slotB.id },
    });
    const res = await convertIntentPost(req, { params: { id: intent.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.appointment.id).not.toBe(apptA.id);

    // Mindkét fázis a SAJÁT foglalására mutat.
    const rows = await pool.query(
      `SELECT id, status, appointment_id FROM episode_work_phases WHERE id = ANY($1::uuid[]) ORDER BY seq`,
      [[ewpA.id, ewpB.id]]
    );
    expect(rows.rows[0].appointment_id).toBe(apptA.id);
    expect(rows.rows[1].appointment_id).toBe(body.appointment.id);
    expect(rows.rows[1].status).toBe('scheduled');
  });

  it('kötegelt konverzió: mindkét azonos kódú fázis külön foglalást kap (skipped = 0)', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const { episodeId, ewpA, ewpB } = await duplicatedPhaseEpisode(user);

    await createTestSlotIntent(undefined, episodeId, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      pool: 'work',
      workPhaseId: ewpA.id,
    });
    await createTestSlotIntent(undefined, episodeId, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      pool: 'work',
      workPhaseId: ewpB.id,
    });

    // Nincs care pathway → a lánc-gap a hard default 14 nap; a slotok ehhez
    // igazodnak (+2, +17 nap).
    await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 2 * MS_PER_DAY),
    });
    await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 17 * MS_PER_DAY),
    });

    const req = await authedRequest(
      `http://test.local/api/episodes/${episodeId}/convert-all-intents`,
      { user, method: 'POST' }
    );
    const res = await convertAllIntentsPost(req, { params: { id: episodeId } });
    expect(res.status).toBe(200);
    const body = await res.json();
    // A korábbi (episode_id, step_code) szerinti STEP_ALREADY_BOOKED őr a
    // 2. azonos kódú fázis konverzióját 409-elte; a code-alapú offset-JOIN
    // pedig megsokszorozta az intent-sorokat (hamis skipped bejegyzések).
    expect(body.skipped).toHaveLength(0);
    expect(body.converted).toBe(2);

    const rows = await pool.query(
      `SELECT ewp.id, ewp.status, ewp.appointment_id, a.work_phase_id
         FROM episode_work_phases ewp
         LEFT JOIN appointments a ON a.id = ewp.appointment_id
        WHERE ewp.id = ANY($1::uuid[])
        ORDER BY ewp.seq`,
      [[ewpA.id, ewpB.id]]
    );
    expect(rows.rows[0].status).toBe('scheduled');
    expect(rows.rows[1].status).toBe('scheduled');
    expect(rows.rows[0].appointment_id).not.toBeNull();
    expect(rows.rows[1].appointment_id).not.toBeNull();
    expect(rows.rows[0].appointment_id).not.toBe(rows.rows[1].appointment_id);
    // A foglalás work_phase_id-je a saját fázisára mutat.
    expect(rows.rows[0].work_phase_id).toBe(ewpA.id);
    expect(rows.rows[1].work_phase_id).toBe(ewpB.id);
  });
});

describe('WP-4.1b/b — a próba-számlálás fázisonként független', () => {
  it('a testvér unsuccessful próbája nem növeli a másik fázis attempt_number-ét', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const { patientId, episodeId, ewpA, ewpB } = await duplicatedPhaseEpisode(user);

    // Az A fázison volt egy sikertelen (unsuccessful) próba.
    const slotA1 = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() - 2 * MS_PER_DAY),
      state: 'booked',
      status: 'booked',
    });
    await createTestAppointment(undefined, {
      patientId,
      timeSlotId: slotA1.id,
      episodeId,
      workPhaseId: ewpA.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() - 2 * MS_PER_DAY),
      appointmentStatus: 'unsuccessful',
      attemptNumber: 1,
    });

    // Az A fázis retry-a: attempt_number = 2.
    const intentA = await createTestSlotIntent(undefined, episodeId, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      pool: 'work',
      workPhaseId: ewpA.id,
    });
    const slotA2 = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 4 * MS_PER_DAY),
    });
    const reqA = await authedRequest(`http://test.local/api/slot-intents/${intentA.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slotA2.id },
    });
    const resA = await convertIntentPost(reqA, { params: { id: intentA.id } });
    expect(resA.status).toBe(201);
    const bodyA = await resA.json();

    // A B fázis ELSŐ foglalása: attempt_number = 1 — az A próbája nem számít bele.
    const intentB = await createTestSlotIntent(undefined, episodeId, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      pool: 'work',
      workPhaseId: ewpB.id,
    });
    const slotB = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 21 * MS_PER_DAY),
    });
    const reqB = await authedRequest(`http://test.local/api/slot-intents/${intentB.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slotB.id },
    });
    const resB = await convertIntentPost(reqB, { params: { id: intentB.id } });
    expect(resB.status).toBe(201);
    const bodyB = await resB.json();

    const attempts = await pool.query(
      `SELECT id, attempt_number FROM appointments WHERE id = ANY($1::uuid[])`,
      [[bodyA.appointment.id, bodyB.appointment.id]]
    );
    const byId = new Map(attempts.rows.map((r) => [r.id, Number(r.attempt_number)]));
    expect(byId.get(bodyA.appointment.id)).toBe(2);
    expect(byId.get(bodyB.appointment.id)).toBe(1);
  });

  it('nextAttemptNumber: work_phase_id-elsődleges számolás, legacy sorok fallbackként', async () => {
    const user = await authUser();
    await withRollback(async (client) => {
      const patient = await createTestPatient(client);
      const episode = await createTestEpisode(client, patient.id);
      const ewpA = await createTestWorkPhase(client, episode.id, {
        workPhaseCode: 'lenyomat',
        seq: 0,
      });
      const ewpB = await createTestWorkPhase(client, episode.id, {
        workPhaseCode: 'lenyomat',
        seq: 1,
      });

      const mkSlot = () =>
        createTestSlot(client, user.id, {
          startTime: new Date(Date.now() - 10 * MS_PER_DAY + Math.random() * MS_PER_DAY),
          state: 'booked',
          status: 'booked',
        });

      // A fázis: 2 valós próba (completed + unsuccessful).
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: (await mkSlot()).id,
        episodeId: episode.id,
        workPhaseId: ewpA.id,
        stepCode: 'lenyomat',
        appointmentStatus: 'completed',
        attemptNumber: 1,
      });
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: (await mkSlot()).id,
        episodeId: episode.id,
        workPhaseId: ewpA.id,
        stepCode: 'lenyomat',
        appointmentStatus: 'unsuccessful',
        attemptNumber: 2,
      });
      // B fázis: 1 valós próba (no_show).
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: (await mkSlot()).id,
        episodeId: episode.id,
        workPhaseId: ewpB.id,
        stepCode: 'lenyomat',
        appointmentStatus: 'no_show',
        attemptNumber: 1,
      });
      // Legacy sor: work_phase_id NULL — mindkét fázis fallbackje.
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: (await mkSlot()).id,
        episodeId: episode.id,
        workPhaseId: null,
        stepCode: 'lenyomat',
        appointmentStatus: 'completed',
        attemptNumber: 1,
      });
      // Lemondott sor NEM valós próba — nem számít sehova.
      await createTestAppointment(client, {
        patientId: patient.id,
        timeSlotId: (await mkSlot()).id,
        episodeId: episode.id,
        workPhaseId: ewpA.id,
        stepCode: 'lenyomat',
        appointmentStatus: 'cancelled_by_doctor',
      });

      // A: 2 saját + 1 legacy = 3 → következő: 4.
      expect(await nextAttemptNumber(client, episode.id, 'lenyomat', ewpA.id)).toBe(4);
      // B: 1 saját + 1 legacy = 2 → következő: 3. Az A próbái NEM számítanak.
      expect(await nextAttemptNumber(client, episode.id, 'lenyomat', ewpB.id)).toBe(3);
      // (d) Legacy hívás (workPhaseId nélkül): a régi (episode, step_code)
      // viselkedés — minden valós próba számít: 4 → következő: 5.
      expect(await nextAttemptNumber(client, episode.id, 'lenyomat')).toBe(5);
    });
  });
});

describe('WP-4.1b/c — worklist prior-attempts a helyes fázis próbáit mutatja', () => {
  it('workPhaseId-s item csak a saját fázis + legacy próbáit kapja', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const { patientId, episodeId, ewpA, ewpB } = await duplicatedPhaseEpisode(user);

    const mkSlot = (daysAgo: number) =>
      createTestSlot(undefined, user.id, {
        startTime: new Date(Date.now() - daysAgo * MS_PER_DAY),
        state: 'booked',
        status: 'booked',
      });

    const apptA1 = await createTestAppointment(undefined, {
      patientId,
      timeSlotId: (await mkSlot(9)).id,
      episodeId,
      workPhaseId: ewpA.id,
      stepCode: 'lenyomat',
      startTime: new Date(Date.now() - 9 * MS_PER_DAY),
      appointmentStatus: 'unsuccessful',
      attemptNumber: 1,
    });
    const apptA2 = await createTestAppointment(undefined, {
      patientId,
      timeSlotId: (await mkSlot(6)).id,
      episodeId,
      workPhaseId: ewpA.id,
      stepCode: 'lenyomat',
      startTime: new Date(Date.now() - 6 * MS_PER_DAY),
      appointmentStatus: 'no_show',
      attemptNumber: 2,
    });
    const apptB1 = await createTestAppointment(undefined, {
      patientId,
      timeSlotId: (await mkSlot(4)).id,
      episodeId,
      workPhaseId: ewpB.id,
      stepCode: 'lenyomat',
      startTime: new Date(Date.now() - 4 * MS_PER_DAY),
      appointmentStatus: 'unsuccessful',
      attemptNumber: 1,
    });
    const legacyAppt = await createTestAppointment(undefined, {
      patientId,
      timeSlotId: (await mkSlot(12)).id,
      episodeId,
      workPhaseId: null,
      stepCode: 'lenyomat',
      startTime: new Date(Date.now() - 12 * MS_PER_DAY),
      appointmentStatus: 'unsuccessful',
      attemptNumber: 1,
    });

    const baseItem = (workPhaseId?: string): WorklistItemBackend => ({
      episodeId,
      patientId,
      currentStage: 'STAGE_5',
      nextStep: 'lenyomat',
      stepCode: 'lenyomat',
      overdueByDays: 0,
      windowStart: null,
      windowEnd: null,
      durationMinutes: 30,
      pool: 'work',
      priorityScore: 50,
      noShowRisk: 0,
      ...(workPhaseId ? { workPhaseId } : {}),
    });

    const itemA = baseItem(ewpA.id);
    const itemB = baseItem(ewpB.id);
    const itemLegacy = baseItem();
    await enrichWorklistPriorAttempts(pool, [itemA, itemB, itemLegacy]);

    // A: a saját 2 próbája + a legacy fallback sor.
    const idsA = (itemA.priorAttempts ?? []).map((p) => p.appointmentId).sort();
    expect(idsA).toEqual([apptA1.id, apptA2.id, legacyAppt.id].sort());

    // B: a saját 1 próbája + a legacy fallback — az A próbái NEM szivárognak át.
    const idsB = (itemB.priorAttempts ?? []).map((p) => p.appointmentId).sort();
    expect(idsB).toEqual([apptB1.id, legacyAppt.id].sort());

    // (d) workPhaseId nélküli item: a korábbi (episode, step_code) viselkedés —
    // minden próba látszik.
    const idsLegacy = (itemLegacy.priorAttempts ?? []).map((p) => p.appointmentId).sort();
    expect(idsLegacy).toEqual([apptA1.id, apptA2.id, apptB1.id, legacyAppt.id].sort());
  });
});

describe('WP-4.1b/d — legacy (work_phase_id nélküli) intent step_code-fallbackje változatlan', () => {
  it('legacy intent: completed fázis a kóddal továbbra is STEP_ALREADY_DONE', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);
    await assignEpisodeProvider(undefined, episode.id, user.id);

    // Egyetlen (nem duplikált) fázis, már completed.
    await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      pool: 'work',
      status: 'completed',
      completedAt: new Date(),
    });
    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      pool: 'work',
      workPhaseId: null,
    });
    const slot = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 3 * MS_PER_DAY),
    });

    const req = await authedRequest(`http://test.local/api/slot-intents/${intent.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slot.id },
    });
    const res = await convertIntentPost(req, { params: { id: intent.id } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('STEP_ALREADY_DONE');

    const intentAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intent.id,
    ]);
    expect(intentAfter.rows[0].state).toBe('expired');
  });

  it('legacy intent: aktív foglalás a kóddal továbbra is STEP_ALREADY_BOOKED', async () => {
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);
    await assignEpisodeProvider(undefined, episode.id, user.id);

    await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      pool: 'work',
      status: 'scheduled',
    });
    // Legacy aktív foglalás (work_phase_id NULL) ugyanarra a kódra.
    const slotBooked = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 5 * MS_PER_DAY),
      state: 'booked',
      status: 'booked',
    });
    await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slotBooked.id,
      episodeId: episode.id,
      workPhaseId: null,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() + 5 * MS_PER_DAY),
    });

    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      pool: 'work',
      workPhaseId: null,
    });
    const slot = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 10 * MS_PER_DAY),
    });

    const req = await authedRequest(`http://test.local/api/slot-intents/${intent.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slot.id },
    });
    const res = await convertIntentPost(req, { params: { id: intent.id } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('STEP_ALREADY_BOOKED');
  });
});

describe('WP-4.1b/e — mark_unsuccessful: a testvér foglalása nem tartja scheduled-ben a fázist', () => {
  it('az unsuccessful fázis pendingre nyílik, a testvér-fázis érintetlen', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const { patientId, episodeId, ewpA, ewpB } = await duplicatedPhaseEpisode(user);

    const mkBookedSlot = (days: number) =>
      createTestSlot(undefined, user.id, {
        startTime: new Date(Date.now() + days * MS_PER_DAY),
        state: 'booked',
        status: 'booked',
      });

    const apptA = await createTestAppointment(undefined, {
      patientId,
      timeSlotId: (await mkBookedSlot(2)).id,
      episodeId,
      workPhaseId: ewpA.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() + 2 * MS_PER_DAY),
      attemptNumber: 1,
    });
    const apptB = await createTestAppointment(undefined, {
      patientId,
      timeSlotId: (await mkBookedSlot(16)).id,
      episodeId,
      workPhaseId: ewpB.id,
      stepCode: 'lenyomat',
      stepSeq: 1,
      startTime: new Date(Date.now() + 16 * MS_PER_DAY),
      attemptNumber: 1,
    });
    await pool.query(
      `UPDATE episode_work_phases SET status = 'scheduled', appointment_id = $1 WHERE id = $2`,
      [apptA.id, ewpA.id]
    );
    await pool.query(
      `UPDATE episode_work_phases SET status = 'scheduled', appointment_id = $1 WHERE id = $2`,
      [apptB.id, ewpB.id]
    );

    const req = await authedRequest(
      `http://test.local/api/appointments/${apptA.id}/attempt-outcome`,
      {
        user,
        method: 'PATCH',
        body: { action: 'mark_unsuccessful', reason: 'lenyomat torzult, ismételni kell' },
      }
    );
    const res = await attemptOutcomePatch(req, { params: { id: apptA.id } });
    expect(res.status).toBe(200);

    // A fázis visszanyílt pendingre — a testvér (B) aktív foglalása korábban
    // (csupasz step_code egyezéssel) 'scheduled'-ben ragasztotta volna.
    const ewpAAfter = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [ewpA.id]
    );
    expect(ewpAAfter.rows[0].status).toBe('pending');
    expect(ewpAAfter.rows[0].appointment_id).toBeNull();

    // A testvér-fázis érintetlen.
    const ewpBAfter = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [ewpB.id]
    );
    expect(ewpBAfter.rows[0].status).toBe('scheduled');
    expect(ewpBAfter.rows[0].appointment_id).toBe(apptB.id);
  });
});
