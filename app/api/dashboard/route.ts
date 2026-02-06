import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Get dashboard data for current user - all appointments today and pending appointments
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // No role-based filtering - everyone sees all appointments on dashboard

    // 1. ALL APPOINTMENTS TODAY (show all appointments from today until midnight)
    const nextAppointmentsQuery = `
      SELECT 
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
      ORDER BY ats.start_time ASC
    `;
    const nextAppointmentsParams = [todayStart.toISOString(), todayEnd.toISOString()];
    const nextAppointmentsResult = await pool.query(nextAppointmentsQuery, nextAppointmentsParams);

    // 2. PENDING APPOINTMENTS (approval_status = 'pending' and not past)
    const pendingAppointmentsQuery = `
      SELECT 
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
      ORDER BY ats.start_time ASC
    `;
    const pendingAppointmentsResult = await pool.query(pendingAppointmentsQuery, []);

    // 3. NEW REGISTRATIONS (patients without kezeleoorvos who registered themselves)
    // These are patients where created_by IS NULL (self-registered via patient portal)
    // and kezeleoorvos IS NULL or empty
    const newRegistrationsQuery = `
      SELECT 
        id,
        nev,
        taj,
        email,
        telefonszam,
        szuletesi_datum,
        nem,
        cim,
        varos,
        iranyitoszam,
        beutalo_orvos,
        beutalo_indokolas,
        created_at,
        created_by
      FROM patients
      WHERE (kezeleoorvos IS NULL OR kezeleoorvos = '')
      AND created_by IS NULL
      ORDER BY created_at ASC
    `;
    const newRegistrationsResult = await pool.query(newRegistrationsQuery);

    return NextResponse.json({
      nextAppointments: nextAppointmentsResult.rows,
      pendingAppointments: pendingAppointmentsResult.rows,
      newRegistrations: newRegistrationsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json(
      { error: 'Hiba történt a dashboard adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

