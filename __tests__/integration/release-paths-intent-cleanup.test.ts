/**
 * WP-0.8 kiegészítés (a WP-0.4 review-jából) — viselkedési integrációs
 * tesztek három elő-létező, azonos alakú hézagra. Mindhárom lemondási út a
 * skip-ág pontos mintájára: a lemondott appointmenthez kötött 'converted'
 * slot_intent lejár + az appointments.slot_intent_id link elengedve.
 *
 *  (a) completed → pending („Mégsem kész") ág a work-phases/[workPhaseId]
 *      route-ban — az appointment-párosítás work_phase_id-elsődleges lett
 *      (csupasz step_code duplikált fáziskódnál a testvér foglalását is
 *      lemondaná);
 *  (b) betegportál-lemondás (patient-portal/appointments/[id] DELETE);
 *  (c) hold-lejárat (lib/hold-expiry.ts, hold_expired ág).
 *
 * Route-handlereket / worker-t hívunk, ezért a factory-k pool-lal (db nélkül)
 * futnak és afterEach-ben takarítunk (docs/INTEGRATION_TESTS.md, 2. minta).
 * A (b)-hez a next/headers cookies() a collaborator-határon van mockolva
 * (a route-handler tesztben nincs Next request-scope), a session-JWT valódi.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { getDbPool } from '@/lib/db';
import { runHoldExpiry } from '@/lib/hold-expiry';
import { PATCH as workPhasePatch } from '@/app/api/episodes/[id]/work-phases/[workPhaseId]/route';
import { DELETE as portalCancelDelete } from '@/app/api/patient-portal/appointments/[id]/route';
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

const portalCookie = vi.hoisted(() => ({ value: null as string | null }));

vi.mock('next/headers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/headers')>();
  return {
    ...actual,
    cookies: async () => ({
      get: (name: string) =>
        name === 'patient_portal_session' && portalCookie.value
          ? { name, value: portalCookie.value }
          : undefined,
    }),
  };
});

afterEach(async () => {
  portalCookie.value = null;
  const pool = getDbPool();
  // A betegportál-lemondás admin-értesítési sort is ír — takarítsuk.
  await pool.query(
    `DELETE FROM admin_notification_queue
      WHERE notification_type = 'appointment_cancelled_by_patient'
        AND summary_text LIKE '%Integrációs Tesztbeteg%'`
  ).catch(() => {});
  await cleanupCreated();
});

async function authUser(): Promise<TestAuthUser> {
  const user = await createTestUser(undefined, { role: 'fogpótlástanász' });
  return { id: user.id, email: user.email, role: 'fogpótlástanász' };
}

async function portalSessionToken(patientId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'
  );
  return await new SignJWT({ patientId, type: 'patient_portal' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

describe('WP-0.8 kiegészítés (a) — „Mégsem kész" ág intent-takarítása', () => {
  it('a jövőbeli foglalás lemondásakor a converted intent lejár és a link elenged', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'completed',
      completedAt: new Date(),
    });
    const slot = await createTestSlot(undefined, user.id, {
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
      timeSlotId: slot.id,
      episodeId: episode.id,
      workPhaseId: ewp.id,
      slotIntentId: intent.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
    });

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${ewp.id}`,
      {
        user,
        method: 'PATCH',
        body: { status: 'pending', reason: 'mégsem készült el a fázis' },
      }
    );
    const res = await workPhasePatch(req, {
      params: { id: episode.id, workPhaseId: ewp.id },
    });
    expect(res.status).toBe(200);

    const apptAfter = await pool.query(
      `SELECT appointment_status, slot_intent_id FROM appointments WHERE id = $1`,
      [appointment.id]
    );
    expect(apptAfter.rows[0].appointment_status).toBe('cancelled_by_doctor');
    expect(apptAfter.rows[0].slot_intent_id).toBeNull();

    const slotAfter = await pool.query(
      `SELECT state, status FROM available_time_slots WHERE id = $1`,
      [slot.id]
    );
    expect(slotAfter.rows[0].state).toBe('free');
    expect(slotAfter.rows[0].status).toBe('available');

    const intentAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intent.id,
    ]);
    expect(intentAfter.rows[0].state).toBe('expired');
  });

  it('duplikált fáziskódnál a testvér-fázis foglalását nem bántja', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    // Két azonos kódú fázis (pl. két állcsont) — az egyik completed, a másik
    // scheduled saját jövőbeli foglalással.
    const reopened = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'completed',
      completedAt: new Date(),
    });
    const sibling = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 1,
      status: 'scheduled',
    });

    const slotA = await createTestSlot(undefined, user.id, { state: 'booked', status: 'booked' });
    const apptA = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slotA.id,
      episodeId: episode.id,
      workPhaseId: reopened.id,
      stepCode: 'lenyomat',
      stepSeq: 0,
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
    });

    const slotB = await createTestSlot(undefined, user.id, { state: 'booked', status: 'booked' });
    const siblingIntent = await createTestSlotIntent(undefined, episode.id, {
      stepCode: 'lenyomat',
      stepSeq: 1,
      state: 'converted',
      workPhaseId: sibling.id,
    });
    const apptB = await createTestAppointment(undefined, {
      patientId: patient.id,
      timeSlotId: slotB.id,
      episodeId: episode.id,
      workPhaseId: sibling.id,
      slotIntentId: siblingIntent.id,
      stepCode: 'lenyomat',
      stepSeq: 1,
      startTime: new Date(Date.now() + 14 * MS_PER_DAY),
    });

    const req = await authedRequest(
      `http://test.local/api/episodes/${episode.id}/work-phases/${reopened.id}`,
      {
        user,
        method: 'PATCH',
        body: { status: 'pending', reason: 'mégsem készült el a fázis' },
      }
    );
    const res = await workPhasePatch(req, {
      params: { id: episode.id, workPhaseId: reopened.id },
    });
    expect(res.status).toBe(200);

    // A visszanyitott fázis foglalása lemondva…
    const apptAAfter = await pool.query(
      `SELECT appointment_status FROM appointments WHERE id = $1`,
      [apptA.id]
    );
    expect(apptAAfter.rows[0].appointment_status).toBe('cancelled_by_doctor');

    // …a testvér foglalása és intentje érintetlen.
    const apptBAfter = await pool.query(
      `SELECT appointment_status, slot_intent_id FROM appointments WHERE id = $1`,
      [apptB.id]
    );
    expect(apptBAfter.rows[0].appointment_status).toBeNull();
    expect(apptBAfter.rows[0].slot_intent_id).toBe(siblingIntent.id);
    const siblingIntentAfter = await pool.query(
      `SELECT state FROM slot_intents WHERE id = $1`,
      [siblingIntent.id]
    );
    expect(siblingIntentAfter.rows[0].state).toBe('converted');
    const slotBAfter = await pool.query(
      `SELECT state FROM available_time_slots WHERE id = $1`,
      [slotB.id]
    );
    expect(slotBAfter.rows[0].state).toBe('booked');
  });
});

describe('WP-0.8 kiegészítés (b) — betegportál-lemondás intent-takarítása', () => {
  it('a beteg lemondásakor a converted intent lejár és a link elenged', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'scheduled',
    });
    const slot = await createTestSlot(undefined, user.id, {
      state: 'booked',
      status: 'booked',
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
    });
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

    portalCookie.value = await portalSessionToken(patient.id);
    const req = new NextRequest(
      `http://test.local/api/patient-portal/appointments/${appointment.id}`,
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancellationReason: 'nem tudok elmenni' }),
      }
    );
    const res = await portalCancelDelete(req, { params: { id: appointment.id } });
    expect(res.status).toBe(200);

    const apptAfter = await pool.query(
      `SELECT appointment_status, slot_intent_id FROM appointments WHERE id = $1`,
      [appointment.id]
    );
    expect(apptAfter.rows[0].appointment_status).toBe('cancelled_by_patient');
    expect(apptAfter.rows[0].slot_intent_id).toBeNull();

    const intentAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intent.id,
    ]);
    expect(intentAfter.rows[0].state).toBe('expired');

    const slotAfter = await pool.query(
      `SELECT state, status FROM available_time_slots WHERE id = $1`,
      [slot.id]
    );
    expect(slotAfter.rows[0].state).toBe('free');
    expect(slotAfter.rows[0].status).toBe('available');
  });
});

describe('WP-0.8 kiegészítés (c) — hold-lejárat intent-takarítása', () => {
  it('a hold_expired lemondáskor a converted intent lejár és a link elenged', async () => {
    const pool = getDbPool();
    const user = await authUser();
    const patient = await createTestPatient();
    const episode = await createTestEpisode(undefined, patient.id);

    const ewp = await createTestWorkPhase(undefined, episode.id, {
      workPhaseCode: 'lenyomat',
      seq: 0,
      status: 'scheduled',
    });
    const slot = await createTestSlot(undefined, user.id, {
      state: 'booked',
      status: 'booked',
      startTime: new Date(Date.now() + 7 * MS_PER_DAY),
    });
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
    // Lejárt, meg nem erősített hold.
    await pool.query(
      `UPDATE appointments SET hold_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = $1`,
      [appointment.id]
    );

    const result = await runHoldExpiry();
    expect(result.errors).toEqual([]);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const apptAfter = await pool.query(
      `SELECT appointment_status, completion_notes, slot_intent_id FROM appointments WHERE id = $1`,
      [appointment.id]
    );
    expect(apptAfter.rows[0].appointment_status).toBe('cancelled_by_doctor');
    expect(apptAfter.rows[0].completion_notes).toBe('hold_expired');
    expect(apptAfter.rows[0].slot_intent_id).toBeNull();

    const intentAfter = await pool.query(`SELECT state FROM slot_intents WHERE id = $1`, [
      intent.id,
    ]);
    expect(intentAfter.rows[0].state).toBe('expired');

    const slotAfter = await pool.query(
      `SELECT state, status FROM available_time_slots WHERE id = $1`,
      [slot.id]
    );
    expect(slotAfter.rows[0].state).toBe('free');
    expect(slotAfter.rows[0].status).toBe('available');
  });
});
