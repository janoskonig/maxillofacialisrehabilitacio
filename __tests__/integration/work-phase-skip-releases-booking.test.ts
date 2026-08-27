import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { PATCH } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';
import { authedRequest } from './helpers/auth';
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

/**
 * WP-0.1 — `scheduled → skipped` szabadítsa fel a foglalást (audit #02).
 *
 * Viselkedési teszt: a PATCH route-ot hívjuk (a route saját kapcsolaton
 * COMMIT-ol), ezért a factory-k pool-lal (db nélkül) futnak, és afterEach-ben
 * takarítunk. A post-commit projectRemainingSteps() nem trackelt slot_intents
 * sorokat is létrehozhat, ezért az epizódhoz tartozó foglalási sorokat
 * kézzel, helyes FK-sorrendben töröljük a cleanupCreated() előtt.
 */

const createdEpisodeIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  for (const episodeId of createdEpisodeIds) {
    await pool.query(`UPDATE episode_work_phases SET appointment_id = NULL WHERE episode_id = $1`, [episodeId]);
    await pool.query(`DELETE FROM appointments WHERE episode_id = $1`, [episodeId]);
    await pool.query(`DELETE FROM slot_intents WHERE episode_id = $1`, [episodeId]);
    await pool.query(`DELETE FROM scheduling_events WHERE entity_id = $1`, [episodeId]).catch(() => {});
  }
  createdEpisodeIds.length = 0;
  await cleanupCreated();
});

/**
 * scheduled fázis + hozzá tartozó (konvertált intentből született) foglalás.
 * A slot/appointment start_time a megadott időpontra esik.
 */
async function setupScheduledPhaseWithBooking(startTime: Date) {
  const pool = getDbPool();
  const user = await createTestUser();
  const patient = await createTestPatient();
  const episode = await createTestEpisode(undefined, patient.id);
  createdEpisodeIds.push(episode.id);

  const wp = await createTestWorkPhase(undefined, episode.id, {
    workPhaseCode: 'lenyomat',
    status: 'scheduled',
    seq: 0,
  });
  const slot = await createTestSlot(undefined, user.id, {
    startTime,
    state: 'booked',
    status: 'booked',
  });
  const intent = await createTestSlotIntent(undefined, episode.id, {
    stepCode: 'lenyomat',
    stepSeq: 0,
    state: 'converted',
    workPhaseId: wp.id,
  });
  const appt = await createTestAppointment(undefined, {
    patientId: patient.id,
    timeSlotId: slot.id,
    episodeId: episode.id,
    workPhaseId: wp.id,
    slotIntentId: intent.id,
    stepCode: 'lenyomat',
    stepSeq: 0,
    startTime,
    endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
  });
  await pool.query(`UPDATE episode_work_phases SET appointment_id = $1 WHERE id = $2`, [appt.id, wp.id]);

  return { user, patient, episode, wp, slot, intent, appt };
}

async function skipPhase(
  user: { id: string; email: string },
  episodeId: string,
  workPhaseId: string
) {
  const req = await authedRequest(
    `http://test.local/api/episodes/${episodeId}/work-phases/${workPhaseId}`,
    {
      user: { id: user.id, email: user.email, role: 'fogpótlástanász' },
      method: 'PATCH',
      body: { status: 'skipped', reason: 'integrációs teszt — átugrás' },
    }
  );
  return PATCH(req, { params: { id: episodeId, workPhaseId } });
}

describe('WP-0.1: scheduled → skipped felszabadítja a foglalást', () => {
  it('jövőbeli foglalással bíró fázis skip-je: appointment lemondva, slot szabad, appointment_id NULL, intent expired', async () => {
    const pool = getDbPool();
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const { user, episode, wp, slot, intent, appt } = await setupScheduledPhaseWithBooking(future);

    const res = await skipPhase(user, episode.id, wp.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workPhase.status).toBe('skipped');
    expect(body.cancelledAppointments).toBe(1);

    const apptRow = await pool.query(`SELECT appointment_status FROM appointments WHERE id = $1`, [appt.id]);
    expect(apptRow.rows[0].appointment_status).toBe('cancelled_by_doctor');

    const slotRow = await pool.query(`SELECT state, status FROM available_time_slots WHERE id = $1`, [slot.id]);
    expect(slotRow.rows[0].state).toBe('free');
    expect(slotRow.rows[0].status).toBe('available');

    const ewpRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [wp.id]
    );
    expect(ewpRow.rows[0].status).toBe('skipped');
    expect(ewpRow.rows[0].appointment_id).toBeNull();

    const intentRow = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(intentRow.rows[0].state).toBe('expired');
  });

  it('nyitott (open) intent is lejár a skip-pel, ha a fázisra még nincs foglalás', async () => {
    const pool = getDbPool();
    const user = await createTestUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);
    const wp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      status: 'pending',
      seq: 0,
    });
    const intent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 0,
      state: 'open',
      workPhaseId: wp.id,
    });

    const res = await skipPhase(user, episode.id, wp.id);
    expect(res.status).toBe(200);

    const intentRow = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(intentRow.rows[0].state).toBe('expired');
  });

  it('MÚLTBELI appointment a skip-nél érintetlen marad (retro-skip)', async () => {
    const pool = getDbPool();
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { user, episode, wp, slot, intent, appt } = await setupScheduledPhaseWithBooking(past);

    const res = await skipPhase(user, episode.id, wp.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workPhase.status).toBe('skipped');
    expect(body.cancelledAppointments).toBe(0);

    // A megtörtént vizit nem kerül lemondásra, a slotja sem szabadul fel.
    const apptRow = await pool.query(`SELECT appointment_status FROM appointments WHERE id = $1`, [appt.id]);
    expect(apptRow.rows[0].appointment_status).toBeNull();

    const slotRow = await pool.query(`SELECT state, status FROM available_time_slots WHERE id = $1`, [slot.id]);
    expect(slotRow.rows[0].state).toBe('booked');
    expect(slotRow.rows[0].status).toBe('booked');

    // A konvertált intent is marad — a vizit megvolt.
    const intentRow = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [intent.id]);
    expect(intentRow.rows[0].state).toBe('converted');

    // A foglalás-link viszont lekerül a skip-elt sorról.
    const ewpRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [wp.id]
    );
    expect(ewpRow.rows[0].status).toBe('skipped');
    expect(ewpRow.rows[0].appointment_id).toBeNull();
  });

  it('testvér-fázis (azonos work_phase_code) foglalását a skip NEM bántja', async () => {
    // Egy epizódban két azonos work_phase_code-ú EWP sor támogatott adatalak
    // (két állcsont / több fog). A foglalás NÉLKÜLI sor skip-elése nem
    // mondhatja le a TESTVÉR jövőbeli foglalását, nem szabadíthatja fel a
    // slotját és nem járathatja le a converted intentjét.
    const pool = getDbPool();
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const user = await createTestUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);
    createdEpisodeIds.push(episode.id);

    // A skip-elendő sor: nincs foglalása.
    const wpToSkip = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      status: 'pending',
      seq: 0,
    });
    // A testvér: azonos work_phase_code, másik step_seq, jövőbeli foglalással.
    const sibling = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      status: 'scheduled',
      seq: 1,
    });
    const siblingSlot = await createTestSlot(undefined, user.id, {
      startTime: future,
      state: 'booked',
      status: 'booked',
    });
    const siblingIntent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      state: 'converted',
      workPhaseId: sibling.id,
    });
    const siblingAppt = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: siblingSlot.id,
      episodeId: episode.id,
      workPhaseId: sibling.id,
      slotIntentId: siblingIntent.id,
      stepCode: 'lenyomat',
      stepSeq: 1,
      startTime: future,
      endTime: new Date(future.getTime() + 30 * 60 * 1000),
    });
    await pool.query(`UPDATE episode_work_phases SET appointment_id = $1 WHERE id = $2`, [
      siblingAppt.id,
      sibling.id,
    ]);

    const res = await skipPhase(user, episode.id, wpToSkip.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workPhase.status).toBe('skipped');
    // A testvér foglalása nem számít lemondottnak.
    expect(body.cancelledAppointments).toBe(0);

    // A testvér appointmentje aktív marad.
    const apptRow = await pool.query(`SELECT appointment_status FROM appointments WHERE id = $1`, [
      siblingAppt.id,
    ]);
    expect(apptRow.rows[0].appointment_status).toBeNull();

    // A testvér slotja foglalt marad.
    const slotRow = await pool.query(`SELECT state, status FROM available_time_slots WHERE id = $1`, [
      siblingSlot.id,
    ]);
    expect(slotRow.rows[0].state).toBe('booked');
    expect(slotRow.rows[0].status).toBe('booked');

    // A testvér converted intentje nem jár le.
    const intentRow = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [siblingIntent.id]);
    expect(intentRow.rows[0].state).toBe('converted');

    // A testvér EWP scheduled marad, a foglalás-linkje érintetlen.
    const siblingRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [sibling.id]
    );
    expect(siblingRow.rows[0].status).toBe('scheduled');
    expect(siblingRow.rows[0].appointment_id).toBe(siblingAppt.id);

    // A skip-elt sor rendben átment.
    const skippedRow = await pool.query(
      `SELECT status, appointment_id FROM episode_work_phases WHERE id = $1`,
      [wpToSkip.id]
    );
    expect(skippedRow.rows[0].status).toBe('skipped');
    expect(skippedRow.rows[0].appointment_id).toBeNull();
  });

  it('skipped → pending visszaút is tisztítja az appointment_id-t', async () => {
    const pool = getDbPool();
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { user, episode, wp, appt } = await setupScheduledPhaseWithBooking(past);

    // Előbb skip (retro), majd visszaállítás pendingre. A link már a skip-nél
    // lenullázódik; a visszaút tesztjéhez visszaírjuk, mintha régi (a javítás
    // előtti) adat volna.
    const skipRes = await skipPhase(user, episode.id, wp.id);
    expect(skipRes.status).toBe(200);
    await pool.query(`UPDATE episode_work_phases SET appointment_id = $1 WHERE id = $2`, [appt.id, wp.id]);

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${wp.id}`,
      {
        user: { id: user.id, email: user.email, role: 'fogpótlástanász' },
        method: 'PATCH',
        body: { status: 'pending', reason: 'integrációs teszt — visszaállítás' },
      }
    );
    const res = await PATCH(req, { params: { id: episode.id, workPhaseId: wp.id } });
    expect(res.status).toBe(200);

    const ewpRow = await pool.query(
      `SELECT status, appointment_id, completed_at FROM episode_work_phases WHERE id = $1`,
      [wp.id]
    );
    expect(ewpRow.rows[0].status).toBe('pending');
    expect(ewpRow.rows[0].appointment_id).toBeNull();
    expect(ewpRow.rows[0].completed_at).toBeNull();
  });
});
