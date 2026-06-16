/**
 * Stuck-slot reaper.
 *
 * Slots in `state IN ('held','offered')` are only bookable once they return to
 * `'free'` (see `canConsumeSlot`). `runHoldExpiry` frees slots via the *appointment*
 * `hold_expires_at`, but nothing reverts a slot whose hold/offer became orphaned
 * (no active appointment, or the holding appointment's hold already expired). Such a
 * slot would be permanently unbookable. This reaper recovers them.
 *
 * Safe by construction: it only touches FUTURE slots that have NO active appointment
 * holding them with a still-valid hold, so it cannot free a legitimately held slot.
 *
 * Run periodically (cron), like the other expiry workers.
 */
import { getDbPool } from './db';
import { logger } from './logger';

export interface StuckSlotReapResult {
  freed: number;
  slotIds: string[];
}

export async function runStuckSlotReaper(): Promise<StuckSlotReapResult> {
  const pool = getDbPool();
  const res = await pool.query(
    `UPDATE available_time_slots ats
        SET state = 'free', status = 'available', updated_at = now()
      WHERE ats.state IN ('held', 'offered')
        AND ats.start_time > CURRENT_TIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.time_slot_id = ats.id
            AND (a.appointment_status IS NULL OR a.appointment_status = 'completed')
            AND (a.hold_expires_at IS NULL OR a.hold_expires_at > CURRENT_TIMESTAMP)
        )
      RETURNING ats.id`,
  );
  const slotIds = res.rows.map((r: { id: string }) => r.id);
  if (slotIds.length > 0) {
    logger.warn(`[stuck-slot-reaper] freed ${slotIds.length} orphaned held/offered slot(s)`);
  }
  return { freed: slotIds.length, slotIds };
}
