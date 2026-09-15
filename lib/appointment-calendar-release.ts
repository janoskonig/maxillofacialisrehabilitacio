/**
 * Lemondott foglalás Google Naptár-utómunkája.
 *
 * A DELETE /api/appointments/[id] és a POST /api/appointments/[id]/cancel-and-offer
 * közös, commit UTÁNI lépése: a beteg-esemény törlése a cél-naptárból, majd egy
 * „szabad" esemény visszaírása, hogy a felszabadult slot a Google Naptárban is
 * szabadként látszódjon. Hiba (lejárt token, auth) esetén NEM dob — a lemondás
 * már megtörtént, a naptár-szinkron legfeljebb elmarad (log).
 */

import type { Pool } from 'pg';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from './google-calendar';
import { logger } from './logger';

export interface ReleaseCalendarEventParams {
  timeSlotId: string;
  timeSlotUserId: string | null;
  googleCalendarEventId: string | null;
  timeSlotSource: string | null;
  startTime: Date;
  /** Log-előtag, pl. '[Appointment Cancellation]'. */
  logPrefix: string;
  /** A visszaírt „szabad" esemény leírása. */
  freedDescription: string;
}

export async function releaseGoogleCalendarEventForCancelledSlot(
  pool: Pick<Pool, 'query'>,
  params: ReleaseCalendarEventParams
): Promise<void> {
  const {
    timeSlotId,
    timeSlotUserId,
    googleCalendarEventId,
    timeSlotSource,
    startTime,
    logPrefix,
    freedDescription,
  } = params;
  if (!googleCalendarEventId || !timeSlotUserId) return;

  try {
    const userCalendarResult = await pool.query(
      `SELECT google_calendar_source_calendar_id, google_calendar_target_calendar_id 
       FROM users 
       WHERE id = $1`,
      [timeSlotUserId]
    );
    const sourceCalendarId = userCalendarResult.rows[0]?.google_calendar_source_calendar_id || 'primary';
    const targetCalendarId = userCalendarResult.rows[0]?.google_calendar_target_calendar_id || 'primary';

    await deleteGoogleCalendarEvent(timeSlotUserId, googleCalendarEventId, targetCalendarId);
    logger.info(`${logPrefix} Deleted patient event from target calendar`);

    // Always recreate a "szabad" event so the slot reappears as free in Google Calendar
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + 30);
    const szabadCalendarId = timeSlotSource === 'google_calendar' ? sourceCalendarId : targetCalendarId;
    const szabadEventId = await createGoogleCalendarEvent(timeSlotUserId, {
      summary: 'szabad',
      description: freedDescription,
      startTime,
      endTime,
      location: 'Maxillofaciális Rehabilitáció',
      calendarId: szabadCalendarId,
    });
    if (szabadEventId) {
      logger.info(`${logPrefix} Recreated "szabad" event in ${szabadCalendarId} calendar`);
      await pool.query(
        `UPDATE available_time_slots 
         SET google_calendar_event_id = $1, source = 'google_calendar'
         WHERE id = $2`,
        [szabadEventId, timeSlotId]
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const isAuthError = /access token|authenticate|state|unauthorized/i.test(msg);
    if (isAuthError) {
      logger.warn(`${logPrefix} Google Calendar sync skipped (token invalid/expired). Időpont lemondva, naptár nincs szinkronizálva.`);
    } else {
      logger.error('Failed to handle Google Calendar event:', error);
    }
  }
}
