/**
 * WP-0.2 — viselkedési integrációs tesztek (audit #04 + #10).
 *
 * (a) `mark_unsuccessful` a foglaláshoz kötött `converted` slot_intentet
 *     `expired`-re állítja még a tranzakcióban, majd a projektor `open`-re
 *     nyitja vissza — így a lépés újra bekerül az „Összes szükséges időpont
 *     lefoglalása" kötegbe.
 * (b) Ha a köteg ELSŐ intentje kimarad (skip), a 2. intent alsó korlátja nem
 *     a `now`, hanem `now + a saját pathway-gapje` — a horgony-előretolás az
 *     első lépés kihagyásakor is megtörténik.
 *
 * Route-handlereket hívunk, ezért a factory-k pool-lal (db nélkül) futnak és
 * afterEach-ben takarítunk (docs/INTEGRATION_TESTS.md, 2. minta).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';
import { PATCH as attemptOutcomePatch } from '@/app/api/appointments/[id]/attempt-outcome/route';
import { POST as convertAllIntentsPost } from '@/app/api/episodes/[id]/convert-all-intents/route';
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
  // A care_pathways-ra epizód-FK mutat, ezért a közös cleanup UTÁN jön.
  await cleanupCreatedWp02();
});

async function authUser(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

describe('WP-0.2/a — mark_unsuccessful intent-lejáratás (audit #04)', () => {
  it('a converted slot_intent expired lesz a sikertelen-jelöléskor', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'scheduled',
    });
    const slot = await createTestSlot(undefined, user.id);
    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      state: 'converted',
      workPhaseId: ewp.id,
    });
    const appointment = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot.id,
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

    // Sanity: kiindulásban tényleg converted.
    const before = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(before.rows[0].state).toBe('converted');

    const req = await authedRequest(
      `http://test.local/api/appointments/${appointment.id}/attempt-outcome`,
      {
        user,
        method: 'PATCH',
        body: { action: 'mark_unsuccessful', reason: 'torzult lenyomat, ismételni kell' },
      }
    );
    const res = await attemptOutcomePatch(req, { params: { id: appointment.id } });
    expect(res.status).toBe(200);

    // Nincs care pathway → a post-commit projektor NO_PATHWAY-jal kilép, így
    // a route saját hatása látszik: az intent expired (nem maradhat converted).
    const after = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(after.rows[0].state).toBe('expired');

    // A munkafázis visszanyílt, a link lekerült róla.
    const ewpAfter = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [ewp.id]
    );
    expect(ewpAfter.rows[0].status).toBe('pending');
    expect(ewpAfter.rows[0].appointment_id).toBeNull();
  });

  it('a lejáratott intentet a projektor open-re nyitja vissza (újra foglalható)', async () => {
    const pool = getDbPool();
    const user = await authUser();
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
    const slot = await createTestSlot(undefined, user.id);
    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      state: 'converted',
      workPhaseId: ewp.id,
    });
    const appointment = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot.id,
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

    const req = await authedRequest(
      `http://test.local/api/appointments/${appointment.id}/attempt-outcome`,
      {
        user,
        method: 'PATCH',
        body: { action: 'mark_unsuccessful', reason: 'torzult lenyomat, ismételni kell' },
      }
    );
    const res = await attemptOutcomePatch(req, { params: { id: appointment.id } });
    expect(res.status).toBe(200);

    // Determinisztikus visszanyitás: explicit projektor-futás (a route
    // post-commit hívása ugyanezt teszi, de nem-blokkoló).
    await projectRemainingSteps(episode.id);

    const after = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(after.rows[0].state).toBe('open');

    // Ugyanaz a sor nyílt vissza — nem született duplikátum a lépésre.
    const count = await pool.query(
      `SELECT COUNT(*)::int AS c FROM slot_intents WHERE episode_id = $1 AND step_code = 'lenyomat'`,
      [episode.id]
    );
    expect(count.rows[0].c).toBe(1);
  });
});

describe('WP-0.2/b — vezető intent kihagyásának horgonya (audit #10)', () => {
  it('ha a köteg 1. intentje skipped, a 2. intent padlója now + gap, nem a now', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    // 1. lépés: consult pool — consult slot nincs, ezért kimarad (skip).
    const ewpA = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'konzultacio',
      seq: 0,
      pool: 'consult',
      status: 'pending',
    });
    // 2. lépés: work pool.
    const ewpB = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 1,
      pool: 'work',
      status: 'pending',
    });

    await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'konzultacio',
      stepSeq: 0,
      pool: 'consult',
      workPhaseId: ewpA.id,
    });
    const intentB = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      pool: 'work',
      workPhaseId: ewpB.id,
    });

    // Két work slot: egy korai (now+2 nap) és egy késői (now+20 nap). Nincs
    // pathway és nincs episode-szintű offset → a gap a hard default 14 nap,
    // tehát helyes horgonnyal a korai slot NEM választható a 2. lépésre.
    const earlySlot = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 2 * MS_PER_DAY),
    });
    const lateSlot = await createTestSlot(undefined, user.id, {
      startTime: new Date(Date.now() + 20 * MS_PER_DAY),
    });

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/convert-all-intents`,
      { user, method: 'POST' }
    );
    const res = await convertAllIntentsPost(req, { params: { id: episode.id } });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Az 1. intent kimaradt (nincs consult slot), a 2. konvertálódott.
    expect(body.skipped).toHaveLength(1);
    expect(body.converted).toBe(1);
    expect(body.appointmentIds).toHaveLength(1);

    const appt = await pool.query(
      `SELECT time_slot_id, start_time FROM appointments WHERE id = $1`,
      [body.appointmentIds[0]]
    );
    expect(appt.rows).toHaveLength(1);
    // A horgony-előretolás miatt a korai (now+2 nap) slot tilos: a foglalás a
    // now+14 nap utáni első szabad slotra (now+20 nap) esik.
    expect(appt.rows[0].time_slot_id).toBe(lateSlot.id);
    expect(new Date(appt.rows[0].start_time).getTime()).toBeGreaterThan(
      Date.now() + 13 * MS_PER_DAY
    );
    expect(appt.rows[0].time_slot_id).not.toBe(earlySlot.id);

    // A konvertált intent állapota is rendben.
    const intentAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intentB.id,
    ]);
    expect(intentAfter.rows[0].state).toBe('converted');
  });
});
