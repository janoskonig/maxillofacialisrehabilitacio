import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { sendAppointmentBookingNotification } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';

// Get all appointments
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

    // Everyone sees all appointments
    const query = `
      SELECT 
        a.id,
        a.patient_id as "patientId",
        a.time_slot_id as "timeSlotId",
        a.created_by as "createdBy",
        a.dentist_email as "dentistEmail",
        a.created_at as "createdAt",
        ats.start_time as "startTime",
        ats.status,
        p.nev as "patientName",
        p.taj as "patientTaj"
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      ORDER BY ats.start_time ASC
    `;
    const params: any[] = [];

    const result = await pool.query(query, params);
    return NextResponse.json({ appointments: result.rows });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return NextResponse.json(
      { error: 'Hiba történt a foglalások lekérdezésekor' },
      { status: 500 }
    );
  }
}

// Book an appointment (only sebészorvos)
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    if (auth.role !== 'sebészorvos' && auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Csak sebészorvos vagy admin foglalhat időpontot' },
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

    // Check if patient exists and was created by this surgeon
    const patientResult = await pool.query(
      'SELECT id, nev, taj, created_by FROM patients WHERE id = $1',
      [patientId]
    );

    if (patientResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patient = patientResult.rows[0];

    // For surgeons: verify that the patient was created by this surgeon (only for editing, not for booking)
    // For admins: can book for any patient
    // Note: Surgeons can book appointments for any patient, but can only edit their own patients

    // Check if time slot exists and is available
    const timeSlotResult = await pool.query(
      `SELECT ats.*, u.email as dentist_email
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

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Create appointment
      // created_by: surgeon/admin who booked the appointment
      // dentist_email: dentist who created the time slot
      const appointmentResult = await pool.query(
        `INSERT INTO appointments (patient_id, time_slot_id, created_by, dentist_email)
         VALUES ($1, $2, $3, $4)
         RETURNING 
           id,
           patient_id as "patientId",
           time_slot_id as "timeSlotId",
           created_by as "createdBy",
           dentist_email as "dentistEmail",
           created_at as "createdAt"`,
        [patientId, timeSlotId, auth.email, timeSlot.dentist_email]
      );

      // Update time slot status to booked
      await pool.query(
        'UPDATE available_time_slots SET status = $1 WHERE id = $2',
        ['booked', timeSlotId]
      );

      await pool.query('COMMIT');

      const appointment = appointmentResult.rows[0];

      // Send email notification to dentist
      try {
        const icsFile = await generateIcsFile({
          patientName: patient.nev,
          patientTaj: patient.taj,
          startTime: startTime,
          surgeonName: auth.email,
          dentistName: timeSlot.dentist_email,
        });

        await sendAppointmentBookingNotification(
          timeSlot.dentist_email,
          patient.nev,
          patient.taj,
          startTime,
          auth.email,
          icsFile
        );
      } catch (emailError) {
        console.error('Failed to send appointment booking notification:', emailError);
        // Don't fail the request if email fails
      }

      return NextResponse.json({ appointment }, { status: 201 });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error booking appointment:', error);
    return NextResponse.json(
      { error: 'Hiba történt az időpont foglalásakor' },
      { status: 500 }
    );
  }
}
