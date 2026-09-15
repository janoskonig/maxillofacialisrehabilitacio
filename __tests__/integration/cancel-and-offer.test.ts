/**
 * Lemondás + új e-mailes ajánlat — viselkedési integrációs tesztek (valódi DB).
 *
 * (a) POST /api/appointments/[id]/cancel-and-offer: a régi foglalás
 *     cancelled_by_doctor, a slotja szabad, a konvertált intent lejár; az új,
 *     pending ajánlat örökli az epizód/fázis kontextust és ÁTVESZI a
 *     munkafázis-kötést (EWP scheduled → az ajánlatra mutat), az új slot foglalt.
 * (b) GET /api/appointments/reject?token: a végleges elutasítás után a fázis
 *     visszanyílik (pending, link nélkül), a sor cancelled_by_patient, a
 *     slotok szabadok (state is) — az aktív-foglalás őrök nem blokkolnak.
 * (c) GET /api/appointments/approve?token: az elfogadott ajánlat approved,
 *     a fázis marad scheduled az ajánlatra kötve.
 * (d) DELETE /api/appointments/[id] (sima lemondás): a fázis-kötés innentől
 *     visszanyílik (korábban EWP_DANGLING_APPOINTMENT_LINK maradt).
 * (e) Egy lemondott / visszavont ajánlat tokenje nem fogad el.
 *
 * Route-handlereket hívunk, ezért a factory-k pool-lal futnak és afterEach-ben
 * takarítunk (docs/INTEGRATION_TESTS.md, 2. minta).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getDbPool } from '@/lib/db';
import { POST as cancelAndOffer } from '@/app/api/appointments/[id]/cancel-and-offer/route';
import { DELETE as deleteAppointment } from '@/app/api/appointments/[id]/route';
import { GET as rejectOffer } from '@/app/api/appointments/reject/route';
import { GET as approveOffer } from '@/app/api/appointments/approve/route';
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
import { authedRequest, type TestAuthUser } from './helpers/auth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const createdEpisodeIds: string[] = [];
const createdPatientIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  if (createdPatientIds.length > 0) {
    // A route által beszúrt ajánlat-sorok (és a státusz-eseményeik) a
    // factory-track-en kívül születtek — a beteg mentén takarítunk.
    await pool.query(
      `DELETE FROM appointment_status_events WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_id = ANY($1::uuid[]))`,
      [createdPatientIds]
    );
    await pool.query(`DELETE FROM appointments WHERE patient_id = ANY($1::uuid[])`, [createdPatientIds]);
    createdPatientIds.length = 0;
  }
  if (createdEpisodeIds.length > 0) {
    await pool.query(`DELETE FROM scheduling_events WHERE entity_id = ANY($1::uuid[])`, [createdEpisodeIds]);
    await pool.query(`DELETE FROM episode_work_phase_audit WHERE episode_id = ANY($1::uuid[])`, [createdEpisodeIds]);
    createdEpisodeIds.length = 0;
  }
  await cleanupCreated();
});

async function adminUser(): Promise<TestAuthUser> {
  const u = await createTestUser(undefined, { role: 'admin' });
  return { id: u.id, email: u.email, role: 'admin' };
}

/** Lefoglalt, munkafázishoz kötött foglalás pillanatképe (intenten át). */
async function bookedWorkPhaseAppointment(user: TestAuthUser) {
  const pool = getDbPool();
  const patient = await createTestPatient();
  createdPatientIds.push(patient.id);
  const episode = await createTestEpisode(undefined, patient.id);
  createdEpisodeIds.push(episode.id);
  const ewp = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    seq: 0,
    status: 'scheduled',
  });
  const slotA = await createTestSlot(undefined, user.id, {
    startTime: new Date(Date.now() + 7 * MS_PER_DAY),
    state: 'booked',
    status: 'booked',
  });
  const intent = await createTestSlotIntent(undefined, episode.id, {
    stepCode: 'lenyomat',
    stepSeq: 0,
    state: 'converted',
    workPhaseId: ewp.id,
  });
  const appointment = await createTestAppointment(undefined, {
    patientId: patient.id,
    timeSlotId: slotA.id,
    episodeId: episode.id,
    workPhaseId: ewp.id,
    slotIntentId: intent.id,
    stepCode: 'lenyomat',
    stepSeq: 0,
    startTime: new Date(Date.now() + 7 * MS_PER_DAY),
  });
  await pool.query(`UPDATE episode_work_phases SET appointment_id = $1 WHERE id = $2`, [
    appointment.id,
    ewp.id,
  ]);
  const slotB = await createTestSlot(undefined, user.id, {
    startTime: new Date(Date.now() + 10 * MS_PER_DAY),
  });
  const slotC = await createTestSlot(undefined, user.id, {
    startTime: new Date(Date.now() + 12 * MS_PER_DAY),
  });
  return { patient, episode, ewp, slotA, slotB, slotC, intent, appointment };
}

async function runCancelAndOffer(
  user: TestAuthUser,
  appointmentId: string,
  body: Record<string, unknown>
) {
  const req = await authedRequest(
    `http://test.local/api/appointments/${appointmentId}/cancel-and-offer`,
    { user, method: 'POST', body }
  );
  return cancelAndOffer(req, { params: { id: appointmentId } });
}

describe('cancel-and-offer — lemondás + jóváhagyásra váró ajánlat', () => {
  it('(a) a régi sor lemondva, az ajánlat örökli a kontextust és átveszi a fázis-kötést', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const { episode, ewp, slotA, slotB, slotC, intent, appointment } = await bookedWorkPhaseAppointment(user);

    const res = await runCancelAndOffer(user, appointment.id, {
      timeSlotId: slotB.id,
      alternativeTimeSlotIds: [slotC.id],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.cancelledAppointmentId).toBe(appointment.id);
    const offerId: string = body.offer.id;

    // Régi sor: kanonikus lemondás
    const old = await pool.query(
      `SELECT appointment_status, slot_intent_id, approval_token FROM appointments WHERE id = $1`,
      [appointment.id]
    );
    expect(old.rows[0].appointment_status).toBe('cancelled_by_doctor');
    expect(old.rows[0].slot_intent_id).toBeNull();
    const slotAfter = await pool.query(`SELECT state, status FROM available_time_slots WHERE id = $1`, [slotA.id]);
    expect(slotAfter.rows[0]).toEqual({ state: 'free', status: 'available' });
    const intentAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(intentAfter.rows[0].state).toBe('expired');
    const events = await pool.query(
      `SELECT new_status FROM appointment_status_events WHERE appointment_id = $1`,
      [appointment.id]
    );
    expect(events.rows.map((r) => r.new_status)).toContain('cancelled_by_doctor');

    // Új ajánlat: pending, örökölt kontextus, foglalt slot
    const offer = await pool.query(
      `SELECT approval_status, approval_token, appointment_status, episode_id, work_phase_id, step_code, step_seq,
              pool, attempt_number, time_slot_id, alternative_time_slot_ids
         FROM appointments WHERE id = $1`,
      [offerId]
    );
    expect(offer.rows[0].approval_status).toBe('pending');
    expect(offer.rows[0].approval_token).toHaveLength(64);
    expect(offer.rows[0].appointment_status).toBeNull();
    expect(offer.rows[0].episode_id).toBe(episode.id);
    expect(offer.rows[0].work_phase_id).toBe(ewp.id);
    expect(offer.rows[0].step_code).toBe('lenyomat');
    expect(offer.rows[0].step_seq).toBe(0);
    expect(offer.rows[0].attempt_number).toBe(1);
    expect(offer.rows[0].time_slot_id).toBe(slotB.id);
    expect(offer.rows[0].alternative_time_slot_ids).toEqual([slotC.id]);
    const slotB2 = await pool.query(`SELECT state, status FROM available_time_slots WHERE id = $1`, [slotB.id]);
    expect(slotB2.rows[0]).toEqual({ state: 'booked', status: 'booked' });

    // Fázis: az ajánlatra mutat, scheduled; audit-nyom mindkét lépésről
    const ewpAfter = await pool.query(`SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`, [ewp.id]);
    expect(ewpAfter.rows[0]).toEqual({ status: 'scheduled', appointment_id: offerId });
    // Egy tranzakcióban azonos a created_at, ezért halmazként nézzük.
    const audit = await pool.query(
      `SELECT old_status, new_status FROM episode_work_phase_audit WHERE episode_work_phase_id = $1`,
      [ewp.id]
    );
    expect(audit.rows.map((r) => `${r.old_status}->${r.new_status}`).sort()).toEqual(
      ['pending->scheduled', 'scheduled->pending'].sort()
    );

    // REPROJECT_INTENTS az epizódra
    const ev = await pool.query(
      `SELECT 1 FROM scheduling_events WHERE entity_id = $1 AND event_type = 'REPROJECT_INTENTS'`,
      [episode.id]
    );
    expect(ev.rows.length).toBeGreaterThan(0);
  });

  it('(b) végleges elutasítás: a fázis visszanyílik, a sor cancelled_by_patient, a slotok szabadok', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const { ewp, slotB, appointment } = await bookedWorkPhaseAppointment(user);

    const res = await runCancelAndOffer(user, appointment.id, { timeSlotId: slotB.id });
    expect(res.status).toBe(201);
    const offerId: string = (await res.json()).offer.id;
    const tokenRow = await pool.query(`SELECT approval_token FROM appointments WHERE id = $1`, [offerId]);
    const token: string = tokenRow.rows[0].approval_token;

    const rejectRes = await rejectOffer(
      new NextRequest(`http://test.local/api/appointments/reject?token=${token}`),
      { params: {} }
    );
    expect(rejectRes.status).toBe(200);
    expect(await rejectRes.text()).toContain('Időpont elvetve');

    const offer = await pool.query(
      `SELECT approval_status, appointment_status FROM appointments WHERE id = $1`,
      [offerId]
    );
    expect(offer.rows[0]).toEqual({ approval_status: 'rejected', appointment_status: 'cancelled_by_patient' });
    const ewpAfter = await pool.query(`SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`, [ewp.id]);
    expect(ewpAfter.rows[0]).toEqual({ status: 'pending', appointment_id: null });
    const slotB2 = await pool.query(`SELECT state, status FROM available_time_slots WHERE id = $1`, [slotB.id]);
    expect(slotB2.rows[0]).toEqual({ state: 'free', status: 'available' });

    // Az elutasított sor nem „aktív": ugyanarra a fázisra új sor beszúrható
    // (idx_appointments_unique_work_phase_active nem blokkol).
    const slotD = await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 14 * MS_PER_DAY) });
    const { episode } = { episode: { id: (await pool.query(`SELECT episode_id FROM appointments WHERE id = $1`, [offerId])).rows[0].episode_id } };
    await expect(
      createTestAppointment(undefined, {
        patientId: (await pool.query(`SELECT patient_id FROM appointments WHERE id = $1`, [offerId])).rows[0].patient_id,
        timeSlotId: slotD.id,
        episodeId: episode.id,
        workPhaseId: ewp.id,
        stepCode: 'lenyomat',
        stepSeq: 0,
      })
    ).resolves.toBeTruthy();
  });

  it('(b2) alternatívával: első elvetés → a következő slot, a fázis-kötés megmarad', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const { ewp, slotB, slotC, appointment } = await bookedWorkPhaseAppointment(user);

    const res = await runCancelAndOffer(user, appointment.id, {
      timeSlotId: slotB.id,
      alternativeTimeSlotIds: [slotC.id],
    });
    const offerId: string = (await res.json()).offer.id;
    const token: string = (await pool.query(`SELECT approval_token FROM appointments WHERE id = $1`, [offerId])).rows[0].approval_token;

    const first = await rejectOffer(new NextRequest(`http://test.local/api/appointments/reject?token=${token}`), { params: {} });
    expect(await first.text()).toContain('Alternatív időpont');

    const offer = await pool.query(
      `SELECT approval_status, appointment_status, time_slot_id, current_alternative_index FROM appointments WHERE id = $1`,
      [offerId]
    );
    expect(offer.rows[0]).toMatchObject({ approval_status: 'pending', appointment_status: null, time_slot_id: slotC.id, current_alternative_index: 0 });
    const slots = await pool.query(
      `SELECT id, state, status FROM available_time_slots WHERE id = ANY($1::uuid[]) ORDER BY start_time`,
      [[slotB.id, slotC.id]]
    );
    expect(slots.rows.find((r) => r.id === slotB.id)).toMatchObject({ state: 'free', status: 'available' });
    expect(slots.rows.find((r) => r.id === slotC.id)).toMatchObject({ state: 'booked', status: 'booked' });
    const ewpAfter = await pool.query(`SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`, [ewp.id]);
    expect(ewpAfter.rows[0]).toEqual({ status: 'scheduled', appointment_id: offerId });

    // Az alternatíva elfogadása: az elfogadott (alternatív) slot foglalt MARAD —
    // az approve route csak a NEM választott alternatívákat szabadítja fel.
    const approveRes = await approveOffer(new NextRequest(`http://test.local/api/appointments/approve?token=${token}`), { params: {} });
    expect(approveRes.status).toBe(200);
    const afterApprove = await pool.query(`SELECT state, status FROM available_time_slots WHERE id = $1`, [slotC.id]);
    expect(afterApprove.rows[0]).toEqual({ state: 'booked', status: 'booked' });
    const approved = await pool.query(`SELECT approval_status, time_slot_id FROM appointments WHERE id = $1`, [offerId]);
    expect(approved.rows[0]).toEqual({ approval_status: 'approved', time_slot_id: slotC.id });
  });

  it('(c) elfogadás: az ajánlat approved, a fázis scheduled marad az ajánlaton', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const { ewp, slotB, appointment } = await bookedWorkPhaseAppointment(user);

    const res = await runCancelAndOffer(user, appointment.id, { timeSlotId: slotB.id });
    const offerId: string = (await res.json()).offer.id;
    const token: string = (await pool.query(`SELECT approval_token FROM appointments WHERE id = $1`, [offerId])).rows[0].approval_token;

    const approveRes = await approveOffer(new NextRequest(`http://test.local/api/appointments/approve?token=${token}`), { params: {} });
    expect(approveRes.status).toBe(200);
    expect(await approveRes.text()).toContain('Időpont elfogadva');

    const offer = await pool.query(`SELECT approval_status, appointment_status, approved_at FROM appointments WHERE id = $1`, [offerId]);
    expect(offer.rows[0].approval_status).toBe('approved');
    expect(offer.rows[0].appointment_status).toBeNull();
    expect(offer.rows[0].approved_at).not.toBeNull();
    const ewpAfter = await pool.query(`SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`, [ewp.id]);
    expect(ewpAfter.rows[0]).toEqual({ status: 'scheduled', appointment_id: offerId });
  });

  it('(d) sima lemondás (DELETE): a fázis visszanyílik, nem marad dangling link', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const { ewp, slotA, appointment } = await bookedWorkPhaseAppointment(user);

    const req = await authedRequest(`http://test.local/api/appointments/${appointment.id}`, { user, method: 'DELETE' });
    const res = await deleteAppointment(req, { params: { id: appointment.id } });
    expect(res.status).toBe(200);

    const gone = await pool.query(`SELECT 1 FROM appointments WHERE id = $1`, [appointment.id]);
    expect(gone.rows).toHaveLength(0);
    const ewpAfter = await pool.query(`SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`, [ewp.id]);
    expect(ewpAfter.rows[0]).toEqual({ status: 'pending', appointment_id: null });
    const slotAfter = await pool.query(`SELECT state, status FROM available_time_slots WHERE id = $1`, [slotA.id]);
    expect(slotAfter.rows[0]).toEqual({ state: 'free', status: 'available' });
  });

  it('(e) guard-ok: lemondott sorra 409, e-mail nélküli betegre 400; a visszavont ajánlat tokenje nem fogad el', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const { patient, slotB, slotC, appointment } = await bookedWorkPhaseAppointment(user);

    // első kör: ajánlat B-re
    const res1 = await runCancelAndOffer(user, appointment.id, { timeSlotId: slotB.id });
    expect(res1.status).toBe(201);
    const offer1: string = (await res1.json()).offer.id;
    const token1: string = (await pool.query(`SELECT approval_token FROM appointments WHERE id = $1`, [offer1])).rows[0].approval_token;

    // a már lemondott eredeti sorra újra: 409
    const again = await runCancelAndOffer(user, appointment.id, { timeSlotId: slotC.id });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('APPOINTMENT_NOT_OPEN');

    // az ajánlatot magát is le lehet mondani új ajánlattal (B → C): a régi token elhal
    const res2 = await runCancelAndOffer(user, offer1, { timeSlotId: slotC.id });
    expect(res2.status).toBe(201);
    const withdrawn = await pool.query(`SELECT approval_status, appointment_status, approval_token FROM appointments WHERE id = $1`, [offer1]);
    expect(withdrawn.rows[0]).toEqual({ approval_status: 'pending', appointment_status: 'cancelled_by_doctor', approval_token: null });
    const stale = await approveOffer(new NextRequest(`http://test.local/api/appointments/approve?token=${token1}`), { params: {} });
    expect(stale.status).toBe(404);

    // e-mail nélküli beteg: 400, semmi nem változik
    const offer2: string = (await res2.json()).offer.id;
    await pool.query(`UPDATE patients SET email = NULL WHERE id = $1`, [patient.id]);
    const slotE = await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 20 * MS_PER_DAY) });
    const noMail = await runCancelAndOffer(user, offer2, { timeSlotId: slotE.id });
    expect(noMail.status).toBe(400);
    expect((await noMail.json()).code).toBe('PATIENT_EMAIL_REQUIRED');
    const untouched = await pool.query(`SELECT appointment_status FROM appointments WHERE id = $1`, [offer2]);
    expect(untouched.rows[0].appointment_status).toBeNull();
  });
});
