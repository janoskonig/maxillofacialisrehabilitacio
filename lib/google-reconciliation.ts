/**
 * Google Calendar reconciliation: blocking mode.
 * Compares DB booked appointments with Google target calendar.
 * Conflicts auto-mark affected DB slots as `blocked`; require manual resolution.
 */

import { getDbPool } from './db';
import { fetchGoogleCalendarEvents, GoogleCalendarEvent } from './google-calendar';

export interface ReconciliationResult {
  userId: string;
  email: string;
  slotsChecked: number;
  conflicts: Array<{
    slotId: string;
    appointmentId: string;
    reason: string;
    googleEventId?: string;
  }>;
  blocksApplied: number;
  errors: string[];
}

/**
 * Run reconciliation for a single user.
 * Returns conflicts and applies blocks to conflicting slots.
 */
export async function reconcileUserWithGoogle(userId: string): Promise<ReconciliationResult> {
  const pool = getDbPool();
  const result: ReconciliationResult = {
    userId,
    email: '',
    slotsChecked: 0,
    conflicts: [],
    blocksApplied: 0,
    errors: [],
  };

  try {
    const userResult = await pool.query(
      `SELECT id, email, google_calendar_target_calendar_id 
       FROM users 
       WHERE id = $1 AND google_calendar_enabled = true`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      result.errors.push('User not found or Google Calendar not enabled');
      return result;
    }

    const user = userResult.rows[0];
    result.email = user.email || '';

    const targetCalendarId = user.google_calendar_target_calendar_id || 'primary';

    const now = new Date();
    const horizonEnd = new Date(now);
    horizonEnd.setDate(horizonEnd.getDate() + 30);

    // Get all booked appointments for this user's slots (next 30 days)
    const appointmentsResult = await pool.query(
      `SELECT 
        a.id as appointment_id,
        a.google_calendar_event_id,
        a.time_slot_id,
        ats.start_time,
        ats.user_id
       FROM appointments a
       JOIN available_time_slots ats ON a.time_slot_id = ats.id
       WHERE ats.user_id = $1
         AND a.start_time > CURRENT_TIMESTAMP
         AND a.start_time <= $2
         AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
         AND ats.state != 'blocked'`,
      [userId, horizonEnd]
    );

    const appointments = appointmentsResult.rows;
    result.slotsChecked = appointments.length;

    if (appointments.length === 0) {
      return result;
    }

    // Fetch all events from target calendar in the window
    const googleEvents = await fetchGoogleCalendarEvents(userId, now, horizonEnd, targetCalendarId);
    const eventMap = new Map<string, GoogleCalendarEvent>();

    for (const ev of googleEvents) {
      eventMap.set(ev.id, ev);
    }

    // Find events overlapping a slot (slot start + 30 min default)
    const slotDurationMs = 30 * 60 * 1000;
    const getOverlappingEvents = (slotStart: Date, excludeEventId?: string) => {
      const slotStartMs = slotStart.getTime();
      const slotEndMs = slotStartMs + slotDurationMs;
      return googleEvents.filter((ev) => {
        if (excludeEventId && ev.id === excludeEventId) return false;
        const startStr = ev.start?.dateTime || ev.start?.date;
        const endStr = ev.end?.dateTime || ev.end?.date;
        if (!startStr || !endStr) return false;
        const evStart = new Date(startStr).getTime();
        const evEnd = new Date(endStr).getTime();
        return evStart < slotEndMs && evEnd > slotStartMs;
      });
    };

    for (const appt of appointments) {
      const slotStart = new Date(appt.start_time);
      const ourEventId = appt.google_calendar_event_id;

      // Check 1: We have an appointment but no event in Google
      if (!ourEventId) {
        const overlapping = getOverlappingEvents(slotStart);
        const externalEvents = overlapping.filter((e) => e.summary?.toLowerCase() !== 'szabad');
        if (externalEvents.length > 0) {
          result.conflicts.push({
            slotId: appt.time_slot_id,
            appointmentId: appt.appointment_id,
            reason: 'external_event_at_slot',
            googleEventId: externalEvents[0].id,
          });
        }
        continue;
      }

      const ourEvent = eventMap.get(ourEventId);

      // Check 2: Our event is missing from Google (deleted externally)
      if (!ourEvent) {
        result.conflicts.push({
          slotId: appt.time_slot_id,
          appointmentId: appt.appointment_id,
          reason: 'our_event_deleted',
          googleEventId: ourEventId,
        });
        continue;
      }

      // Check 3: Our event exists but time was changed
      const evStartStr = ourEvent.start?.dateTime || ourEvent.start?.date;
      if (evStartStr) {
        const evStart = new Date(evStartStr).getTime();
        const slotStartMs = slotStart.getTime();
        if (Math.abs(evStart - slotStartMs) > 60 * 1000) {
          result.conflicts.push({
            slotId: appt.time_slot_id,
            appointmentId: appt.appointment_id,
            reason: 'our_event_time_changed',
            googleEventId: ourEventId,
          });
        }
      }

      // Check 4: Multiple events at same slot (overlap) - we have ours, but there's another
      const otherEvents = getOverlappingEvents(slotStart, ourEventId);
      if (otherEvents.length > 0) {
        result.conflicts.push({
          slotId: appt.time_slot_id,
          appointmentId: appt.appointment_id,
          reason: 'overlapping_external_event',
          googleEventId: otherEvents[0].id,
        });
      }
    }

    // Apply blocks: mark conflicting slots as blocked
    const slotIdsToBlock = [...new Set(result.conflicts.map((c) => c.slotId))];
    for (const slotId of slotIdsToBlock) {
      const updateResult = await pool.query(
        `UPDATE available_time_slots 
         SET state = 'blocked' 
         WHERE id = $1 AND state != 'blocked'
         RETURNING id`,
        [slotId]
      );
      if (updateResult.rowCount && updateResult.rowCount > 0) {
        result.blocksApplied++;
      }
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(msg);
    return result;
  }
}

/**
 * Run reconciliation for all users with Google Calendar enabled.
 */
export async function runGoogleReconciliation(): Promise<ReconciliationResult[]> {
  const pool = getDbPool();
  const usersResult = await pool.query(
    `SELECT id FROM users WHERE google_calendar_enabled = true`
  );

  const results: ReconciliationResult[] = [];
  for (const row of usersResult.rows) {
    const r = await reconcileUserWithGoogle(row.id);
    results.push(r);
  }

  return results;
}
