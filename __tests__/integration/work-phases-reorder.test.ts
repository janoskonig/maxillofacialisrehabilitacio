import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
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
import { authedRequest } from './helpers/auth';
import { PATCH } from '@/app/api/episodes/[id]/work-phases/reorder/route';

/**
 * WP-0.5 — Reorder SAVEPOINT + swap-ütközés (audit #05).
 *
 * A korábbi kód a shiftAppointmentsAfterReorder-t egy "non-fatal" try/catch-ben
 * futtatta a BEGIN…COMMIT belsejében. Postgresben egy hibás statement abortálja
 * a tranzakciót: a COMMIT ilyenkor ROLLBACK-ként fut le, a seq-átírások is
 * elvesznek, és a válasz a rendezés ELŐTTI sorokkal ad néma 200-at. Két
 * determinisztikus kiváltó: (a) UPDATE slot_intents ütközés a
 * uq_slot_intents_episode_step_seq-cel; (b) két jövőbeli pending appointment
 * cseréje az idx_appointments_unique_pending_step-en (swap temp nélkül).
 *
 * Route-handleres teszt: a route saját pool-kapcsolaton COMMIT-ol, ezért a
 * factory-k pool-lal (db nélkül) futnak, és afterEach-ben takarítunk.
 */

afterEach(cleanupCreated);

const FUTURE_1 = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const FUTURE_2 = () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

async function callReorder(episodeId: string, stepIds: string[]) {
  const user = await createTestUser();
  const req = await authedRequest(
    `http://test.local/api/episodes/${episodeId}/work-phases/reorder`,
    {
      user: { id: user.id, email: user.email, role: 'fogpótlástanász' },
      method: 'PATCH',
      body: { stepIds },
    }
  );
  return PATCH(req, { params: { id: episodeId } });
}

async function fetchRow<T = Record<string, unknown>>(
  table: string,
  id: string
): Promise<T> {
  const { rows } = await getDbPool().query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

describe('WP-0.5 — work-phases reorder (integrációs)', () => {
  it('két lefoglalt fázis cseréje intentekkel: ténylegesen megcserélődik, nem néma 200', async () => {
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const doctor = await createTestUser();

    const slot1 = await createTestSlot(undefined, doctor.id, { startTime: FUTURE_1() });
    const slot2 = await createTestSlot(undefined, doctor.id, { startTime: FUTURE_2() });

    const intent1 = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      state: 'converted',
    });
    const intent2 = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'proba',
      stepSeq: 1,
      state: 'converted',
    });

    const appt1 = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot1.id,
      episodeId: episode.id,
      slotIntentId: intent1.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: FUTURE_1(),
    });
    const appt2 = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot2.id,
      episodeId: episode.id,
      slotIntentId: intent2.id,
      stepCode: 'proba',
      stepSeq: 1,
      startTime: FUTURE_2(),
    });

    const ewp1 = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      pathwayOrderIndex: 0,
      seq: 0,
      status: 'scheduled',
      appointmentId: appt1.id,
    });
    const ewp2 = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'proba',
      pathwayOrderIndex: 1,
      seq: 1,
      status: 'scheduled',
      appointmentId: appt2.id,
    });

    const res = await callReorder(episode.id, [ewp2.id, ewp1.id]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.partial).toBeFalsy();

    // A válasz már az ÚJ sorrendet tükrözi (nem néma 200 a régi sorokkal)
    expect(body.workPhases[0].id).toBe(ewp2.id);
    expect(body.workPhases[1].id).toBe(ewp1.id);

    // seq-ek a DB-ben is megcserélődtek
    const dbEwp1 = await fetchRow('episode_work_phases', ewp1.id);
    const dbEwp2 = await fetchRow('episode_work_phases', ewp2.id);
    expect(dbEwp2.seq).toBe(0);
    expect(dbEwp1.seq).toBe(1);

    // Az időpontok átkötése is megtörtént (appointment stays, step shifts)
    const dbAppt1 = await fetchRow('appointments', appt1.id);
    const dbAppt2 = await fetchRow('appointments', appt2.id);
    expect(dbAppt1.step_code).toBe('proba');
    expect(dbAppt1.step_seq).toBe(1);
    expect(dbAppt2.step_code).toBe('lenyomat');
    expect(dbAppt2.step_seq).toBe(0);

    // Az intentek követik az appointmentjüket (uq_slot_intents_episode_step_seq
    // ütközés nélkül — kétfázisú, sentinel-es update)
    const dbIntent1 = await fetchRow('slot_intents', intent1.id);
    const dbIntent2 = await fetchRow('slot_intents', intent2.id);
    expect(dbIntent1.step_code).toBe('proba');
    expect(dbIntent1.step_seq).toBe(1);
    expect(dbIntent1.state).toBe('converted');
    expect(dbIntent2.step_code).toBe('lenyomat');
    expect(dbIntent2.step_seq).toBe(0);

    // EWP ↔ appointment linkek konzisztensek
    expect(dbEwp2.appointment_id).toBe(appt1.id);
    expect(dbEwp2.status).toBe('scheduled');
    expect(dbEwp1.appointment_id).toBe(appt2.id);
    expect(dbEwp1.status).toBe('scheduled');
  });

  it('két lefoglalt fázis cseréje intent nélkül: az appointment-swap nem sérti az unique indexet', async () => {
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const doctor = await createTestUser();

    const slot1 = await createTestSlot(undefined, doctor.id, { startTime: FUTURE_1() });
    const slot2 = await createTestSlot(undefined, doctor.id, { startTime: FUTURE_2() });

    const appt1 = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot1.id,
      episodeId: episode.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: FUTURE_1(),
    });
    const appt2 = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot2.id,
      episodeId: episode.id,
      stepCode: 'proba',
      stepSeq: 1,
      startTime: FUTURE_2(),
    });

    const ewp1 = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      pathwayOrderIndex: 0,
      seq: 0,
      status: 'scheduled',
      appointmentId: appt1.id,
    });
    const ewp2 = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'proba',
      pathwayOrderIndex: 1,
      seq: 1,
      status: 'scheduled',
      appointmentId: appt2.id,
    });

    const res = await callReorder(episode.id, [ewp2.id, ewp1.id]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.partial).toBeFalsy();

    const dbEwp1 = await fetchRow('episode_work_phases', ewp1.id);
    const dbEwp2 = await fetchRow('episode_work_phases', ewp2.id);
    expect(dbEwp2.seq).toBe(0);
    expect(dbEwp1.seq).toBe(1);

    const dbAppt1 = await fetchRow('appointments', appt1.id);
    const dbAppt2 = await fetchRow('appointments', appt2.id);
    expect(dbAppt1.step_code).toBe('proba');
    expect(dbAppt1.step_seq).toBe(1);
    expect(dbAppt2.step_code).toBe('lenyomat');
    expect(dbAppt2.step_seq).toBe(0);

    expect(dbEwp2.appointment_id).toBe(appt1.id);
    expect(dbEwp1.appointment_id).toBe(appt2.id);
  });

  it('nem nyitott epizódon 409 EPISODE_NOT_OPEN, a seq változatlan marad', async () => {
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id, { status: 'closed' });

    const ewp1 = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      pathwayOrderIndex: 0,
      seq: 0,
    });
    const ewp2 = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'proba',
      pathwayOrderIndex: 1,
      seq: 1,
    });

    const res = await callReorder(episode.id, [ewp2.id, ewp1.id]);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body._errorMeta?.code).toBe('EPISODE_NOT_OPEN');
    expect(typeof body.error).toBe('string');

    const dbEwp1 = await fetchRow('episode_work_phases', ewp1.id);
    const dbEwp2 = await fetchRow('episode_work_phases', ewp2.id);
    expect(dbEwp1.seq).toBe(0);
    expect(dbEwp2.seq).toBe(1);
  });

  it('összevont (rejtett) al-fázisra nem köt át időpontot', async () => {
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const doctor = await createTestUser();

    const slot = await createTestSlot(undefined, doctor.id, { startTime: FUTURE_1() });
    const appt = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot.id,
      episodeId: episode.id,
      stepCode: 'proba',
      stepSeq: 2,
      startTime: FUTURE_1(),
    });

    // A (completed, elsődleges), C (pending, A-ba összevonva), B (scheduled + appt)
    const ewpA = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      pathwayOrderIndex: 0,
      seq: 0,
      status: 'completed',
      completedAt: new Date(),
    });
    const ewpC = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'radiologiai_sablon',
      pathwayOrderIndex: 1,
      seq: 1,
      status: 'pending',
    });
    await getDbPool().query(
      `UPDATE episode_work_phases SET merged_into_episode_work_phase_id = $1 WHERE id = $2`,
      [ewpA.id, ewpC.id]
    );
    const ewpB = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'proba',
      pathwayOrderIndex: 2,
      seq: 2,
      status: 'scheduled',
      appointmentId: appt.id,
    });

    // A primary sorrend nem változik ([A, B]) — de a C (rejtett al-fázis) az A
    // seq-jét örökli (0), így a régi kód őt választaná "első pending"-nek.
    const res = await callReorder(episode.id, [ewpA.id, ewpB.id]);
    expect(res.status).toBe(200);

    const dbAppt = await fetchRow('appointments', appt.id);
    expect(dbAppt.step_code).toBe('proba');
    expect(dbAppt.step_seq).toBe(2);

    const dbEwpC = await fetchRow('episode_work_phases', ewpC.id);
    expect(dbEwpC.appointment_id).toBeNull();
    expect(dbEwpC.status).toBe('pending');

    const dbEwpB = await fetchRow('episode_work_phases', ewpB.id);
    expect(dbEwpB.appointment_id).toBe(appt.id);
    expect(dbEwpB.status).toBe('scheduled');
  });

  it('shift-ütközésnél a seq-átírás megmarad, a válasz partial: true (SAVEPOINT)', async () => {
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    const doctor = await createTestUser();

    const slot = await createTestSlot(undefined, doctor.id, { startTime: FUTURE_1() });

    const intent1 = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      state: 'converted',
    });
    // Nyitott (projektor-generálta) intent a célfázison — az intent-átírás ebbe
    // ütközik bele (uq_slot_intents_episode_step_seq), determinisztikus kiváltó.
    await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'proba',
      stepSeq: 1,
      state: 'open',
    });

    const appt1 = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot.id,
      episodeId: episode.id,
      slotIntentId: intent1.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: FUTURE_1(),
    });

    const ewp1 = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      pathwayOrderIndex: 0,
      seq: 0,
      status: 'scheduled',
      appointmentId: appt1.id,
    });
    const ewp2 = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'proba',
      pathwayOrderIndex: 1,
      seq: 1,
      status: 'pending',
    });

    const res = await callReorder(episode.id, [ewp2.id, ewp1.id]);
    expect(res.status).toBe(200);
    const body = await res.json();

    // A hibás shift korábban az egész tranzakciót elvitte (néma 200 a régi
    // sorrenddel) — most a seq-átírás túléli, és a kliens jelzést kap.
    expect(body.partial).toBe(true);
    expect(typeof body.message).toBe('string');

    const dbEwp1 = await fetchRow('episode_work_phases', ewp1.id);
    const dbEwp2 = await fetchRow('episode_work_phases', ewp2.id);
    expect(dbEwp2.seq).toBe(0);
    expect(dbEwp1.seq).toBe(1);
    expect(body.workPhases[0].id).toBe(ewp2.id);

    // A shift maga visszagördült a SAVEPOINT-ig: minden marad az eredeti állapotban
    const dbAppt1 = await fetchRow('appointments', appt1.id);
    expect(dbAppt1.step_code).toBe('lenyomat');
    expect(dbAppt1.step_seq).toBe(0);

    const dbIntent1 = await fetchRow('slot_intents', intent1.id);
    expect(dbIntent1.step_code).toBe('lenyomat');
    expect(dbIntent1.step_seq).toBe(0);

    expect(dbEwp1.appointment_id).toBe(appt1.id);
    expect(dbEwp1.status).toBe('scheduled');
    expect(dbEwp2.appointment_id).toBeNull();
    expect(dbEwp2.status).toBe('pending');
  });
});
