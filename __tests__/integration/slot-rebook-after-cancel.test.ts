/**
 * Lemondott időpont újrafoglalása — viselkedési integrációs tesztek (valódi DB).
 *
 * Az `appointments.time_slot_id` UNIQUE: a soft-cancel (cancelled_by_doctor)
 * után a halott sor a sloton marad, a slot mégis `free`. A sima INSERT/UPDATE
 * útvonalak eddig SLOT_ALREADY_BOOKED-dal (vagy 23505-tel) elhasaltak rajta:
 *   (a) feltételes ajánlat (POST /pending) a felszabadult slotra,
 *   (b) lemondás + új ajánlat, ahol az ÚJ slot hordoz halott sort,
 *   (c) áthelyezés (PUT timeSlotId) halott sort hordozó slotra,
 *   (d) elutasítás → alternatívára lépés, ahol az alternatíva hordoz halott sort.
 * Mind a négy most eltakarítja a halott sort (purgeCancelledAppointmentsOnSlot).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getDbPool } from '@/lib/db';
import { POST as cancelAndOffer } from '@/app/api/appointments/[id]/cancel-and-offer/route';
import { POST as createPending } from '@/app/api/appointments/pending/route';
import { PUT as modifyAppointment } from '@/app/api/appointments/[id]/route';
import { GET as rejectOffer } from '@/app/api/appointments/reject/route';
import {
  cleanupCreated,
  createTestAppointment,
  createTestPatient,
  createTestSlot,
  createTestUser,
} from './helpers/factories';
import { authedRequest, type TestAuthUser } from './helpers/auth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const createdPatientIds: string[] = [];

afterEach(async () => {
  const pool = getDbPool();
  if (createdPatientIds.length > 0) {
    await pool.query(
      `DELETE FROM appointment_status_events WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_id = ANY($1::uuid[]))`,
      [createdPatientIds]
    );
    await pool.query(`DELETE FROM appointments WHERE patient_id = ANY($1::uuid[])`, [createdPatientIds]);
    createdPatientIds.length = 0;
  }
  await cleanupCreated();
});

async function adminUser(): Promise<TestAuthUser> {
  const u = await createTestUser(undefined, { role: 'admin' });
  return { id: u.id, email: u.email, role: 'admin' };
}

/** Szabad slot, amelyen egy LEMONDOTT (halott) foglalás-sor ül. */
async function freeSlotWithDeadRow(user: TestAuthUser, patientId: string, days: number) {
  const slot = await createTestSlot(undefined, user.id, {
    startTime: new Date(Date.now() + days * MS_PER_DAY),
    state: 'free',
    status: 'available',
  });
  const dead = await createTestAppointment(undefined, {
    patientId,
    timeSlotId: slot.id,
    appointmentStatus: 'cancelled_by_doctor',
    startTime: new Date(Date.now() + days * MS_PER_DAY),
  });
  return { slot, dead };
}

describe('lemondott időpont újrafoglalása', () => {
  it('(a) feltételes ajánlat a felszabadult slotra: a halott sor eltűnik, az ajánlat létrejön', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const patient = await createTestPatient();
    createdPatientIds.push(patient.id);
    const otherPatient = await createTestPatient();
    createdPatientIds.push(otherPatient.id);
    const { slot, dead } = await freeSlotWithDeadRow(user, otherPatient.id, 5);

    const res = await createPending(
      await authedRequest('http://test.local/api/appointments/pending', {
        user,
        method: 'POST',
        body: { patientId: patient.id, timeSlotId: slot.id },
      }),
      { params: {} }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.appointment.timeSlotId).toBe(slot.id);
    expect((await pool.query(`SELECT 1 FROM appointments WHERE id = $1`, [dead.id])).rows).toHaveLength(0);
    const rows = await pool.query(`SELECT id, approval_status FROM appointments WHERE time_slot_id = $1`, [slot.id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].approval_status).toBe('pending');
  });

  it('(b) lemondás + új ajánlat: az új slot halott sora nem blokkol', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const patient = await createTestPatient();
    createdPatientIds.push(patient.id);
    const bookedSlot = await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 3 * MS_PER_DAY), state: 'booked', status: 'booked' });
    const booked = await createTestAppointment(undefined, { patientId: patient.id, timeSlotId: bookedSlot.id, startTime: new Date(Date.now() + 3 * MS_PER_DAY) });
    const { slot: newSlot, dead } = await freeSlotWithDeadRow(user, patient.id, 6);

    const res = await cancelAndOffer(
      await authedRequest(`http://test.local/api/appointments/${booked.id}/cancel-and-offer`, {
        user,
        method: 'POST',
        body: { timeSlotId: newSlot.id },
      }),
      { params: { id: booked.id } }
    );
    expect(res.status).toBe(201);
    expect((await pool.query(`SELECT 1 FROM appointments WHERE id = $1`, [dead.id])).rows).toHaveLength(0);
    const onNewSlot = await pool.query(`SELECT id, approval_status, appointment_status FROM appointments WHERE time_slot_id = $1`, [newSlot.id]);
    expect(onNewSlot.rows).toHaveLength(1);
    expect(onNewSlot.rows[0]).toMatchObject({ approval_status: 'pending', appointment_status: null });
    const old = await pool.query(`SELECT appointment_status FROM appointments WHERE id = $1`, [booked.id]);
    expect(old.rows[0].appointment_status).toBe('cancelled_by_doctor');
  });

  it('(c) áthelyezés meglévő slotra, amelyen halott sor ül', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const patient = await createTestPatient();
    createdPatientIds.push(patient.id);
    const bookedSlot = await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 3 * MS_PER_DAY), state: 'booked', status: 'booked' });
    const booked = await createTestAppointment(undefined, { patientId: patient.id, timeSlotId: bookedSlot.id, startTime: new Date(Date.now() + 3 * MS_PER_DAY) });
    const { slot: target, dead } = await freeSlotWithDeadRow(user, patient.id, 8);

    const res = await modifyAppointment(
      await authedRequest(`http://test.local/api/appointments/${booked.id}`, {
        user,
        method: 'PUT',
        body: { timeSlotId: target.id },
      }),
      { params: { id: booked.id } }
    );
    expect(res.status).toBe(200);
    expect((await pool.query(`SELECT 1 FROM appointments WHERE id = $1`, [dead.id])).rows).toHaveLength(0);
    const moved = await pool.query(`SELECT time_slot_id FROM appointments WHERE id = $1`, [booked.id]);
    expect(moved.rows[0].time_slot_id).toBe(target.id);
    const slots = await pool.query(`SELECT id, state, status FROM available_time_slots WHERE id = ANY($1::uuid[])`, [[bookedSlot.id, target.id]]);
    expect(slots.rows.find((r) => r.id === bookedSlot.id)).toMatchObject({ state: 'free', status: 'available' });
    expect(slots.rows.find((r) => r.id === target.id)).toMatchObject({ state: 'booked', status: 'booked' });
  });

  it('(d) elutasítás → alternatívára lépés, ahol az alternatíva halott sort hordoz', async () => {
    const pool = getDbPool();
    const user = await adminUser();
    const patient = await createTestPatient();
    createdPatientIds.push(patient.id);
    const bookedSlot = await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 3 * MS_PER_DAY), state: 'booked', status: 'booked' });
    const booked = await createTestAppointment(undefined, { patientId: patient.id, timeSlotId: bookedSlot.id, startTime: new Date(Date.now() + 3 * MS_PER_DAY) });
    const primary = await createTestSlot(undefined, user.id, { startTime: new Date(Date.now() + 6 * MS_PER_DAY) });
    const { slot: alt, dead } = await freeSlotWithDeadRow(user, patient.id, 9);

    const res = await cancelAndOffer(
      await authedRequest(`http://test.local/api/appointments/${booked.id}/cancel-and-offer`, {
        user,
        method: 'POST',
        body: { timeSlotId: primary.id, alternativeTimeSlotIds: [alt.id] },
      }),
      { params: { id: booked.id } }
    );
    expect(res.status).toBe(201);
    const offerId: string = (await res.json()).offer.id;
    const token: string = (await pool.query(`SELECT approval_token FROM appointments WHERE id = $1`, [offerId])).rows[0].approval_token;

    const rejectRes = await rejectOffer(new NextRequest(`http://test.local/api/appointments/reject?token=${token}`), { params: {} });
    expect(rejectRes.status).toBe(200);
    expect(await rejectRes.text()).toContain('Alternatív időpont');
    expect((await pool.query(`SELECT 1 FROM appointments WHERE id = $1`, [dead.id])).rows).toHaveLength(0);
    const offer = await pool.query(`SELECT time_slot_id, approval_status FROM appointments WHERE id = $1`, [offerId]);
    expect(offer.rows[0]).toEqual({ time_slot_id: alt.id, approval_status: 'pending' });
  });
});
