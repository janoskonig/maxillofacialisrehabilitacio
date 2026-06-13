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

  // Candidate ids only. The authoritative "is this hold still expirable?" check is
  // re-run under a row lock below — the snapshot here is advisory and may be stale by
  // the time we act on it.
  const candidates = await pool.query(
    `SELECT a.id
       FROM appointments a
      WHERE a.hold_expires_at IS NOT NULL
        AND a.hold_expires_at <= CURRENT_TIMESTAMP
        AND a.appointment_status IS NULL`,
    []
  );

  let expired = 0;
  for (const { id: apptId } of candidates.rows) {
    // A dedicated client per appointment so BEGIN/UPDATE/INSERT/COMMIT all run on the
    // SAME connection — issuing them through pool.query() scatters them across
    // arbitrary pooled connections, so nothing is actually transactional and the
    // catch-block ROLLBACK becomes a no-op.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Re-read under a row lock and re-assert the hold is still unconfirmed. SKIP LOCKED
      // means a row mid-confirmation in another transaction is left untouched. This closes
      // the TOCTOU race where a clinician confirms the hold between our SELECT and UPDATE —
      // without it we would overwrite the confirmed appointment with 'cancelled' and free a
      // slot that still has a live booking (silent vanished appointment / double-book).
      const locked = await client.query(
        `SELECT id, time_slot_id, appointment_status
           FROM appointments
          WHERE id = $1
            AND hold_expires_at IS NOT NULL
            AND hold_expires_at <= CURRENT_TIMESTAMP
            AND appointment_status IS NULL
          FOR UPDATE SKIP LOCKED`,
        [apptId]
      );

      if (locked.rows.length === 0) {
        // Confirmed, cancelled, or locked by another transaction since the candidate
        // scan — no longer ours to expire.
        await client.query('ROLLBACK');
        continue;
      }

      const timeSlotId = locked.rows[0].time_slot_id;
      const oldStatus = locked.rows[0].appointment_status;

      await client.query(
        `UPDATE appointments SET appointment_status = $1, completion_notes = $2, hold_expires_at = NULL
          WHERE id = $3 AND appointment_status IS NULL`,
        ['cancelled_by_doctor', HOLD_EXPIRED_NOTE, apptId]
      );

      if (timeSlotId) {
        await client.query(
          `UPDATE available_time_slots SET state = 'free', status = 'available' WHERE id = $1`,
          [timeSlotId]
        );
      }

      await client.query(
        `INSERT INTO appointment_status_events (appointment_id, old_status, new_status, created_by) VALUES ($1, $2, $3, $4)`,
        [apptId, oldStatus, 'cancelled_by_doctor', 'hold-expiry-worker']
      );

      await client.query('COMMIT');
      expired++;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already broken — release will discard it */
      }
      errors.push(`appointment ${apptId}: ${String(e)}`);
    } finally {
      client.release();
    }
  }

  return { expired, errors };
}
