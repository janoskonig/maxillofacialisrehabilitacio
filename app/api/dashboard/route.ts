import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

// Get dashboard data for current user - only next 3 appointments today and pending appointments
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

    const role = auth.role;
    const userEmail = auth.email;

    // Build role-based WHERE clauses for appointments
    let appointmentWhereClause = '';
    const appointmentParams: unknown[] = [];
    let appointmentParamIndex = 1;

    if (role === 'sebészorvos') {
      appointmentWhereClause = `WHERE p.created_by = $${appointmentParamIndex}`;
      appointmentParams.push(userEmail);
      appointmentParamIndex++;
    } else if (role === 'fogpótlástanász') {
      appointmentWhereClause = `WHERE a.dentist_email = $${appointmentParamIndex}`;
      appointmentParams.push(userEmail);
      appointmentParamIndex++;
    }
    // Admin sees all (no WHERE clause)

    // 1. NEXT 3 APPOINTMENTS TODAY (upcoming, not past)
    const nextAppointmentsQuery = `
      SELECT 
        a.id,
        a.patient_id as "patientId",
        ats.start_time as "startTime",
        p.nev as "patientName",
        p.taj as "patientTaj",
        ats.cim,
        ats.teremszam,
        a.appointment_status as "appointmentStatus"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      ${appointmentWhereClause}
      ${appointmentWhereClause ? 'AND' : 'WHERE'} ats.start_time >= $${appointmentParamIndex}
      AND ats.start_time <= $${appointmentParamIndex + 1}
      AND ats.start_time >= NOW()
      AND (a.appointment_status IS NULL OR a.appointment_status != 'cancelled_by_doctor' AND a.appointment_status != 'cancelled_by_patient')
      ORDER BY ats.start_time ASC
      LIMIT 3
    `;
    const nextAppointmentsParams = [...appointmentParams, todayStart.toISOString(), todayEnd.toISOString()];
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
        a.created_by as "createdBy"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      ${appointmentWhereClause}
      ${appointmentWhereClause ? 'AND' : 'WHERE'} a.approval_status = 'pending'
      AND ats.start_time >= NOW()
      ORDER BY ats.start_time ASC
    `;
    const pendingAppointmentsResult = await pool.query(pendingAppointmentsQuery, appointmentParams);

    return NextResponse.json({
      nextAppointments: nextAppointmentsResult.rows,
      pendingAppointments: pendingAppointmentsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json(
      { error: 'Hiba történt a dashboard adatok lekérdezésekor' },
      { status: 500 }
    );
  }
}

