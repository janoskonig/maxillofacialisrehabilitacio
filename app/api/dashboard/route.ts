import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = authedHandler(async (req, { auth }) => {
  const pool = getDbPool();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const [nextAppointmentsResult, pendingAppointmentsResult, newRegistrationsResult] = await Promise.all([
    pool.query(
      `SELECT 
        a.id,
        a.patient_id as "patientId",
        ats.start_time as "startTime",
        p.nev as "patientName",
        p.taj as "patientTaj",
        ats.cim,
        ats.teremszam,
        a.appointment_status as "appointmentStatus",
        a.completion_notes as "completionNotes",
        a.is_late as "isLate",
        a.dentist_email as "dentistEmail",
        u.doktor_neve as "dentistName"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      WHERE ats.start_time >= $1
      AND ats.start_time <= $2
      AND (a.appointment_status IS NULL OR a.appointment_status != 'cancelled_by_doctor' AND a.appointment_status != 'cancelled_by_patient')
      ORDER BY ats.start_time ASC`,
      [todayStart.toISOString(), todayEnd.toISOString()]
    ),
    pool.query(
      `SELECT 
        a.id,
        a.patient_id as "patientId",
        ats.start_time as "startTime",
        p.nev as "patientName",
        p.taj as "patientTaj",
        ats.cim,
        ats.teremszam,
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        u.doktor_neve as "dentistName"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.dentist_email = u.email
      WHERE a.approval_status = 'pending'
      AND ats.start_time >= NOW()
      ORDER BY ats.start_time ASC`
    ),
    pool.query(
      `SELECT 
        p.id,
        p.nev,
        p.taj,
        p.email,
        p.telefonszam,
        p.szuletesi_datum,
        p.nem,
        p.cim,
        p.varos,
        p.iranyitoszam,
        r.beutalo_orvos,
        r.beutalo_indokolas,
        p.created_at,
        p.created_by
      FROM patients p
      LEFT JOIN patient_referral r ON r.patient_id = p.id
      WHERE (p.kezeleoorvos IS NULL OR p.kezeleoorvos = '')
      AND p.created_by IS NULL
      ORDER BY p.created_at ASC`
    ),
  ]);

  return NextResponse.json({
    nextAppointments: nextAppointmentsResult.rows,
    pendingAppointments: pendingAppointmentsResult.rows,
    newRegistrations: newRegistrationsResult.rows,
  });
});
