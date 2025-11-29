import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';

/**
 * Get patient's appointments
 * GET /api/patient-portal/appointments
 */
export async function GET(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();

    const result = await pool.query(
      `SELECT 
        a.id,
        a.patient_id as "patientId",
        a.time_slot_id as "timeSlotId",
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        a.created_at as "createdAt",
        a.appointment_status as "appointmentStatus",
        a.approval_status as "approvalStatus",
        ats.start_time as "startTime",
        ats.cim,
        ats.teremszam,
        u.doktor_neve as "dentistName"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      LEFT JOIN users u ON a.dentist_email = u.email
      WHERE a.patient_id = $1
      ORDER BY ats.start_time DESC`,
      [patientId]
    );

    return NextResponse.json({
      appointments: result.rows,
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpontok lekérdezésekor' },
      { status: 500 }
    );
  }
}

/**
 * Request new appointment
 * POST /api/patient-portal/appointments
 */
export async function POST(request: NextRequest) {
  try {
    const patientId = await verifyPatientPortalSession(request);

    if (!patientId) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { timeSlotId, alternativeTimeSlotIds } = body;

    if (!timeSlotId) {
      return NextResponse.json(
        { error: 'Időpont kiválasztása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Verify patient exists and has email
    const patientResult = await pool.query(
      'SELECT id, email, nev FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];

    if (!patient.email || patient.email.trim() === '') {
      return NextResponse.json(
        { error: 'Email cím szükséges az időpont kéréséhez' },
        { status: 400 }
      );
    }

    // Check if time slot exists and is available
    const timeSlotResult = await pool.query(
      `SELECT ats.*, u.email as dentist_email
       FROM available_time_slots ats
       LEFT JOIN users u ON ats.user_id = u.id
       WHERE ats.id = $1`,
      [timeSlotId]
    );

    if (timeSlotResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Időpont nem található' },
        { status: 404 }
      );
    }

    const timeSlot = timeSlotResult.rows[0];

    if (timeSlot.status !== 'available') {
      return NextResponse.json(
        { error: 'Ez az időpont már nem elérhető' },
        { status: 400 }
      );
    }

    if (new Date(timeSlot.start_time) < new Date()) {
      return NextResponse.json(
        { error: 'Múltbeli időpontot nem lehet lefoglalni' },
        { status: 400 }
      );
    }

    // Validate alternative time slots if provided
    const alternativeIds = Array.isArray(alternativeTimeSlotIds)
      ? alternativeTimeSlotIds.filter((id: string) => id && id.trim() !== '' && id !== timeSlotId)
      : [];

    // Create pending appointment (similar to admin flow)
    const { randomBytes } = await import('crypto');
    const approvalToken = randomBytes(32).toString('hex');

    const alternativeIdsJson = JSON.stringify(alternativeIds);

    const appointmentResult = await pool.query(
      `INSERT INTO appointments (
        patient_id, time_slot_id, created_by, dentist_email, 
        approval_status, approval_token, alternative_time_slot_ids
      )
      VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb)
      RETURNING id, patient_id as "patientId", time_slot_id as "timeSlotId",
                approval_status as "approvalStatus", created_at as "createdAt"`,
      [
        patientId,
        timeSlotId,
        patient.email, // Use patient email as created_by for portal requests
        timeSlot.dentist_email,
        approvalToken,
        alternativeIdsJson,
      ]
    );

    const appointment = appointmentResult.rows[0];

    // Mark time slot as booked
    await pool.query(
      'UPDATE available_time_slots SET status = $1 WHERE id = $2',
      ['booked', timeSlotId]
    );

    // Send notification emails (reuse existing email functions)
    try {
      const { sendConditionalAppointmentRequestToPatient, sendConditionalAppointmentNotificationToAdmin } = await import('@/lib/email');
      
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
        (request.headers.get('origin') || 'http://localhost:3000');
      
      const dentistFullName = timeSlot.dentistName || timeSlot.dentist_email || 'Orvos';
      const startTime = new Date(timeSlot.start_time);

      // Get alternative slots info if any
      let alternativeSlots: Array<{ id: string; startTime: Date; cim: string | null; teremszam: string | null }> = [];
      if (alternativeIds.length > 0) {
        const altSlotsResult = await pool.query(
          `SELECT ats.id, ats.start_time, ats.cim, ats.teremszam
           FROM available_time_slots ats
           WHERE ats.id = ANY($1::uuid[])
           ORDER BY ats.start_time ASC`,
          [alternativeIds]
        );
        alternativeSlots = altSlotsResult.rows.map((row: any) => ({
          id: row.id,
          startTime: new Date(row.start_time),
          cim: row.cim,
          teremszam: row.teremszam,
        }));
      }

      // Get patient gender for proper greeting
      const patientResultForGender = await pool.query(
        'SELECT nem FROM patients WHERE id = $1',
        [patientId]
      );
      const patientNem = patientResultForGender.rows[0]?.nem || null;

      // Send to patient
      await sendConditionalAppointmentRequestToPatient(
        patient.email,
        patient.nev || null,
        patientNem,
        startTime,
        dentistFullName,
        approvalToken,
        baseUrl,
        alternativeSlots,
        timeSlot.cim || null,
        timeSlot.teremszam || null,
        false // Don't show alternatives in first email
      );

      // Send to admins
      const adminResult = await pool.query(
        'SELECT email FROM users WHERE role = $1 AND active = true',
        ['admin']
      );
      const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);

      if (adminEmails.length > 0) {
        await sendConditionalAppointmentNotificationToAdmin(
          adminEmails,
          patient.nev || null,
          patient.taj,
          patient.email,
          startTime,
          dentistFullName,
          timeSlot.cim || null,
          timeSlot.teremszam || null,
          alternativeSlots,
          patient.email // createdBy for portal requests
        );
      }
    } catch (emailError) {
      console.error('Hiba az értesítő emailek küldésekor:', emailError);
      // Don't fail the request if email fails
    }

    return NextResponse.json({
      success: true,
      appointment: appointment,
      message: 'Időpont kérés elküldve. Emailben értesítést kap a jóváhagyásról.',
    });
  } catch (error) {
    console.error('Error requesting appointment:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont kérésekor' },
      { status: 500 }
    );
  }
}

