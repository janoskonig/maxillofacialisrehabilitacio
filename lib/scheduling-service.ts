/**
 * Single scheduling service: slot consumption, invariant checks, hold expiry, conversions.
 * Slot state precedence: blocked > booked > held/offered > free. Rebalance touches only free.
 */

import { getDbPool } from './db';
import { computeNoShowRiskWithConfig, getPatientNoShowsLast12m } from './no-show-risk';

export type CreatedVia = 'worklist' | 'patient_self' | 'admin_override' | 'surgeon_override' | 'migration' | 'google_import';

export interface OneHardNextCheckResult {
  allowed: boolean;
  existingAppointmentId?: string;
  reason?: string;
}

/**
 * Check one-hard-next: for episode in WIP, at most one future hard work appointment.
 * Returns { allowed: false } if episode already has a future work appointment.
 */
export async function checkOneHardNext(
  episodeId: string | null,
  pool: 'work' | 'consult' | 'control'
): Promise<OneHardNextCheckResult> {
  if (!episodeId || pool !== 'work') {
    return { allowed: true };
  }

  const db = getDbPool();
  const r = await db.query(
    `SELECT id FROM appointments
     WHERE episode_id = $1 AND pool = 'work'
     AND start_time > CURRENT_TIMESTAMP
     AND (appointment_status IS NULL OR appointment_status = 'completed')
     AND requires_precommit = false
     LIMIT 1`,
    [episodeId]
  );

  if (r.rows.length > 0) {
    return {
      allowed: false,
      existingAppointmentId: r.rows[0].id,
      reason: 'Episode already has a future work appointment (one-hard-next invariant)',
    };
  }

  return { allowed: true };
}

/**
 * Compute no-show risk and hold/confirmation settings for a new appointment.
 */
export async function getAppointmentRiskSettings(
  patientId: string,
  timeSlotStart: Date,
  createdBy: string
): Promise<{ noShowRisk: number; requiresConfirmation: boolean; holdExpiresAt: Date }> {
  const leadTimeDays = Math.ceil((timeSlotStart.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  const appointmentStartHour = timeSlotStart.getHours();
  const patientNoShowsLast12m = await getPatientNoShowsLast12m(patientId);

  const result = await computeNoShowRiskWithConfig({
    patientId,
    leadTimeDays,
    appointmentStartHour,
    patientNoShowsLast12m,
  });

  const holdExpiresAt = new Date();
  holdExpiresAt.setHours(holdExpiresAt.getHours() + result.holdHours);

  return {
    noShowRisk: result.risk,
    requiresConfirmation: result.requiresConfirmation,
    holdExpiresAt,
  };
}
