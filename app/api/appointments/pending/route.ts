import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { sendConditionalAppointmentRequestToPatient } from '@/lib/email';
import { handleApiError } from '@/lib/api-error-handler';
import { randomBytes } from 'crypto';

/**
 * Create a pending appointment (admin only)
 * This creates an appointment that requires patient approval via email
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Only admins can create pending appointments
    if (auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak admin jogosultsággal hozható létre feltételes időpont' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { patientId, timeSlotId } = body;

    if (!patientId || !timeSlotId) {
      return NextResponse.json(
        { error: 'Beteg ID és időpont ID megadása kötelező' },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // Check if patient exists and has email
    const patientResult = await pool.query(
      'SELECT id, nev, taj, email, nem FROM patients WHERE id = $1',
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
        { error: 'A betegnek email címe szükséges a feltételes időpontválasztáshoz' },
        { status: 400 }
      );
    }

    // Check if time slot exists and is available
    const timeSlotResult = await pool.query(
      `SELECT ats.*, u.email as dentist_email, u.id as dentist_user_id, u.doktor_neve
       FROM available_time_slots ats
       JOIN users u ON ats.user_id = u.id
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
        { error: 'Ez az időpont már le van foglalva' },
        { status: 400 }
      );
    }

    // Check if time slot is in the future
    const startTime = new Date(timeSlot.start_time);
    if (startTime <= new Date()) {
      return NextResponse.json(
        { error: 'Csak jövőbeli időpontot lehet lefoglalni' },
        { status: 400 }
      );
    }

    // Generate secure approval token
    const approvalToken = randomBytes(32).toString('hex');

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Create pending appointment
      const appointmentResult = await pool.query(
        `INSERT INTO appointments (patient_id, time_slot_id, created_by, dentist_email, approval_status, approval_token)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING 
           id,
           patient_id as "patientId",
           time_slot_id as "timeSlotId",
           created_by as "createdBy",
           dentist_email as "dentistEmail",
           approval_status as "approvalStatus",
           approval_token as "approvalToken",
           created_at as "createdAt"`,
        [patientId, timeSlotId, auth.email, timeSlot.dentist_email, 'pending', approvalToken]
      );

      const appointment = appointmentResult.rows[0];

      // Mark time slot as booked (but it's pending approval)
      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['booked', timeSlotId]
      );

      await pool.query('COMMIT');

      // Send email to patient
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
          (request.headers.get('origin') || 'http://localhost:3000');
        
        const dentistFullName = timeSlot.doktor_neve || timeSlot.dentist_email;

        await sendConditionalAppointmentRequestToPatient(
          patient.email,
          patient.nev,
          patient.nem,
          startTime,
          dentistFullName,
          approvalToken,
          baseUrl
        );
      } catch (emailError) {
        console.error('Failed to send conditional appointment request email:', emailError);
        // Don't fail the request if email fails, but log it
      }

      return NextResponse.json({ 
        appointment,
        message: 'Feltételes időpont sikeresen létrehozva. A páciens emailben értesítést kapott.' 
      }, { status: 201 });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Hiba történt a feltételes időpont létrehozásakor');
  }
}

