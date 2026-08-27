/**
 * WP-0.6 — viselkedési integrációs tesztek (audit #06).
 *
 * A slot_intent → appointment konverziónak ugyanabban a tranzakcióban kell
 * az `episode_work_phases` sort is az időponthoz kötnie
 * (appointment_id + status='scheduled'), ahogy a soronkénti
 * lib/appointment-service.ts út teszi. Enélkül a worklist BOOKED-ot mutat,
 * míg a terv-kártya ugyanazt a sort „Várakozik" chippel hozza.
 *
 * (a) Kötegelt út: POST /api/episodes/:id/convert-all-intents — mindhárom
 *     fázis `scheduled`, appointment_id kitöltve.
 * (b) Soronkénti út: POST /api/slot-intents/:id/convert — ugyanez egy sorra.
 * (c) Elavult link: ha az UPSERT egy lemondott appointment-sort éleszt újra,
 *     a rá mutató MÁSIK munkafázis-hivatkozás nullázódik (a tükör első fele).
 *
 * Route-handlereket hívunk, ezért a factory-k pool-lal (db nélkül) futnak és
 * afterEach-ben takarítunk (docs/INTEGRATION_TESTS.md, 2. minta).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { POST as convertAllIntentsPost } from '@/app/api/episodes/[id]/convert-all-intents/route';
import { POST as convertIntentPost } from '@/app/api/slot-intents/[id]/convert/route';
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

/** A route-ok által (nem factory-n át) létrehozott sorok takarításához. */
const createdEpisodeIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  if (createdEpisodeIds.length > 0) {
    // A route-created appointment sorok FK-val fogják a slot_intents /
    // patient_episodes sorokat — előbb ezeket töröljük.
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

describe('WP-0.6/a — kötegelt konverzió EWP-linkje (audit #06)', () => {
  it('köteg-konverzió után mindhárom fázis scheduled, appointment_id kitöltve', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    // A slot-picker globálisan keres szabad slotot; a kijelölt orvos
    // (assigned_provider_id) rögzítése garantálja, hogy a köteg csak az e
    // teszt által létrehozott slotok közül választ (közös teszt-DB).
    await pool.query(`UPDATE patient_episodes SET assigned_provider_id = $1 WHERE id = $2`, [
      user.id,
      episode.id,
    ]);

    const stepCodes = ['lenyomat', 'harapas_rogzites', 'fogproba'] as const;
    const ewpByStep = new Map<string, string>();
    for (let i = 0; i < stepCodes.length; i++) {
      const ewp = await createTestWorkPhase(undefined, episode.id, {
        workPhaseCode: stepCodes[i],
        seq: i,
        pool: 'work',
        status: 'pending',
      });
      ewpByStep.set(stepCodes[i], ewp.id);
      await createTestSlotIntent(undefined, episode.id, {
        stepCode: stepCodes[i],
        stepSeq: i,
        pool: 'work',
        workPhaseId: ewp.id,
      });
    }

    // Nincs care pathway → a lánc-horgony gapje a hard default 14 nap.
    // A slotok ehhez igazodnak: +2, +17, +32 nap.
    await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 2 * MS_PER_DAY),
    });
    await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 17 * MS_PER_DAY),
    });
    await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 32 * MS_PER_DAY),
    });

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/convert-all-intents`,
      { user, method: 'POST' }
    );
    const res = await convertAllIntentsPost(req, { params: { id: episode.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toHaveLength(0);
    expect(body.converted).toBe(3);
    expect(body.appointmentIds).toHaveLength(3);

    // Mindhárom fázis scheduled, és PONTOSAN a saját lépésének
    // appointment-sorára mutat.
    for (const stepCode of stepCodes) {
      const apptRes = await pool.query(
        `SELECT id FROM appointments WHERE episode_id = $1 AND step_code = $2`,
        [episode.id, stepCode]
      );
      expect(apptRes.rows).toHaveLength(1);

      const ewpRes = await pool.query(
        `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
        [ewpByStep.get(stepCode)]
      );
      expect(ewpRes.rows[0].status).toBe('scheduled');
      expect(ewpRes.rows[0].appointment_id).toBe(apptRes.rows[0].id);
    }
  });
});

describe('WP-0.6/b — soronkénti konvert út EWP-linkje', () => {
  it('POST /api/slot-intents/:id/convert után a fázis scheduled + appointment_id', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      pool: 'work',
      status: 'pending',
    });
    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      pool: 'work',
      workPhaseId: ewp.id,
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

    const ewpAfter = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [ewp.id]
    );
    expect(ewpAfter.rows[0].status).toBe('scheduled');
    expect(ewpAfter.rows[0].appointment_id).toBe(body.appointment.id);

    const intentAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intent.id,
    ]);
    expect(intentAfter.rows[0].state).toBe('converted');
  });

  it('lemondott sor újraélesztésekor a MÁSIK fázis elavult linkje nullázódik', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    const slot = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 5 * MS_PER_DAY),
    });
    // Drift-forgatókönyv: a sloton lemondott appointment-sor maradt, amire egy
    // MÁSIK munkafázis még mindig (tévesen) rámutat. Az UPSERT ezt a sort
    // éleszti újra — ugyanazzal az id-val —, ezért a tükör első felének
    // nulláznia kell az elavult hivatkozást.
    const staleAppt = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot.id,
      episodeId: episode.id,
      stepCode: 'regi_lepes',
      appointmentStatus: 'cancelled_by_doctor',
    });
    const ewpStale = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'regi_lepes',
      seq: 0,
      pool: 'work',
      status: 'scheduled',
      appointmentId: staleAppt.id,
    });
    const ewpTarget = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 1,
      pool: 'work',
      status: 'pending',
    });
    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      pool: 'work',
      workPhaseId: ewpTarget.id,
    });

    const req = await authedRequest(`http://test.local/api/slot-intents/${intent.id}/convert`, {
      user,
      method: 'POST',
      body: { timeSlotId: slot.id },
    });
    const res = await convertIntentPost(req, { params: { id: intent.id } });
    expect(res.status).toBe(201);
    const body = await res.json();

    // Az UPSERT a lemondott sort élesztette újra (azonos id).
    expect(body.appointment.id).toBe(staleAppt.id);

    const staleAfter = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [ewpStale.id]
    );
    expect(staleAfter.rows[0].appointment_id).toBeNull();
    expect(staleAfter.rows[0].status).toBe('pending');

    const targetAfter = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [ewpTarget.id]
    );
    expect(targetAfter.rows[0].status).toBe('scheduled');
    expect(targetAfter.rows[0].appointment_id).toBe(staleAppt.id);
  });
});
