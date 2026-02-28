import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyPatientPortalSession } from '@/lib/patient-portal-server';
import { sendAppointmentBookingNotification, sendAppointmentBookingNotificationToPatient, sendAppointmentBookingNotificationToAdmins } from '@/lib/email';
import { generateIcsFile } from '@/lib/calendar';
import { createGoogleCalendarEvent } from '@/lib/google-calendar';
import { apiHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (req, { correlationId, params }) => {
  const patientId = await verifyPatientPortalSession(req);

  if (!patientId) {
    return NextResponse.json(
      { error: 'Bejelentkezés szükséges' },
      { status: 401 }
    );
  }

  const pool = getDbPool();

  const appointmentResult = await pool.query(
    `SELECT a.*, p.nev as patient_name, p.taj as patient_taj, p.email as patient_email, p.nem as patient_nem,
            ats.start_time, ats.cim, ats.teremszam, ats.user_id as dentist_user_id,
            u.doktor_neve as dentist_name, u.email as dentist_email
     FROM appointments a
     JOIN patients p ON a.patient_id = p.id
     JOIN available_time_slots ats ON a.time_slot_id = ats.id
     JOIN users u ON a.dentist_email = u.email
     WHERE a.id = $1 AND a.patient_id = $2 AND a.approval_status = 'pending'`,
    [params.id, patientId]
  );

  if (appointmentResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Időpont nem található, vagy már nem vár jóváhagyásra' },
      { status: 404 }
    );
  }

  const appointment = appointmentResult.rows[0];

  const startTime = new Date(appointment.start_time);
  if (startTime <= new Date()) {
    return NextResponse.json(
      { error: 'Ez az időpont már elmúlt' },
      { status: 400 }
    );
  }

  await pool.query('BEGIN');

  try {
    await pool.query(
      'UPDATE appointments SET approval_status = $1, approved_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['approved', appointment.id]
    );

    const alternativeIdsRaw = appointment.alternative_time_slot_ids;
    const alternativeIds = Array.isArray(alternativeIdsRaw) 
      ? alternativeIdsRaw 
      : (alternativeIdsRaw ? [alternativeIdsRaw] : []);

    if (alternativeIds.length > 0) {
      const validIds = alternativeIds.filter((id: any) => id && typeof id === 'string');
      if (validIds.length > 0) {
        await pool.query(
          'UPDATE available_time_slots SET status = $1 WHERE id = ANY($2::uuid[])',
          ['available', validIds]
        );
      }
    }

    await pool.query('COMMIT');

    const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';
    const appointmentCim = appointment.cim || DEFAULT_CIM;
    const appointmentTeremszam = appointment.teremszam || null;

    const updatedStartTime = new Date(appointment.start_time);
    const endTime = new Date(updatedStartTime);
    endTime.setMinutes(endTime.getMinutes() + 30);

    const [adminResult] = await Promise.all([
      pool.query('SELECT email FROM users WHERE role = $1 AND active = true', ['admin']),
    ]);

    const adminEmails = adminResult.rows.map((row: { email: string }) => row.email);
    const adminEmail = adminEmails.length > 0 ? adminEmails[0] : '';
    const dentistFullName = appointment.dentist_name || appointment.dentist_email;

    const icsFileData = {
      patientName: appointment.patient_name,
      patientTaj: appointment.patient_taj,
      startTime: updatedStartTime,
      surgeonName: appointment.created_by,
      dentistName: appointment.dentist_email,
    };
    const icsFile = await generateIcsFile(icsFileData);

    try {
      await Promise.all([
        sendAppointmentBookingNotification(
          appointment.dentist_email,
          appointment.patient_name,
          appointment.patient_taj,
          updatedStartTime,
          appointment.created_by,
          icsFile,
          appointmentCim,
          appointmentTeremszam
        ),
        (async () => {
          try {
            const userCalendarResult = await pool.query(
              `SELECT google_calendar_enabled, google_calendar_target_calendar_id 
               FROM users 
               WHERE id = $1`,
              [appointment.dentist_user_id]
            );
            if (userCalendarResult.rows[0]?.google_calendar_enabled !== true) {
              logger.info('[Appointment Approval] Slot owner has Google Calendar disabled, skipping sync');
              return;
            }
            const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';

            const newEventId = await createGoogleCalendarEvent(
              appointment.dentist_user_id,
              {
                summary: `Betegfogadás - ${appointment.patient_name || 'Név nélküli beteg'}`,
                description: `Beteg: ${appointment.patient_name || 'Név nélküli'}\nTAJ: ${appointment.patient_taj || 'Nincs megadva'}\nBeutaló orvos: ${appointment.created_by}`,
                startTime: updatedStartTime,
                endTime: endTime,
                location: 'Maxillofaciális Rehabilitáció',
                calendarId: targetCalendarId,
              }
            );

            if (newEventId) {
              await pool.query(
                'UPDATE appointments SET google_calendar_event_id = $1 WHERE id = $2',
                [newEventId, appointment.id]
              );
            }
          } catch (error) {
            logger.error('[Appointment Approval] Failed to create Google Calendar event:', error);
          }
        })(),
      ]);

      if (appointment.patient_email && appointment.patient_email.trim() !== '') {
        await sendAppointmentBookingNotificationToPatient(
          appointment.patient_email,
          appointment.patient_name,
          appointment.patient_nem,
          updatedStartTime,
          dentistFullName,
          appointment.dentist_email,
          icsFile,
          appointmentCim,
          appointmentTeremszam,
          adminEmail
        );
      }

      if (adminEmails.length > 0) {
        await sendAppointmentBookingNotificationToAdmins(
          adminEmails,
          appointment.patient_name,
          appointment.patient_taj,
          updatedStartTime,
          appointment.created_by,
          appointment.dentist_email,
          icsFile,
          appointmentCim,
          appointmentTeremszam
        );
      }
    } catch (emailError) {
      logger.error('Failed to send appointment approval notifications:', emailError);
    }

    return NextResponse.json({
      success: true,
      message: 'Időpont sikeresen elfogadva!',
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
});
