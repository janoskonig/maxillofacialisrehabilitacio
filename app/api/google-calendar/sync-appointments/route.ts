import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from '@/lib/google-calendar';

/**
 * Manually sync the current user's appointments to their Google Calendar.
 * Creates events for future appointments that don't have google_calendar_event_id.
 * POST /api/google-calendar/sync-appointments
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

    const pool = getDbPool();

    // Get current user
    const userResult = await pool.query(
      `SELECT id, email, google_calendar_enabled, google_calendar_source_calendar_id, google_calendar_target_calendar_id
       FROM users WHERE email = $1`,
      [auth.email]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Felhasználó nem található' },
        { status: 404 }
      );
    }

    const user = userResult.rows[0];
    if (!user.google_calendar_enabled) {
      return NextResponse.json(
        { error: 'Google Calendar nincs összekötve' },
        { status: 400 }
      );
    }

    const userId = user.id;
    const sourceCalendarId = user.google_calendar_source_calendar_id || 'primary';
    const targetCalendarId = user.google_calendar_target_calendar_id || 'primary';

    // Find appointments that need syncing:
    // - User owns the time slot (ats.user_id = current user)
    // - No google_calendar_event_id
    // - Not cancelled
    // - In the future
    const appointmentsResult = await pool.query(
      `SELECT 
        a.id as appointment_id,
        a.created_by,
        ats.start_time,
        ats.google_calendar_event_id as time_slot_google_calendar_event_id,
        ats.source as time_slot_source,
        p.nev as patient_name,
        p.taj as patient_taj
      FROM appointments a
      JOIN available_time_slots ats ON a.time_slot_id = ats.id
      JOIN patients p ON a.patient_id = p.id
      WHERE ats.user_id = $1
        AND a.google_calendar_event_id IS NULL
        AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_patient', 'cancelled_by_doctor'))
        AND ats.start_time > NOW()
      ORDER BY ats.start_time ASC`,
      [userId]
    );

    const appointments = appointmentsResult.rows;
    const results = {
      total: appointments.length,
      synced: 0,
      errors: [] as Array<{ appointmentId: string; error: string }>,
    };

    for (const appointment of appointments) {
      try {
        const appointmentId = appointment.appointment_id;
        const startTime = new Date(appointment.start_time);
        const endTime = new Date(startTime);
        endTime.setMinutes(endTime.getMinutes() + 30);

        const patientName = appointment.patient_name || 'Név nélküli beteg';
        const patientTaj = appointment.patient_taj || 'Nincs megadva';
        const createdBy = appointment.created_by || 'Ismeretlen';

        const isFromGoogleCalendar =
          appointment.time_slot_google_calendar_event_id &&
          appointment.time_slot_source === 'google_calendar';

        if (isFromGoogleCalendar) {
          const deleteResult = await deleteGoogleCalendarEvent(
            userId,
            appointment.time_slot_google_calendar_event_id,
            sourceCalendarId
          );
          if (!deleteResult) {
            console.warn(`[Sync Appointments] Failed to delete "szabad" event for appointment ${appointmentId}`);
          }
        }

        const newEventId = await createGoogleCalendarEvent(userId, {
          summary: `Betegfogadás - ${patientName}`,
          description: `Beteg: ${patientName}\nTAJ: ${patientTaj}\nBeutaló orvos: ${createdBy}`,
          startTime,
          endTime,
          location: 'Maxillofaciális Rehabilitáció',
          calendarId: targetCalendarId,
        });

        if (!newEventId) {
          results.errors.push({
            appointmentId,
            error: 'Nem sikerült létrehozni a Google Calendar eseményt',
          });
          continue;
        }

        await pool.query(
          'UPDATE appointments SET google_calendar_event_id = $1 WHERE id = $2',
          [newEventId, appointmentId]
        );

        results.synced++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push({
          appointmentId: appointment.appointment_id,
          error: errorMessage,
        });
        console.error(`[Sync Appointments] Error syncing appointment ${appointment.appointment_id}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message:
        results.total === 0
          ? 'Nincs szinkronizálandó időpont'
          : `${results.synced} időpont sikeresen szinkronizálva a Google Naptárba${results.errors.length > 0 ? `, ${results.errors.length} hiba` : ''}`,
      results,
    });
  } catch (error) {
    console.error('Error syncing appointments to Google Calendar:', error);
    return NextResponse.json(
      {
        error: 'Hiba történt a szinkronizáció során',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
