/**
 * Hold expiry: expire appointments whose hold_expires_at has passed.
 * On expiry: appointment_status → cancelled_by_doctor, completion_notes = 'hold_expired',
 * slot returned to free. Emits appointment_status_events for audit.
 */

import { getDbPool } from './db';

const HOLD_EXPIRED_NOTE = 'hold_expired';

export async function runHoldExpiry(): Promise<{
  expired: number;
  errors: string[];
}> {
  const pool = getDbPool();
  const errors: string[] = [];

  const expiredResult = await pool.query(
    `SELECT a.id, a.time_slot_id, a.appointment_status
     FROM appointments a
     WHERE a.hold_expires_at IS NOT NULL AND a.hold_expires_at <= CURRENT_TIMESTAMP
     AND a.appointment_status IS NULL`,
    []
  );

  let expired = 0;
  for (const row of expiredResult.rows) {
    try {
      await pool.query('BEGIN');
      const apptId = row.id;
      const timeSlotId = row.time_slot_id;
      const oldStatus = row.appointment_status;

      await pool.query(
        `UPDATE appointments SET appointment_status = $1, completion_notes = $2, hold_expires_at = NULL WHERE id = $3`,
        ['cancelled_by_doctor', HOLD_EXPIRED_NOTE, apptId]
      );

      await pool.query(
        `UPDATE available_time_slots SET state = 'free', status = 'available' WHERE id = $1`,
        [timeSlotId]
      );

      await pool.query(
        `INSERT INTO appointment_status_events (appointment_id, old_status, new_status, created_by) VALUES ($1, $2, $3, $4)`,
        [apptId, oldStatus, 'cancelled_by_doctor', 'hold-expiry-worker']
      );

      await pool.query('COMMIT');
      expired++;
    } catch (e) {
      await pool.query('ROLLBACK');
      errors.push(`appointment ${row.id}: ${String(e)}`);
    }
  }

  return { expired, errors };
}
