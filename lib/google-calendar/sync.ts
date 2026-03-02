import { getDbPool } from '../db';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './auth';
import { fetchGoogleCalendarEvents, createGoogleCalendarEvent, deleteGoogleCalendarEvent } from './api';

export async function syncTimeSlotsFromGoogleCalendar(userId: string): Promise<{
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}> {
  const result = {
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [] as string[],
  };
  
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return result;
  }
  
  try {
    const pool = getDbPool();
    
    try {
      await pool.query('SELECT 1');
    } catch (dbError) {
      const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
      console.error(`[syncTimeSlotsFromGoogleCalendar] Database connection test failed for user ${userId}:`, errorMsg);
      result.errors.push(`Database connection failed: ${errorMsg}`);
      throw new Error(`Database connection failed: ${errorMsg}`);
    }
    
    let userResult;
    try {
      userResult = await pool.query(
        `SELECT id, email, google_calendar_source_calendar_id 
         FROM users 
         WHERE id = $1 AND google_calendar_enabled = true`,
        [userId]
      );
    } catch (dbError) {
      const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
      console.error(`[syncTimeSlotsFromGoogleCalendar] Error querying user ${userId}:`, errorMsg);
      result.errors.push(`Database query failed: ${errorMsg}`);
      throw new Error(`Database query failed: ${errorMsg}`);
    }
    
    if (userResult.rows.length === 0) {
      return result;
    }
    
    const user = userResult.rows[0];
    const sourceCalendarId = user.google_calendar_source_calendar_id || 'primary';
    
    const now = new Date();
    const timeMax = new Date(now);
    timeMax.setFullYear(timeMax.getFullYear() + 2);
    
    const events = await fetchGoogleCalendarEvents(userId, now, timeMax, sourceCalendarId);
    console.log(`[syncTimeSlotsFromGoogleCalendar] Found ${events.length} total events from ${now.toISOString()} to ${timeMax.toISOString()}`);
    
    const szabadPattern = /^szabad\s+(\d+)$/i;
    const szabadEvents = events.filter((event) => {
      const summary = event.summary || '';
      return summary.toLowerCase() === 'szabad' || szabadPattern.test(summary);
    });
    console.log(`[syncTimeSlotsFromGoogleCalendar] Found ${szabadEvents.length} "szabad" events`);
    
    let existingSlotsResult;
    try {
      existingSlotsResult = await pool.query(
        `SELECT id, google_calendar_event_id, start_time, status, teremszam 
         FROM available_time_slots 
         WHERE user_id = $1 AND source = 'google_calendar' AND google_calendar_event_id IS NOT NULL`,
        [userId]
      );
    } catch (dbError) {
      const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
      console.error(`[syncTimeSlotsFromGoogleCalendar] Error querying existing slots for user ${userId}:`, errorMsg);
      result.errors.push(`Database query failed: ${errorMsg}`);
      throw new Error(`Database query failed: ${errorMsg}`);
    }
    
    const existingSlots = new Map<string, {
      id: string;
      startTime: Date;
      status: string;
      teremszam: string | null;
    }>();
    
    existingSlotsResult.rows.forEach((row) => {
      if (row.google_calendar_event_id) {
        existingSlots.set(row.google_calendar_event_id, {
          id: row.id,
          startTime: new Date(row.start_time),
          status: row.status,
          teremszam: row.teremszam,
        });
      }
    });
    
    const processedEventIds = new Set<string>();
    
    for (const event of szabadEvents) {
      processedEventIds.add(event.id);
      
      const startTimeStr = event.start.dateTime || event.start.date;
      if (!startTimeStr) {
        result.errors.push(`Event ${event.id} has no start time`);
        continue;
      }
      
      const startTime = new Date(startTimeStr);
      if (isNaN(startTime.getTime())) {
        result.errors.push(`Event ${event.id} has invalid start time: ${startTimeStr}`);
        continue;
      }
      
      if (startTime < now) {
        continue;
      }
      
      let teremszam: string | null = null;
      const summary = event.summary || '';
      const match = summary.match(/^szabad\s+(\d+)$/i);
      if (match && match[1]) {
        teremszam = match[1];
      }
      
      const existingSlot = existingSlots.get(event.id);
      
      if (existingSlot) {
        const startTimeChanged = existingSlot.startTime.getTime() !== startTime.getTime();
        const teremszamChanged = existingSlot.teremszam !== teremszam;
        
        if (startTimeChanged || teremszamChanged) {
          if (existingSlot.status === 'available') {
            const updates: string[] = [];
            const values: any[] = [];
            let paramIndex = 1;
            
            if (startTimeChanged) {
              updates.push(`start_time = $${paramIndex}`);
              values.push(startTime.toISOString());
              paramIndex++;
            }
            
            if (teremszamChanged) {
              updates.push(`teremszam = $${paramIndex}`);
              values.push(teremszam);
              paramIndex++;
            }
            
            if (updates.length > 0) {
              values.push(existingSlot.id);
              try {
                await pool.query(
                  `UPDATE available_time_slots 
                   SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP 
                   WHERE id = $${paramIndex}`,
                  values
                );
                result.updated++;
              } catch (dbError) {
                const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
                console.error(`[syncTimeSlotsFromGoogleCalendar] Error updating slot ${existingSlot.id} for user ${userId}:`, errorMsg);
                result.errors.push(`Failed to update slot ${existingSlot.id}: ${errorMsg}`);
              }
            }
          }
        }
      } else {
        try {
          await pool.query(
            `INSERT INTO available_time_slots (user_id, start_time, status, google_calendar_event_id, source, teremszam)
             VALUES ($1, $2, 'available', $3, 'google_calendar', $4)`,
            [userId, startTime.toISOString(), event.id, teremszam]
          );
          result.created++;
        } catch (dbError) {
          const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
          console.error(`[syncTimeSlotsFromGoogleCalendar] Error creating slot for event ${event.id} for user ${userId}:`, errorMsg);
          result.errors.push(`Failed to create slot for event ${event.id}: ${errorMsg}`);
        }
      }
    }
    
    for (const [eventId, slot] of Array.from(existingSlots.entries())) {
      if (!processedEventIds.has(eventId)) {
        if (slot.status === 'available') {
          try {
            await pool.query(
              `DELETE FROM available_time_slots WHERE id = $1`,
              [slot.id]
            );
            result.deleted++;
          } catch (dbError) {
            const errorMsg = dbError instanceof Error ? dbError.message : 'Unknown database error';
            console.error(`[syncTimeSlotsFromGoogleCalendar] Error deleting slot ${slot.id} for user ${userId}:`, errorMsg);
            result.errors.push(`Failed to delete slot ${slot.id}: ${errorMsg}`);
          }
        }
      }
    }
    
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`[syncTimeSlotsFromGoogleCalendar] Error syncing time slots from Google Calendar for user ${userId}:`, errorMessage);
    if (errorStack) {
      console.error(`[syncTimeSlotsFromGoogleCalendar] Error stack:`, errorStack);
    }
    
    if (errorMessage.includes('Connection terminated') || 
        errorMessage.includes('ECONNRESET') || 
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('Connection') ||
        errorMessage.includes('terminated')) {
      console.error(`[syncTimeSlotsFromGoogleCalendar] Connection error detected for user ${userId}`);
    }
    
    result.errors.push(`Sync error: ${errorMessage}`);
    return result;
  }
}

/**
 * Sync appointments that are missing from Google Calendar (google_calendar_event_id IS NULL).
 * For each such appointment, create a "Betegfogadás" event in the target calendar
 * and (if applicable) delete the "szabad" event from the source calendar.
 */
export async function syncMissingAppointmentsToGoogleCalendar(userId: string): Promise<{
  total: number;
  synced: number;
  errors: Array<{ appointmentId: string; error: string }>;
}> {
  const results = {
    total: 0,
    synced: 0,
    errors: [] as Array<{ appointmentId: string; error: string }>,
  };

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return results;
  }

  const pool = getDbPool();

  const userResult = await pool.query(
    `SELECT id, google_calendar_enabled, google_calendar_source_calendar_id, google_calendar_target_calendar_id
     FROM users WHERE id = $1 AND google_calendar_enabled = true`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    return results;
  }

  const user = userResult.rows[0];
  const sourceCalendarId = user.google_calendar_source_calendar_id || 'primary';
  const targetCalendarId = user.google_calendar_target_calendar_id || 'primary';

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
  results.total = appointments.length;

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
          console.warn(`[syncMissingAppointments] Failed to delete "szabad" event for appointment ${appointmentId}`);
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
          error: 'Failed to create Google Calendar event',
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
      console.error(`[syncMissingAppointments] Error syncing appointment ${appointment.appointment_id}:`, error);
    }
  }

  return results;
}
