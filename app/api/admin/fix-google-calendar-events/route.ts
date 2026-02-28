import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from '@/lib/google-calendar';
import { roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const POST = roleHandler(['admin'], async (req, { correlationId, auth }) => {
  const pool = getDbPool();
  const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

  const appointmentsResult = await pool.query(
    `SELECT 
      a.id as appointment_id,
      a.patient_id,
      a.time_slot_id,
      a.created_by,
      a.dentist_email,
      ats.start_time,
      ats.google_calendar_event_id as time_slot_google_calendar_event_id,
      ats.source as time_slot_source,
      ats.user_id as dentist_user_id,
      ats.cim,
      ats.teremszam,
      p.nev as patient_name,
      p.taj as patient_taj,
      u.doktor_neve as dentist_name
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    JOIN patients p ON a.patient_id = p.id
    LEFT JOIN users u ON a.dentist_email = u.email
    WHERE a.google_calendar_event_id IS NULL
      AND ats.source = 'google_calendar'
      AND ats.status = 'booked'
      AND ats.google_calendar_event_id IS NOT NULL
      AND ats.start_time > NOW()
    ORDER BY ats.start_time ASC`
  );

  const appointments = appointmentsResult.rows;
  const results = {
    total: appointments.length,
    fixed: 0,
    errors: [] as Array<{ appointmentId: string; error: string }>,
  };

  logger.info(`[Fix Google Calendar Events] Found ${appointments.length} appointments to fix`);

  for (const appointment of appointments) {
    try {
      const appointmentId = appointment.appointment_id;
      const startTime = new Date(appointment.start_time);
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + 30);

      const timeSlotGoogleCalendarEventId = appointment.time_slot_google_calendar_event_id;
      const dentistUserId = appointment.dentist_user_id;
      const patientName = appointment.patient_name || 'Név nélküli beteg';
      const patientTaj = appointment.patient_taj || 'Nincs megadva';
      const createdBy = appointment.created_by || 'Ismeretlen';

      const userCalendarResult = await pool.query(
        `SELECT google_calendar_source_calendar_id, google_calendar_target_calendar_id 
         FROM users 
         WHERE id = $1`,
        [dentistUserId]
      );

      if (userCalendarResult.rows.length === 0) {
        results.errors.push({
          appointmentId,
          error: 'Dentist user not found or Google Calendar not configured',
        });
        continue;
      }

      const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
      const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';

      logger.info(`[Fix Google Calendar Events] Deleting "szabad" event ${timeSlotGoogleCalendarEventId} from source calendar for appointment ${appointmentId}`);
      const deleteResult = await deleteGoogleCalendarEvent(
        dentistUserId,
        timeSlotGoogleCalendarEventId,
        sourceCalendarId
      );

      if (!deleteResult) {
        console.warn(`[Fix Google Calendar Events] Failed to delete "szabad" event for appointment ${appointmentId}`);
      }

      logger.info(`[Fix Google Calendar Events] Creating new event with patient name in target calendar for appointment ${appointmentId}`);
      const newEventId = await createGoogleCalendarEvent(
        dentistUserId,
        {
          summary: `Betegfogadás - ${patientName}`,
          description: `Beteg: ${patientName}\nTAJ: ${patientTaj}\nBeutaló orvos: ${createdBy}`,
          startTime: startTime,
          endTime: endTime,
          location: 'Maxillofaciális Rehabilitáció',
          calendarId: targetCalendarId,
        }
      );

      if (!newEventId) {
        results.errors.push({
          appointmentId,
          error: 'Failed to create Google Calendar event',
        });
        logger.error(`[Fix Google Calendar Events] Failed to create new event for appointment ${appointmentId}`);
        continue;
      }

      await pool.query(
        'UPDATE appointments SET google_calendar_event_id = $1 WHERE id = $2',
        [newEventId, appointmentId]
      );

      results.fixed++;
      logger.info(`[Fix Google Calendar Events] Successfully fixed appointment ${appointmentId} with event ID ${newEventId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push({
        appointmentId: appointment.appointment_id,
        error: errorMessage,
      });
      logger.error(`[Fix Google Calendar Events] Error fixing appointment ${appointment.appointment_id}:`, error);
    }
  }

  return NextResponse.json({
    success: true,
    message: `Feldolgozva: ${results.total} időpont, sikeresen javítva: ${results.fixed}, hibák: ${results.errors.length}`,
    results,
  });
});
