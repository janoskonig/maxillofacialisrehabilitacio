/**
 * WP-0.8 / audit #08 — viselkedési integrációs tesztek.
 *
 * A „Visszavonás" (revert) ág: ha a lépésre időközben már lefoglalták a
 * következő próbát, a visszavonás korábban determinisztikus, generikus 409-et
 * adott (23505 az `idx_appointments_unique_work_phase_active` / `_pending_step`
 * indexen → „Már létezik ilyen rekord"). Most:
 *   (a) típusos 409 `RETRY_ALREADY_BOOKED` kóddal + a blokkoló appointment
 *       id-jével (a reassign-step route mintájára), az appointment érintetlen;
 *   (b) work_phase_id-elsődleges párosítás: a legacy (link nélküli) blokkolót
 *       is megfogja step_code szerint;
 *   (c) blokkoló nélkül a revert továbbra is működik (200, státusz NULL).
 *
 * Route-handlert hívunk, ezért a factory-k pool-lal (db nélkül) futnak és
 * afterEach-ben takarítunk (docs/INTEGRATION_TESTS.md, 2. minta).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getDbPool } from '@/lib/db';
import { PATCH as attemptOutcomePatch } from '@/app/api/appointments/[id]/attempt-outcome/route';
import {
  cleanupCreated,
  createTestAppointment,
  createTestEpisode,
  createTestPatient,
  createTestSlot,
  createTestUser,
  createTestWorkPhase,
} from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

afterEach(cleanupCreated);

async function authUser(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

describe('WP-0.8 / #08 — revert blokkolása lefoglalt következő próbánál', () => {
  it('típusos 409 RETRY_ALREADY_BOOKED a blokkoló appointment id-jével (work_phase_id szerint)', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'scheduled',
    });

    // 1. próba: sikertelennek jelölt appointment (ezt akarnánk visszavonni).
    const slot1 = await createTestSlot(undefined, user.id);
    const unsuccessful = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot1.id,
      episodeId: episode.id,
      workPhaseId: ewp.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() - 1 * MS_PER_DAY),
      appointmentStatus: 'unsuccessful',
      attemptNumber: 1,
    });

    // 2. próba: időközben lefoglalt AKTÍV appointment ugyanarra a fázisra.
    const slot2 = await createTestSlot(undefined, user.id);
    const retry = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot2.id,
      episodeId: episode.id,
      workPhaseId: ewp.id,
      stepCode: 'lenyomat',
      stepSeq: 1,
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
      attemptNumber: 2,
    });

    const req = await authedRequest(
      `http://test.local/api/appointments/${unsuccessful.id}/attempt-outcome`,
      {
        user,
        method: 'PATCH',
        body: { action: 'revert', reason: 'tévedésből jelöltem sikertelennek' },
      }
    );
    const res = await attemptOutcomePatch(req, { params: { id: unsuccessful.id } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('RETRY_ALREADY_BOOKED');
    expect(body.blockingAppointmentId).toBe(retry.id);

    // Rollback: a sikertelen-jelölés érintetlen maradt.
    const after = await pool.query(
      `SELECT appointment_status FROM appointments WHERE id = $1`,
      [unsuccessful.id]
    );
    expect(after.rows[0].appointment_status).toBe('unsuccessful');
  });

  it('legacy (work_phase_id nélküli) blokkolót is megfog step_code szerint', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'scheduled',
    });

    const slot1 = await createTestSlot(undefined, user.id);
    const unsuccessful = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot1.id,
      episodeId: episode.id,
      workPhaseId: ewp.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() - 1 * MS_PER_DAY),
      appointmentStatus: 'unsuccessful',
      attemptNumber: 1,
    });

    // Legacy blokkoló: nincs work_phase_id, csak step_code.
    const slot2 = await createTestSlot(undefined, user.id);
    const legacyRetry = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot2.id,
      episodeId: episode.id,
      workPhaseId: null,
      stepCode: 'lenyomat',
      stepSeq: 1,
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
      attemptNumber: 2,
    });

    const req = await authedRequest(
      `http://test.local/api/appointments/${unsuccessful.id}/attempt-outcome`,
      {
        user,
        method: 'PATCH',
        body: { action: 'revert', reason: 'tévedésből jelöltem sikertelennek' },
      }
    );
    const res = await attemptOutcomePatch(req, { params: { id: unsuccessful.id } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('RETRY_ALREADY_BOOKED');
    expect(body.blockingAppointmentId).toBe(legacyRetry.id);

    const after = await pool.query(
      `SELECT appointment_status FROM appointments WHERE id = $1`,
      [unsuccessful.id]
    );
    expect(after.rows[0].appointment_status).toBe('unsuccessful');
  });

  it('blokkoló nélkül a revert továbbra is működik (200, státusz NULL)', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'pending',
    });

    const slot = await createTestSlot(undefined, user.id);
    const unsuccessful = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slot.id,
      episodeId: episode.id,
      workPhaseId: ewp.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() - 1 * MS_PER_DAY),
      appointmentStatus: 'unsuccessful',
      attemptNumber: 1,
    });

    const req = await authedRequest(
      `http://test.local/api/appointments/${unsuccessful.id}/attempt-outcome`,
      {
        user,
        method: 'PATCH',
        body: { action: 'revert', reason: 'tévedésből jelöltem sikertelennek' },
      }
    );
    const res = await attemptOutcomePatch(req, { params: { id: unsuccessful.id } });
    expect(res.status).toBe(200);

    const after = await pool.query(
      `SELECT appointment_status, attempt_failed_reason FROM appointments WHERE id = $1`,
      [unsuccessful.id]
    );
    expect(after.rows[0].appointment_status).toBeNull();
    expect(after.rows[0].attempt_failed_reason).toBeNull();
  });
});
