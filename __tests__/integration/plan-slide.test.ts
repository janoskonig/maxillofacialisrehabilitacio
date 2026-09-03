/**
 * WP-6.5 — „A terv rácsúszik a foglalt időpontokra."
 *
 * A Csanádi-eset (2026-09-03): hat heti időpont a naptárból, fázis nélkül
 * foglalva az epizódra (episode_id kitöltve, work_phase_id/step_code üres) →
 * egyik alkalom sem vette át őket, a tábla becsült ablakot mutatott, a sáv csak
 * kézi hozzárendelést kínált. Elvárás:
 *  - olvasáskor (GET work-phases) az időpontok időrendben a tervezett
 *    (időpont nélküli, nyitott tartalmú) alkalmakra csúsznak, a primary
 *    scheduled lesz és hordozza a fázis-linket;
 *  - a tervezett alkalmakon túli időpontból üres-foglalt alkalom lesz;
 *  - a menet idempotens (második olvasás nem ír);
 *  - a kézzel leválasztott időpontot (097 visit_detached_at) nem veszi vissza,
 *    a kézi hozzárendelés törli a jelölőt;
 *  - a kész alkalom nem cél; a lemondott időpontú, várakozó alkalom igen;
 *  - a fázishoz kötött foglalás a saját fázisának alkalmát kapja;
 *  - az epizód nélküli (portál) foglalás a sávban marad;
 *  - a naptári POST /api/appointments után azonnal rácsúszik.
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
import { GET as workPhasesGet } from '@/app/api/episodes/[id]/work-phases/route';
import { POST as attachPost } from '@/app/api/episodes/[id]/visits/[visitId]/attach-appointment/route';
import { POST as detachPost } from '@/app/api/episodes/[id]/visits/[visitId]/detach-appointment/route';
import { POST as appointmentsPost } from '@/app/api/appointments/route';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A route-ok által létrehozott (nem factory-s) sorokat epizód szerint takarítjuk előbb. */
const createdEpisodeIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  if (createdEpisodeIds.length > 0) {
    await pool.query(
      `DELETE FROM scheduling_events
        WHERE entity_id IN (SELECT id FROM appointments WHERE episode_id = ANY($1::uuid[]))`,
      [createdEpisodeIds]
    );
    await pool.query(`UPDATE episode_visits SET appointment_id = NULL WHERE episode_id = ANY($1::uuid[])`, [
      createdEpisodeIds,
    ]);
    await pool.query(
      `UPDATE episode_work_phases SET appointment_id = NULL WHERE episode_id = ANY($1::uuid[])`,
      [createdEpisodeIds]
    );
    await pool.query(`DELETE FROM slot_intents WHERE episode_id = ANY($1::uuid[])`, [createdEpisodeIds]);
    await pool.query(`DELETE FROM appointments WHERE episode_id = ANY($1::uuid[])`, [createdEpisodeIds]);
    await pool.query(`DELETE FROM scheduling_events WHERE entity_id = ANY($1::uuid[])`, [createdEpisodeIds]);
    createdEpisodeIds.length = 0;
  }
  await cleanupCreatedWp41a();
  await cleanupCreated();
});

async function authUser(): Promise<TestAuthUser> {
  const u = await createTestUser(undefined, { role: 'admin' });
  return { id: u.id, email: u.email, role: 'admin' };
}

async function newEpisode(patientId: string): Promise<{ id: string }> {
  const episode = await createTestEpisode(undefined, patientId);
  createdEpisodeIds.push(episode.id);
  return episode;
}

async function createVisit(episodeId: string, seq: number, daysOffset = 7): Promise<string> {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `INSERT INTO episode_visits (episode_id, seq, days_offset) VALUES ($1, $2, $3) RETURNING id`,
    [episodeId, seq, daysOffset]
  );
  return rows[0].id as string;
}

/** Tervezett alkalom egy várakozó fázissal. */
async function plannedVisit(episodeId: string, seq: number, code: string): Promise<{ visitId: string; phaseId: string }> {
  const visitId = await createVisit(episodeId, seq);
  const phase = await createWp41aWorkPhase(undefined, episodeId, { workPhaseCode: code, seq, visitId });
  return { visitId, phaseId: phase.id };
}

/** Naptári foglalás: az epizódra, fázis nélkül (a Csanádi-eset mintája). */
async function calendarBooking(
  patientId: string,
  episodeId: string | null,
  daysAhead: number,
  doctorId: string,
  extra: { workPhaseId?: string | null; appointmentStatus?: 'cancelled_by_doctor' | null } = {}
) {
  const start = new Date(Date.now() + daysAhead * DAY_MS);
  const slot = await createTestSlot(undefined, doctorId, {
    startTime: start,
    durationMinutes: 30,
    state: 'booked',
    status: 'booked',
  });
  const appt = await createTestAppointment(undefined, {
    patientId,
    timeSlotId: slot.id,
    episodeId,
    workPhaseId: extra.workPhaseId ?? null,
    appointmentStatus: extra.appointmentStatus ?? null,
    startTime: start,
    endTime: new Date(start.getTime() + 30 * 60000),
  });
  return { id: appt.id, start, slotId: slot.id };
}

async function readBoard(episodeId: string, user: TestAuthUser) {
  const req = await authedRequest(`http://test.local/api/episodes/${episodeId}/work-phases`, { user });
  const res = await workPhasesGet(req, { params: { id: episodeId } });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    visits: Array<{ id: string; seq: number; appointmentId: string | null; appointmentStatus: string | null }>;
    unattachedAppointments: Array<{ id: string; visitDetachedAt: string | null }>;
    planSlide: { adopted: number; spawned: number } | null;
  };
}

async function phaseRow(phaseId: string) {
  const { rows } = await getDbPool().query(
    `SELECT id, status, appointment_id FROM episode_work_phases WHERE id = $1`,
    [phaseId]
  );
  return rows[0] as { id: string; status: string; appointment_id: string | null } | undefined;
}

async function appointmentRow(appointmentId: string) {
  const { rows } = await getDbPool().query(
    `SELECT id, work_phase_id, step_code, episode_id, visit_detached_at FROM appointments WHERE id = $1`,
    [appointmentId]
  );
  return rows[0] as
    | { id: string; work_phase_id: string | null; step_code: string | null; episode_id: string | null; visit_detached_at: Date | null }
    | undefined;
}

describe('WP-6.5 — a terv rácsúszik a foglalt időpontokra', () => {
  it('Csanádi-eset: 6 naptári időpont időrendben a 4 tervezett alkalomra csúszik, a maradék 2 üres-foglalt alkalom lesz; idempotens', async () => {
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await newEpisode(patient.id);
    const user = await authUser();

    const codes = ['rogzitett_fogakon_mattproba', 'gen_gyujtolenyomat', 'csavarozott_implant_atadas', 'gen_kontroll'];
    const planned: Array<{ visitId: string; phaseId: string }> = [];
    for (let i = 0; i < codes.length; i++) planned.push(await plannedVisit(episode.id, i, codes[i]));

    // Szándékosan nem időrendben létrehozva — a párosítás az időrendet kövesse.
    const bookedDays = [21, 7, 42, 14, 35, 28];
    const bookings: Array<{ id: string; start: Date }> = [];
    for (const d of bookedDays) bookings.push(await calendarBooking(patient.id, episode.id, d, doctor.id));
    const chrono = [...bookings].sort((a, b) => a.start.getTime() - b.start.getTime());

    const board = await readBoard(episode.id, user);
    expect(board.planSlide).toEqual({ adopted: 4, spawned: 2 });
    expect(board.unattachedAppointments).toEqual([]);
    expect(board.visits).toHaveLength(6);

    // A 4 tervezett alkalom a helyén marad, és időrendben kapja a 4 legkorábbi időpontot.
    for (let i = 0; i < 4; i++) {
      expect(board.visits[i].id).toBe(planned[i].visitId);
      expect(board.visits[i].appointmentId).toBe(chrono[i].id);
      expect(board.visits[i].appointmentStatus).toBeNull();
      const p = await phaseRow(planned[i].phaseId);
      expect(p?.status).toBe('scheduled');
      expect(p?.appointment_id).toBe(chrono[i].id);
      const a = await appointmentRow(chrono[i].id);
      expect(a?.work_phase_id).toBe(planned[i].phaseId);
      expect(a?.step_code).toBe(codes[i]);
    }
    // A maradék 2 időpont: új, üres-foglalt alkalom időrendben, tartalom nélkül.
    const plannedIds = new Set(planned.map((p) => p.visitId));
    for (let i = 4; i < 6; i++) {
      expect(plannedIds.has(board.visits[i].id)).toBe(false);
      expect(board.visits[i].appointmentId).toBe(chrono[i].id);
      const a = await appointmentRow(chrono[i].id);
      expect(a?.work_phase_id).toBeNull();
    }

    // Idempotens: a második olvasás nem ír, a kép ugyanaz.
    const again = await readBoard(episode.id, user);
    expect(again.planSlide).toEqual({ adopted: 0, spawned: 0 });
    expect(again.visits.map((v) => [v.id, v.appointmentId])).toEqual(
      board.visits.map((v) => [v.id, v.appointmentId])
    );
  });

  it('a kézzel leválasztott időpontot a rácsúszás nem veszi vissza; a kézi hozzárendelés törli a jelölőt', async () => {
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await newEpisode(patient.id);
    const user = await authUser();
    const { visitId, phaseId } = await plannedVisit(episode.id, 0, 'gen_atadas');
    const booking = await calendarBooking(patient.id, episode.id, 7, doctor.id);

    const first = await readBoard(episode.id, user);
    expect(first.planSlide).toEqual({ adopted: 1, spawned: 0 });
    expect(first.visits[0].appointmentId).toBe(booking.id);

    const detachReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${visitId}/detach-appointment`,
      { user, method: 'POST' }
    );
    expect((await detachPost(detachReq, { params: { id: episode.id, visitId } })).status).toBe(200);
    expect((await appointmentRow(booking.id))?.visit_detached_at).not.toBeNull();

    // Olvasás: a leválasztott időpont a sávban marad, az alkalom időpont nélkül, a fázis várakozó.
    const afterDetach = await readBoard(episode.id, user);
    expect(afterDetach.planSlide).toEqual({ adopted: 0, spawned: 0 });
    expect(afterDetach.visits[0].appointmentId).toBeNull();
    expect(afterDetach.unattachedAppointments.map((a) => a.id)).toEqual([booking.id]);
    expect(afterDetach.unattachedAppointments[0].visitDetachedAt).not.toBeNull();
    expect((await phaseRow(phaseId))?.status).toBe('pending');

    // Kézi hozzárendelés: visszakerül a vázba, a jelölő lejár.
    const attachReq = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/visits/${visitId}/attach-appointment`,
      { user, method: 'POST', body: { appointmentId: booking.id } }
    );
    expect((await attachPost(attachReq, { params: { id: episode.id, visitId } })).status).toBe(200);
    expect((await appointmentRow(booking.id))?.visit_detached_at).toBeNull();
    const afterAttach = await readBoard(episode.id, user);
    expect(afterAttach.visits[0].appointmentId).toBe(booking.id);
    expect(afterAttach.unattachedAppointments).toEqual([]);
  });

  it('cél-szűrés: a kész alkalom nem kap időpontot; a lemondott időpontú várakozó és az üres tervezett alkalom igen', async () => {
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await newEpisode(patient.id);
    const user = await authUser();

    // v0: kész tartalom, időpont nélkül — történet, nem cél.
    const doneVisit = await createVisit(episode.id, 0);
    await createWp41aWorkPhase(undefined, episode.id, {
      workPhaseCode: 'gen_fogelokeszites',
      seq: 0,
      visitId: doneVisit,
      status: 'completed',
    });
    // v1: várakozó tartalom, LEMONDOTT időponttal — cél.
    const cancelledVisit = await createVisit(episode.id, 1);
    const cancelledPhase = await createWp41aWorkPhase(undefined, episode.id, {
      workPhaseCode: 'gen_lenyomat',
      seq: 1,
      visitId: cancelledVisit,
    });
    const cancelled = await calendarBooking(patient.id, episode.id, 3, doctor.id, {
      appointmentStatus: 'cancelled_by_doctor',
    });
    await getDbPool().query(`UPDATE episode_visits SET appointment_id = $1 WHERE id = $2`, [cancelled.id, cancelledVisit]);
    // v2: várakozó tartalom, időpont nélkül — cél.
    const plain = await plannedVisit(episode.id, 2, 'gen_atadas');
    // v3: üres tervezett alkalom — cél (nem nyílik helyette új alkalom).
    const emptyVisit = await createVisit(episode.id, 3);

    const early = await calendarBooking(patient.id, episode.id, 7, doctor.id);
    const late = await calendarBooking(patient.id, episode.id, 14, doctor.id);
    const last = await calendarBooking(patient.id, episode.id, 21, doctor.id);

    const board = await readBoard(episode.id, user);
    expect(board.planSlide).toEqual({ adopted: 3, spawned: 0 });
    expect(board.visits).toHaveLength(4);
    const byId = new Map(board.visits.map((v) => [v.id, v]));
    expect(byId.get(doneVisit)?.appointmentId).toBeNull();
    expect(byId.get(cancelledVisit)?.appointmentId).toBe(early.id);
    expect(byId.get(plain.visitId)?.appointmentId).toBe(late.id);
    expect(byId.get(emptyVisit)?.appointmentId).toBe(last.id);
    expect((await phaseRow(cancelledPhase.id))?.status).toBe('scheduled');
    expect((await phaseRow(plain.phaseId))?.appointment_id).toBe(late.id);
    // Az üres-foglalt alkalom időpontja nem mutat fázisra.
    expect((await appointmentRow(last.id))?.work_phase_id).toBeNull();
  });

  it('a fázishoz kötött foglalás a saját fázisának alkalmát kapja, a többi időrendben a maradék tervezettre', async () => {
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await newEpisode(patient.id);
    const user = await authUser();
    const first = await plannedVisit(episode.id, 0, 'gen_lenyomat');
    const second = await plannedVisit(episode.id, 1, 'gen_atadas');

    // A KÉSŐBBI időpont a második alkalom fázisához kötött (worklist-foglalás,
    // amit az alkalom még nem vett át); a korábbi fázis nélküli.
    const linked = await calendarBooking(patient.id, episode.id, 14, doctor.id, { workPhaseId: second.phaseId });
    const plain = await calendarBooking(patient.id, episode.id, 7, doctor.id);

    const board = await readBoard(episode.id, user);
    expect(board.planSlide).toEqual({ adopted: 2, spawned: 0 });
    const byId = new Map(board.visits.map((v) => [v.id, v]));
    expect(byId.get(second.visitId)?.appointmentId).toBe(linked.id);
    expect(byId.get(first.visitId)?.appointmentId).toBe(plain.id);
    expect((await phaseRow(second.phaseId))?.appointment_id).toBe(linked.id);
    expect((await phaseRow(first.phaseId))?.appointment_id).toBe(plain.id);
  });

  it('az epizód nélküli (portál) foglalást nem veszi fel — a sávban marad kézi hozzárendelésre', async () => {
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await newEpisode(patient.id);
    const user = await authUser();
    const { visitId } = await plannedVisit(episode.id, 0, 'gen_lenyomat');
    const portal = await calendarBooking(patient.id, null, 7, doctor.id);

    const board = await readBoard(episode.id, user);
    expect(board.planSlide).toEqual({ adopted: 0, spawned: 0 });
    expect(board.visits[0].id).toBe(visitId);
    expect(board.visits[0].appointmentId).toBeNull();
    expect(board.unattachedAppointments.map((a) => a.id)).toEqual([portal.id]);
    expect(board.unattachedAppointments[0].visitDetachedAt).toBeNull();
  });

  it('naptári foglalás (POST /api/appointments, fázis nélkül) után a terv azonnal rácsúszik', async () => {
    const doctor = await createTestUser(undefined, { doktorNeve: 'Dr. Váz' });
    const patient = await createTestPatient();
    const episode = await newEpisode(patient.id);
    const user = await authUser();
    const { visitId, phaseId } = await plannedVisit(episode.id, 0, 'gen_lenyomat');
    const slot = await createTestSlot(undefined, doctor.id, {
      startTime: new Date(Date.now() + 10 * DAY_MS),
      durationMinutes: 30,
      state: 'free',
      status: 'available',
    });

    const req = await authedRequest('http://test.local/api/appointments', {
      user,
      method: 'POST',
      body: { patientId: patient.id, timeSlotId: slot.id, episodeId: episode.id, pool: 'work', createdVia: 'worklist' },
    });
    const res = await appointmentsPost(req, { params: {} });
    expect(res.status).toBe(201);
    const appointmentId = (await res.json()).appointment.id as string;

    // Már a POST után: az alkalom birtokolja az időpontot, a fázis scheduled.
    const { rows } = await getDbPool().query(`SELECT appointment_id FROM episode_visits WHERE id = $1`, [visitId]);
    expect(rows[0].appointment_id).toBe(appointmentId);
    expect((await phaseRow(phaseId))?.status).toBe('scheduled');
    expect((await appointmentRow(appointmentId))?.work_phase_id).toBe(phaseId);

    // Az olvasás már nem ír.
    const board = await readBoard(episode.id, user);
    expect(board.planSlide).toEqual({ adopted: 0, spawned: 0 });
    expect(board.visits[0].appointmentId).toBe(appointmentId);
  });
});
