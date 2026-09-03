/**
 * Puzzle v2 (094) — „az időpontfoglalás a váz, a tartalom a kezelési terv".
 *
 *  - attach-appointment: nyitott foglalás az (üres) alkalomhoz; a tartalom
 *    rácsúszik (a primary scheduled + appointments.work_phase_id);
 *  - a primary áthelyezése: a foglalás az alkalomnál marad, a fázis várakozó
 *    lesz, a következő tag promótálódik az időpontra;
 *  - az utolsó fázis törlése: az alkalom és az időpontja megmarad (üres, foglalt);
 *  - az üres, foglalt alkalom törlése: a foglalás lemondva, a slot szabad;
 *  - detach-appointment: a foglalás alkalom nélkül marad, a tartalom várakozó;
 *  - a foglalt alkalmak időrendben pinnelve (normalizeVisitOrder);
 *  - GET work-phases: visits[].appointment* + unattachedAppointments[].
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import {
  cleanupCreated,
  createTestEpisode,
  createTestPatient,
  createTestUser,
  createTestSlot,
  createTestAppointment,
} from './helpers/factories';
import { cleanupCreatedWp41a, createWp41aWorkPhase } from './helpers/factories-wp41a';
import { authedRequest, type TestAuthUser } from './helpers/auth';
import { GET as workPhasesGet, POST as workPhasePost } from '@/app/api/episodes/[id]/work-phases/route';
import { PATCH as workPhasePatch, DELETE as workPhaseDelete } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';
import { DELETE as visitDelete } from '@/app/api/episodes/[id]/visits/[visitId]/route';
import { POST as attachPost } from '@/app/api/episodes/[id]/visits/[visitId]/attach-appointment/route';
import { POST as detachPost } from '@/app/api/episodes/[id]/visits/[visitId]/detach-appointment/route';

afterEach(async () => {
  await cleanupCreatedWp41a();
  await cleanupCreated();
});

async function authUser(): Promise<TestAuthUser> {
  const u = await createTestUser(undefined, { role: 'admin' });
  return { id: u.id, email: u.email, role: 'admin' };
}

async function createVisit(episodeId: string, seq: number, daysOffset = 7): Promise<string> {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `INSERT INTO episode_visits (episode_id, seq, days_offset) VALUES ($1, $2, $3) RETURNING id`,
    [episodeId, seq, daysOffset]
  );
  return rows[0].id as string;
}

async function visitRow(visitId: string) {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT v.id, v.seq, v.appointment_id, a.work_phase_id AS appt_work_phase_id, a.appointment_status
     FROM episode_visits v LEFT JOIN appointments a ON a.id = v.appointment_id WHERE v.id = $1`,
    [visitId]
  );
  return rows[0] as
    | { id: string; seq: number; appointment_id: string | null; appt_work_phase_id: string | null; appointment_status: string | null }
    | undefined;
}

async function phaseRow(phaseId: string) {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT id, status, appointment_id, visit_id, merged_into_episode_work_phase_id AS merged_into
     FROM episode_work_phases WHERE id = $1`,
    [phaseId]
  );
  return rows[0] as
    | { id: string; status: string; appointment_id: string | null; visit_id: string | null; merged_into: string | null }
    | undefined;
}

/** Jövőbeli, nyitott foglalás a betegnek (epizódhoz kötve, fázis nélkül). */
async function futureAppointment(patientId: string, episodeId: string, daysAhead: number, doctorId: string) {
  const start = new Date(Date.now() + daysAhead * 86400000);
  const slot = await createTestSlot(undefined, doctorId, { startTime: start, durationMinutes: 30, state: 'booked', status: 'booked' });
  const appt = await createTestAppointment(undefined, {
    patientId,
    timeSlotId: slot.id,
    episodeId,
    startTime: start,
    endTime: new Date(start.getTime() + 30 * 60000),
  });
  return { appt, slot, start };
}

describe('Puzzle v2 — a váz: alkalom-tulajdonú időpont', () => {
  it('attach: az üres alkalom megkapja az időpontot; a hozzáadott fázis rácsúszik (scheduled + link)', async () => {
    const pool = getDbPool();
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0);
    const { appt } = await futureAppointment(patient.id, episode.id, 3, doctor.id);
    const user = await authUser();

    // GET (WP-6.5): az epizód alkalom nélküli foglalása olvasáskor magától az
    // üres tervezett alkalomra csúszik — a sáv üres, az alkalom foglalt.
    const getReq0 = await authedRequest(`http://test.local/api/episodes/${episode.id}/work-phases`, { user });
    const get0 = await (await workPhasesGet(getReq0, { params: { id: episode.id } })).json();
    expect(get0.planSlide).toEqual({ adopted: 1, spawned: 0 });
    expect(get0.unattachedAppointments).toEqual([]);
    expect(get0.visits[0].appointmentId).toBe(appt.id);

    // A kézi hozzárendelés ugyanarra az alkalomra idempotens (200, nem 409).
    const attachReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/attach-appointment`,
      { user, method: 'POST', body: { appointmentId: appt.id } }
    );
    const attachRes = await attachPost(attachReq, { params: { id: episode.id, visitId: v1 } });
    expect(attachRes.status).toBe(200);
    expect((await visitRow(v1))?.appointment_id).toBe(appt.id);

    // Üres, foglalt alkalom: a foglalás nem mutat fázisra.
    expect((await visitRow(v1))?.appt_work_phase_id).toBeNull();

    // Tartalom hozzáadása az alkalomhoz → a fázis a foglalásra csúszik.
    const addReq = await authedRequest(`http://test.local/api/episodes/${episode.id}/work-phases`, {
      user,
      method: 'POST',
      body: { workPhaseCode: 'gen_csonkpreparalas', visitId: v1 },
    });
    const addRes = await workPhasePost(addReq, { params: { id: episode.id } });
    expect(addRes.status).toBe(201);
    const phaseId = (await addRes.json()).workPhase.id as string;
    const p = await phaseRow(phaseId);
    expect(p?.status).toBe('scheduled');
    expect(p?.appointment_id).toBe(appt.id);
    expect((await visitRow(v1))?.appt_work_phase_id).toBe(phaseId);

    // Második tartalom: a blokk része (alá vonva), a foglalást a primary hordozza.
    const addReq2 = await authedRequest(`http://test.local/api/episodes/${episode.id}/work-phases`, {
      user,
      method: 'POST',
      body: { workPhaseCode: 'gen_lenyomatvetel', visitId: v1 },
    });
    const phase2Id = (await (await workPhasePost(addReq2, { params: { id: episode.id } })).json()).workPhase.id as string;
    const p2 = await phaseRow(phase2Id);
    expect(p2?.merged_into).toBe(phaseId);
    expect(p2?.appointment_id).toBeNull();

    // GET: a vizit hordozza az időpontot, a foglalás már nem „alkalom nélküli".
    const getReq = await authedRequest(`http://test.local/api/episodes/${episode.id}/work-phases`, { user });
    const get = await (await workPhasesGet(getReq, { params: { id: episode.id } })).json();
    expect(get.visits[0].appointmentId).toBe(appt.id);
    expect(get.visits[0].appointmentStart).toBeTruthy();
    expect(get.unattachedAppointments).toHaveLength(0);
    void pool;
  });

  it('a primary áthelyezése: az időpont az alkalomnál marad, a fázis várakozó, a következő tag promótálódik', async () => {
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0);
    const v2 = await createVisit(episode.id, 1);
    const { appt } = await futureAppointment(patient.id, episode.id, 3, doctor.id);
    const user = await authUser();
    const primary = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'a', seq: 0, visitId: v1 });
    const second = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'b', seq: 1, visitId: v1 });
    const attachReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/attach-appointment`,
      { user, method: 'POST', body: { appointmentId: appt.id } }
    );
    expect((await attachPost(attachReq, { params: { id: episode.id, visitId: v1 } })).status).toBe(200);
    expect((await phaseRow(primary.id))?.status).toBe('scheduled');
    expect((await phaseRow(second.id))?.merged_into).toBe(primary.id);

    const moveReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${primary.id}`,
      { user, method: 'PATCH', body: { visitId: v2 } }
    );
    expect((await workPhasePatch(moveReq, { params: { id: episode.id, workPhaseId: primary.id } })).status).toBe(200);

    const moved = await phaseRow(primary.id);
    expect(moved?.visit_id).toBe(v2);
    expect(moved?.status).toBe('pending');
    expect(moved?.appointment_id).toBeNull();
    // A forrás megtartotta az időpontot; a másik tag lett a primary rajta.
    const v1row = await visitRow(v1);
    expect(v1row?.appointment_id).toBe(appt.id);
    const promoted = await phaseRow(second.id);
    expect(promoted?.merged_into).toBeNull();
    expect(promoted?.status).toBe('scheduled');
    expect(promoted?.appointment_id).toBe(appt.id);
    expect(v1row?.appt_work_phase_id).toBe(second.id);
  });

  it('az utolsó fázis törlése: az alkalom és az időpontja megmarad; az üres foglalt alkalom törlése lemondja', async () => {
    const pool = getDbPool();
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0);
    const { appt, slot } = await futureAppointment(patient.id, episode.id, 3, doctor.id);
    const user = await authUser();
    const only = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'a', seq: 0, visitId: v1 });
    const attachReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/attach-appointment`,
      { user, method: 'POST', body: { appointmentId: appt.id } }
    );
    expect((await attachPost(attachReq, { params: { id: episode.id, visitId: v1 } })).status).toBe(200);

    const delReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${only.id}`,
      { user, method: 'DELETE' }
    );
    const delRes = await workPhaseDelete(delReq, { params: { id: episode.id, workPhaseId: only.id } });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.cancelledAppointments).toBe(0);
    expect(delBody.keptAppointmentId).toBe(appt.id);
    const v1row = await visitRow(v1);
    expect(v1row?.appointment_id).toBe(appt.id);
    expect(v1row?.appointment_status).toBeNull();
    expect(v1row?.appt_work_phase_id).toBeNull();

    // Az üres, foglalt alkalom törlése: a foglalás lemondva, a slot szabad.
    const vdelReq = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits/${v1}`, {
      user,
      method: 'DELETE',
    });
    const vdelRes = await visitDelete(vdelReq, { params: { id: episode.id, visitId: v1 } });
    expect(vdelRes.status).toBe(200);
    expect((await vdelRes.json()).cancelledAppointment).toBe(true);
    const a = await pool.query(`SELECT appointment_status FROM appointments WHERE id = $1`, [appt.id]);
    expect(a.rows[0].appointment_status).toBe('cancelled_by_doctor');
    const s = await pool.query(`SELECT state FROM available_time_slots WHERE id = $1`, [slot.id]);
    expect(s.rows[0].state).toBe('free');
  });

  it('detach: a foglalás alkalom nélkül marad (nem lemondva), a tartalom várakozó; újra hozzárendelhető', async () => {
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0);
    const v2 = await createVisit(episode.id, 1);
    const { appt } = await futureAppointment(patient.id, episode.id, 3, doctor.id);
    const user = await authUser();
    const only = await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'a', seq: 0, visitId: v1 });
    const attachReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/attach-appointment`,
      { user, method: 'POST', body: { appointmentId: appt.id } }
    );
    expect((await attachPost(attachReq, { params: { id: episode.id, visitId: v1 } })).status).toBe(200);

    const detReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/detach-appointment`,
      { user, method: 'POST' }
    );
    expect((await detachPost(detReq, { params: { id: episode.id, visitId: v1 } })).status).toBe(200);
    expect((await visitRow(v1))?.appointment_id).toBeNull();
    const p = await phaseRow(only.id);
    expect(p?.status).toBe('pending');
    expect(p?.appointment_id).toBeNull();
    const getReq = await authedRequest(`http://test.local/api/episodes/${episode.id}/work-phases`, { user });
    const get = await (await workPhasesGet(getReq, { params: { id: episode.id } })).json();
    expect(get.unattachedAppointments.map((a: { id: string }) => a.id)).toContain(appt.id);

    // Másik alkalomhoz rendelve.
    const attach2 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v2}/attach-appointment`,
      { user, method: 'POST', body: { appointmentId: appt.id } }
    );
    expect((await attachPost(attach2, { params: { id: episode.id, visitId: v2 } })).status).toBe(200);
    expect((await visitRow(v2))?.appointment_id).toBe(appt.id);
    // Ugyanaz az időpont másik alkalomhoz már nem köthető.
    const attach3 = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${v1}/attach-appointment`,
      { user, method: 'POST', body: { appointmentId: appt.id } }
    );
    const res3 = await attachPost(attach3, { params: { id: episode.id, visitId: v1 } });
    expect(res3.status).toBe(409);
    expect((await res3.json()).code).toBe('APPOINTMENT_ATTACHED');
  });

  it('a foglalt alkalmak időrendben pinnelve: a későbbi sorszámú alkalom korábbi időponttal előre csúszik', async () => {
    const pool = getDbPool();
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const v1 = await createVisit(episode.id, 0);
    const v2 = await createVisit(episode.id, 1);
    const v3 = await createVisit(episode.id, 2);
    const later = await futureAppointment(patient.id, episode.id, 10, doctor.id);
    const earlier = await futureAppointment(patient.id, episode.id, 3, doctor.id);
    const user = await authUser();
    await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'a', seq: 0, visitId: v1 });
    await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'b', seq: 1, visitId: v2 });
    await createWp41aWorkPhase(undefined, episode.id, { workPhaseCode: 'c', seq: 2, visitId: v3 });

    // v1 ← később (10 nap), v3 ← korábban (3 nap): v3-nak v1 elé kell kerülnie, v2 (tervezett) marad középen.
    let req = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits/${v1}/attach-appointment`, {
      user, method: 'POST', body: { appointmentId: later.appt.id },
    });
    expect((await attachPost(req, { params: { id: episode.id, visitId: v1 } })).status).toBe(200);
    req = await authedRequest(`http://test.local/api/episodes/${episode.id}/visits/${v3}/attach-appointment`, {
      user, method: 'POST', body: { appointmentId: earlier.appt.id },
    });
    expect((await attachPost(req, { params: { id: episode.id, visitId: v3 } })).status).toBe(200);

    const order = await pool.query(`SELECT id FROM episode_visits WHERE episode_id = $1 ORDER BY seq`, [episode.id]);
    expect(order.rows.map((r: { id: string }) => r.id)).toEqual([v3, v2, v1]);
    // A fázis-sorrend (a motorok igazsága) követi: c, b, a.
    const phases = await pool.query(
      `SELECT work_phase_code FROM episode_work_phases WHERE episode_id = $1 ORDER BY COALESCE(seq, pathway_order_index)`,
      [episode.id]
    );
    expect(phases.rows.map((r: { work_phase_code: string }) => r.work_phase_code)).toEqual(['c', 'b', 'a']);
  });
});
