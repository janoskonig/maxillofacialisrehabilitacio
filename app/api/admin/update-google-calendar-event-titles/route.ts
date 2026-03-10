import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { updateGoogleCalendarEvent } from '@/lib/google-calendar';
import { roleHandler } from '@/lib/api/route-handler';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Frissíti a már létrehozott Google Naptár események címét:
 * "Betegfogadás - [név]" → "[név] - Betegfogadás"
 * Csak admin futtathatja.
 */
export const POST = roleHandler(['admin'], async (req, { correlationId, auth }) => {
  const pool = getDbPool();

  const appointmentsResult = await pool.query(
    `SELECT 
      a.id as appointment_id,
      a.google_calendar_event_id,
      a.created_by,
      ats.start_time,
      ats.user_id as dentist_user_id,
      p.nev as patient_name,
      p.taj as patient_taj
    FROM appointments a
    JOIN available_time_slots ats ON a.time_slot_id = ats.id
    JOIN patients p ON a.patient_id = p.id
    WHERE a.google_calendar_event_id IS NOT NULL
      AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_patient', 'cancelled_by_doctor'))
    ORDER BY ats.start_time ASC`
  );

  const appointments = appointmentsResult.rows;
  const results = {
    total: appointments.length,
    updated: 0,
    errors: [] as Array<{ appointmentId: string; error: string }>,
  };

  logger.info(`[Update Google Calendar Event Titles] Found ${appointments.length} appointments with calendar events`);

  for (const appointment of appointments) {
    try {
      const appointmentId = appointment.appointment_id;
      const eventId = appointment.google_calendar_event_id;
      const dentistUserId = appointment.dentist_user_id;
      const startTime = new Date(appointment.start_time);
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + 30);
      const patientName = appointment.patient_name || 'Név nélküli beteg';
      const patientTaj = appointment.patient_taj || 'Nincs megadva';
      const createdBy = appointment.created_by || 'Ismeretlen';

      const userCalendarResult = await pool.query(
        `SELECT google_calendar_target_calendar_id 
         FROM users 
         WHERE id = $1`,
        [dentistUserId]
      );

      if (userCalendarResult.rows.length === 0) {
        results.errors.push({
          appointmentId,
          error: 'Fogpótlástanász felhasználó nem található',
        });
        continue;
      }

      const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';
      const newSummary = `${patientName} - Betegfogadás`;
      const description = `Beteg: ${patientName}\nTAJ: ${patientTaj}\nBeutaló orvos: ${createdBy}`;

      const updated = await updateGoogleCalendarEvent(
        dentistUserId,
        eventId,
        {
          summary: newSummary,
          description,
          startTime,
          endTime,
          location: 'Maxillofaciális Rehabilitáció',
          calendarId: targetCalendarId,
        },
        targetCalendarId
      );

      if (!updated) {
        results.errors.push({
          appointmentId,
          error: 'A Google Naptár esemény frissítése sikertelen',
        });
        logger.warn(`[Update Google Calendar Event Titles] Failed to update event for appointment ${appointmentId}`);
        continue;
      }

      results.updated++;
      logger.info(`[Update Google Calendar Event Titles] Updated title for appointment ${appointmentId} to "${newSummary}"`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push({
        appointmentId: appointment.appointment_id,
        error: errorMessage,
      });
      logger.error(`[Update Google Calendar Event Titles] Error updating appointment ${appointment.appointment_id}:`, error);
    }
  }

  return NextResponse.json({
    success: true,
    message: `Feldolgozva: ${results.total} időpont, sikeresen frissítve: ${results.updated}, hibák: ${results.errors.length}`,
    results,
  });
});
