/**
 * WP-0.4 — viselkedési integrációs tesztek (audit #03).
 *
 * A hibás viselkedés: az `idx_appointments_unique_slot_intent` státusz-
 * predikátum nélküli volt, és semmi nem nullázta az
 * `appointments.slot_intent_id`-t — így a halott (no-show / lemondott) sor
 * örökre birtokolta az intentet. A no-show az intentet `expired`-re állítja,
 * a projektor ugyanazzal az id-vel `open`-re nyitja vissza, és a következő
 * konverzió MÁSIK slotra 23505-tel hasalt (INTENT_ALREADY_CONVERTED 409).
 *
 * (a) foglalás intenten át → no-show → MÁSIK slotra újrafoglalás sikerül;
 * (b) regresszió: lemondás után UGYANARRA a slotra visszafoglalás továbbra is
 *     működik (ON CONFLICT (time_slot_id) revive ág);
 * (c) régi adat: egy 085 ELŐTTI, linkjét még őrző halott sor mellett is
 *     sikerül a másik slotra konverzió — ezt a partiális index önmagában védi.
 *
 * Route-handlereket hívunk, ezért a factory-k pool-lal (db nélkül) futnak és
 * afterEach-ben takarítunk (docs/INTEGRATION_TESTS.md, 2. minta).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { PATCH as statusPatch } from '@/app/api/appointments/[id]/status/route';
import { POST as convertPost } from '@/app/api/slot-intents/[id]/convert/route';
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
import { cleanupCreatedWp02, createTestCarePathway } from './helpers/factories-wp02';
import { authedRequest, type TestAuthUser } from './helpers/auth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A route-ok által (nem factory-n át) létrehozott sorok takarításához. */
const createdEpisodeIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  if (createdEpisodeIds.length > 0) {
    // A route-created appointment sorok FK-val fogják a slot_intents /
    // available_time_slots / patient_episodes sorokat — előbb ezeket töröljük.
    await pool.query(`DELETE FROM appointments WHERE episode_id = ANY($1::uuid[])`, [
      createdEpisodeIds,
    ]);
    await pool.query(`DELETE FROM scheduling_events WHERE entity_id = ANY($1::uuid[])`, [
      createdEpisodeIds,
    ]);
    createdEpisodeIds.length = 0;
  }
  await cleanupCreated();
  // A care_pathways-ra epizód-FK mutat, ezért a közös cleanup UTÁN jön.
  await cleanupCreatedWp02();
});

async function authUser(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

/**
 * Közös felállás: pathway + EWP ('lenyomat') + lefoglalt slot + converted
 * intent + a hozzá kötött appointment (EWP-link-kel), azaz egy intenten át
 * megtörtént foglalás pillanatképe.
 */
async function bookedThroughIntent(user: TestAuthUser) {
  const pool = getDbPool();
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  createdEpisodeIds.push(episode.id);

  const pathway = await createTestCarePathway(undefined, [
    { work_phase_code: 'lenyomat', pool: 'work', duration_minutes: 30, default_days_offset: 7 },
  ]);
  await pool.query(`UPDATE patient_episodes SET care_pathway_id = $1 WHERE id = $2`, [
    pathway.id,
    episode.id,
  ]);

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

  return { patient, episode, ewp, slotA, intent, appointment };
}

describe('WP-0.4/a — no-show után MÁSIK slotra újrafoglalás (audit #03)', () => {
  it('no-show → a link lekerül a halott sorról, és a visszanyitott intent másik slotra konvertálható', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const { episode, slotA, intent, appointment } = await bookedThroughIntent(user);

    // 1) No-show jelölés a státusz-route-on.
    const noShowReq = await authedRequest(
      `http://test.local/api/appointments/${appointment.id}/status`,
      { user, method: 'PATCH', body: { appointmentStatus: 'no_show' } }
    );
    const noShowRes = await statusPatch(noShowReq, { params: { id: appointment.id } });
    expect(noShowRes.status).toBe(200);

    // Az intent lejárt ÉS a halott sor elengedte a linket.
    const deadRow = await pool.query(
      `SELECT appointment_status, slot_intent_id FROM appointments WHERE id = $1`,
      [appointment.id]
    );
    expect(deadRow.rows[0].appointment_status).toBe('no_show');
    expect(deadRow.rows[0].slot_intent_id).toBeNull();
    const intentAfterNoShow = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intent.id,
    ]);
    expect(intentAfterNoShow.rows[0].state).toBe('expired');

    // 2) A projektor ugyanazt az intentet nyitja vissza (nem születik új sor).
    await projectRemainingSteps(episode.id);
    const reopened = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(reopened.rows[0].state).toBe('open');

    // 3) Újrafoglalás MÁSIK slotra — ez hasalt korábban 23505 →
    //    INTENT_ALREADY_CONVERTED 409-cel.
    const slotB = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 14 * MS_PER_DAY),
    });
    const convertReq = await authedRequest(`http://test.local/api/slot-intents/${intent.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slotB.id },
    });
    const convertRes = await convertPost(convertReq, { params: { id: intent.id } });
    const convertBody = await convertRes.json();
    expect(convertBody.code).not.toBe('INTENT_ALREADY_CONVERTED');
    expect(convertRes.status).toBe(201);

    // Az új foglalás a másik sloton él, és ő birtokolja az intentet.
    const newAppt = await pool.query(
      `SELECT id, time_slot_id, slot_intent_id, appointment_status FROM appointments WHERE id = $1`,
      [convertBody.appointment.id]
    );
    expect(newAppt.rows[0].time_slot_id).toBe(slotB.id);
    expect(newAppt.rows[0].slot_intent_id).toBe(intent.id);
    expect(newAppt.rows[0].appointment_status).toBeNull();
    expect(newAppt.rows[0].id).not.toBe(appointment.id);

    // A no-show sor megmarad a történetben — slotja "elkelt".
    const slotAAfter = await pool.query(`SELECT state FROM available_time_slots WHERE id = $1`, [
      slotA.id,
    ]);
    expect(slotAAfter.rows[0].state).toBe('booked');

    const intentFinal = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intent.id,
    ]);
    expect(intentFinal.rows[0].state).toBe('converted');
  });
});

describe('WP-0.4/b — regresszió: lemondás után UGYANARRA a slotra visszafoglalás', () => {
  it('a revive ág (ON CONFLICT time_slot_id) frissíti a régi sort és visszaköti az intentet', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const { episode, slotA, intent, appointment } = await bookedThroughIntent(user);

    // 1) Lemondás — a slot felszabadul, az intent lejár, a link lekerül.
    const cancelReq = await authedRequest(
      `http://test.local/api/appointments/${appointment.id}/status`,
      { user, method: 'PATCH', body: { appointmentStatus: 'cancelled_by_doctor' } }
    );
    const cancelRes = await statusPatch(cancelReq, { params: { id: appointment.id } });
    expect(cancelRes.status).toBe(200);

    const deadRow = await pool.query(
      `SELECT appointment_status, slot_intent_id FROM appointments WHERE id = $1`,
      [appointment.id]
    );
    expect(deadRow.rows[0].appointment_status).toBe('cancelled_by_doctor');
    expect(deadRow.rows[0].slot_intent_id).toBeNull();
    const slotFreed = await pool.query(`SELECT state FROM available_time_slots WHERE id = $1`, [
      slotA.id,
    ]);
    expect(slotFreed.rows[0].state).toBe('free');

    // 2) Visszanyitás a projektorral.
    await projectRemainingSteps(episode.id);
    const reopened = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(reopened.rows[0].state).toBe('open');

    // 3) Visszafoglalás UGYANARRA a slotra: a revive ág a régi sort éleszti fel.
    const convertReq = await authedRequest(`http://test.local/api/slot-intents/${intent.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slotA.id },
    });
    const convertRes = await convertPost(convertReq, { params: { id: intent.id } });
    const convertBody = await convertRes.json();
    expect(convertRes.status).toBe(201);
    // Ugyanaz az appointment sor éledt újra — nem született duplikátum a slotra.
    expect(convertBody.appointment.id).toBe(appointment.id);

    const revived = await pool.query(
      `SELECT appointment_status, slot_intent_id, time_slot_id FROM appointments WHERE id = $1`,
      [appointment.id]
    );
    expect(revived.rows[0].appointment_status).toBeNull();
    expect(revived.rows[0].slot_intent_id).toBe(intent.id);
    expect(revived.rows[0].time_slot_id).toBe(slotA.id);

    const apptCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM appointments WHERE time_slot_id = $1`,
      [slotA.id]
    );
    expect(apptCount.rows[0].c).toBe(1);

    const intentFinal = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intent.id,
    ]);
    expect(intentFinal.rows[0].state).toBe('converted');
  });
});

describe('WP-0.4/c — a 085-ös partiális index a régi (linkjét őrző) halott adatot is védi', () => {
  it('egy slot_intent_id-t még őrző no-show sor mellett is sikerül a másik slotra konverzió', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'pending',
    });
    // A 085 előtti állapot szimulációja: a no-show sor MEGTARTOTTA a linket
    // (a futásidejű nullázás akkor még nem létezett), az intent viszont már
    // újra open.
    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      state: 'open',
      workPhaseId: ewp.id,
    });
    const deadSlot = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
      state: 'booked',
      status: 'booked',
    });
    const deadAppointment = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: deadSlot.id,
      episodeId: episode.id,
      workPhaseId: ewp.id,
      slotIntentId: intent.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      appointmentStatus: 'no_show',
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
    });

    const slotB = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 14 * MS_PER_DAY),
    });
    const convertReq = await authedRequest(`http://test.local/api/slot-intents/${intent.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slotB.id },
    });
    const convertRes = await convertPost(convertReq, { params: { id: intent.id } });
    const convertBody = await convertRes.json();
    expect(convertBody.code).not.toBe('INTENT_ALREADY_CONVERTED');
    expect(convertRes.status).toBe(201);

    // Mindkét sor ugyanarra az intentre mutat — de csak az élő van az index
    // hatókörében, ezért nincs 23505.
    const rows = await pool.query(
      `SELECT id, appointment_status FROM appointments WHERE slot_intent_id = $1 ORDER BY created_at`,
      [intent.id]
    );
    expect(rows.rows).toHaveLength(2);
    const statuses = rows.rows.map((r: { appointment_status: string | null }) => r.appointment_status);
    expect(statuses).toContain('no_show');
    expect(statuses).toContain(null);
    expect(rows.rows.some((r: { id: string }) => r.id === deadAppointment.id)).toBe(true);
  });
});
