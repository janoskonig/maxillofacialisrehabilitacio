import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { sendConditionalAppointmentRequestToPatient, sendConditionalAppointmentNotificationToAdmin } from '@/lib/email';
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';

/**
 * Create a pending appointment (admin only)
 * This creates an appointment that requires patient approval via email
 */
export const dynamic = 'force-dynamic';

export const POST = roleHandler(['admin'], async (req, { auth }) => {
  const body = await req.json();
  const { patientId, timeSlotId, alternativeTimeSlotIds, appointmentType } = body;

  if (!patientId || !timeSlotId) {
    return NextResponse.json(
      { error: 'Beteg ID és időpont ID megadása kötelező' },
      { status: 400 }
    );
  }

  const alternativeIds = Array.isArray(alternativeTimeSlotIds) 
    ? alternativeTimeSlotIds.filter((id: string) => id && id.trim() !== '')
    : [];

  const pool = getDbPool();

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

  const startTime = new Date(timeSlot.start_time);
  if (startTime <= new Date()) {
    return NextResponse.json(
      { error: 'Csak jövőbeli időpontot lehet lefoglalni' },
      { status: 400 }
    );
  }

  if (alternativeIds.length > 0) {
    const alternativeSlotsResult = await pool.query(
      `SELECT ats.id, ats.status, ats.start_time
       FROM available_time_slots ats
       WHERE ats.id = ANY($1::uuid[])`,
      [alternativeIds]
    );

    if (alternativeSlotsResult.rows.length !== alternativeIds.length) {
      return NextResponse.json(
        { error: 'Egy vagy több alternatív időpont nem található' },
        { status: 400 }
      );
    }

    const unavailableAlternatives = alternativeSlotsResult.rows.filter(
      (slot: { status: string; start_time: Date }) => slot.status !== 'available'
    );
    if (unavailableAlternatives.length > 0) {
      return NextResponse.json(
        { error: 'Egy vagy több alternatív időpont már le van foglalva' },
        { status: 400 }
      );
    }

    const pastAlternatives = alternativeSlotsResult.rows.filter(
      (slot: { start_time: Date }) => new Date(slot.start_time) <= new Date()
    );
    if (pastAlternatives.length > 0) {
      return NextResponse.json(
        { error: 'Egy vagy több alternatív időpont már elmúlt' },
        { status: 400 }
      );
    }
  }

  const approvalToken = randomBytes(32).toString('hex');

  await pool.query('BEGIN');

  try {
    const alternativeIdsJson = JSON.stringify(alternativeIds);
    const appointmentResult = await pool.query(
      `INSERT INTO appointments (patient_id, time_slot_id, created_by, dentist_email, approval_status, approval_token, alternative_time_slot_ids, current_alternative_index, appointment_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NULL, $8)
       RETURNING 
         id,
         patient_id as "patientId",
         time_slot_id as "timeSlotId",
         created_by as "createdBy",
         dentist_email as "dentistEmail",
         approval_status as "approvalStatus",
         approval_token as "approvalToken",
         alternative_time_slot_ids as "alternativeTimeSlotIds",
         current_alternative_index as "currentAlternativeIndex",
         appointment_type as "appointmentType",
         created_at as "createdAt"`,
      [patientId, timeSlotId, auth.email, timeSlot.dentist_email, 'pending', approvalToken, alternativeIdsJson, appointmentType || null]
    );

    const appointment = appointmentResult.rows[0];

    await pool.query(
      'UPDATE available_time_slots SET status = $1 WHERE id = $2',
      ['booked', timeSlotId]
    );

    await pool.query('COMMIT');

    const adminResult = await pool.query(
      'SELECT email FROM users WHERE role = $1 AND active = true',
      ['admin']
    );
    const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);

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

    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
        (req.headers.get('origin') || 'http://localhost:3000');
      
      const dentistFullName = timeSlot.doktor_neve || timeSlot.dentist_email;

      await Promise.all([
        sendConditionalAppointmentRequestToPatient(
          patient.email,
          patient.nev,
          patient.nem,
          startTime,
          dentistFullName,
          approvalToken,
          baseUrl,
          alternativeSlots,
          timeSlot.cim,
          timeSlot.teremszam,
          false
        ),
        adminEmails.length > 0 ? sendConditionalAppointmentNotificationToAdmin(
          adminEmails,
          patient.nev,
          patient.taj,
          patient.email,
          startTime,
          dentistFullName,
          timeSlot.cim,
          timeSlot.teremszam,
          alternativeSlots,
          auth.email
        ) : Promise.resolve(),
      ]);
    } catch (emailError) {
      logger.error('Failed to send conditional appointment request emails:', emailError);
    }

    return NextResponse.json({ 
      appointment,
      message: 'Feltételes időpont sikeresen létrehozva. A páciens emailben értesítést kapott.' 
    }, { status: 201 });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
});
