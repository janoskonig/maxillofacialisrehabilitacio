import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from '@/lib/google-calendar';
import { logger } from '@/lib/logger';

/**
 * Fix Google Calendar events for existing appointments that are missing calendar events
 * POST /api/admin/fix-google-calendar-events
 * 
 * This endpoint finds all booked appointments that:
 * - Don't have a google_calendar_event_id
 * - Have a time slot from Google Calendar (source = 'google_calendar')
 * - Are in the future
 * 
 * For each such appointment, it:
 * - Deletes the "szabad" event from source calendar
 * - Creates a new event with patient name in target calendar
 * - Updates the appointment with the new event ID
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Only admins can run this
    if (auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága ehhez a művelethez' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const DEFAULT_CIM = '1088 Budapest, Szentkirályi utca 47';

    // Find all appointments that need fixing:
    // - No google_calendar_event_id
    // - Time slot from Google Calendar
    // - Time slot is booked
    // - Time slot is in the future
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

    // Process each appointment
    for (const appointment of appointments) {
      try {
        const appointmentId = appointment.appointment_id;
        const startTime = new Date(appointment.start_time);
        const endTime = new Date(startTime);
        endTime.setMinutes(endTime.getMinutes() + 30); // 30 minutes duration

        const timeSlotGoogleCalendarEventId = appointment.time_slot_google_calendar_event_id;
        const dentistUserId = appointment.dentist_user_id;
        const patientName = appointment.patient_name || 'Név nélküli beteg';
        const patientTaj = appointment.patient_taj || 'Nincs megadva';
        const createdBy = appointment.created_by || 'Ismeretlen';

        // Get calendar IDs from user settings
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

        // Delete the "szabad" event from source calendar
        logger.info(`[Fix Google Calendar Events] Deleting "szabad" event ${timeSlotGoogleCalendarEventId} from source calendar for appointment ${appointmentId}`);
        const deleteResult = await deleteGoogleCalendarEvent(
          dentistUserId,
          timeSlotGoogleCalendarEventId,
          sourceCalendarId
        );

        if (!deleteResult) {
          console.warn(`[Fix Google Calendar Events] Failed to delete "szabad" event for appointment ${appointmentId}`);
          // Continue anyway - try to create the new event
        }

        // Create a new event with patient name in target calendar
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

        // Update appointment with the new event ID
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
  } catch (error) {
    logger.error('Error fixing Google Calendar events:', error);
    return NextResponse.json(
      { error: 'Hiba történt a Google Calendar események javításakor' },
      { status: 500 }
    );
  }
}
