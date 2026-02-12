/**
 * Single scheduling service: slot consumption, invariant checks, hold expiry, conversions.
 * Slot state precedence: blocked > booked > held/offered > free. Rebalance touches only free.
 */

import { getDbPool } from './db';

/** Slot state precedence (highest first). Rebalance only touches state='free'. */
export const SLOT_STATE_PRECEDENCE = ['blocked', 'booked', 'held', 'offered', 'free'] as const;
export type SlotState = (typeof SLOT_STATE_PRECEDENCE)[number];

/** States that prevent slot consumption (cannot book). */
export const SLOT_STATES_BLOCKING_BOOKING: SlotState[] = ['blocked', 'booked', 'held', 'offered'];

/** Only free slots can be retagged by rebalance. */
export const SLOT_STATE_REBALANCE_TARGET = 'free';

export function canConsumeSlot(state: string | null): boolean {
  return state === 'free' || !state;
}

export function isRebalanceEligible(state: string | null): boolean {
  return state === SLOT_STATE_REBALANCE_TARGET;
}
import { computeNoShowRiskWithConfig, getPatientNoShowsLast12m } from './no-show-risk';

export type CreatedVia = 'worklist' | 'patient_self' | 'admin_override' | 'surgeon_override' | 'migration' | 'google_import';

export interface OneHardNextCheckResult {
  allowed: boolean;
  existingAppointmentId?: string;
  reason?: string;
}

/**
 * Check one-hard-next: for episode in WIP, at most one future hard work appointment.
 * Exception: requires_precommit steps allow up to 2 future work appointments (both must be precommit).
 * Returns { allowed: false } if invariant would be violated.
 */
export async function checkOneHardNext(
  episodeId: string | null,
  pool: 'work' | 'consult' | 'control',
  options?: { requiresPrecommit?: boolean; stepCode?: string }
): Promise<OneHardNextCheckResult> {
  if (!episodeId || pool !== 'work') {
    return { allowed: true };
  }

  const db = getDbPool();
  const futureWork = await db.query(
    `SELECT id, requires_precommit FROM appointments
     WHERE episode_id = $1 AND pool = 'work'
     AND start_time > CURRENT_TIMESTAMP
     AND (appointment_status IS NULL OR appointment_status = 'completed')`,
    [episodeId]
  );

  const regular = futureWork.rows.filter((r: { requires_precommit: boolean }) => !r.requires_precommit);
  const precommit = futureWork.rows.filter((r: { requires_precommit: boolean }) => r.requires_precommit);
  const total = futureWork.rows.length;

  const addingPrecommit = options?.requiresPrecommit === true;

  if (addingPrecommit) {
    // Allow 2 future work appointments only when both are precommit
    if (regular.length > 0) {
      return {
        allowed: false,
        existingAppointmentId: regular[0].id,
        reason: 'Episode has a non-precommit future work appointment; cannot add precommit (one-hard-next)',
      };
    }
    if (total >= 2) {
      return {
        allowed: false,
        existingAppointmentId: futureWork.rows[0].id,
        reason: 'Episode already has 2 future work appointments (precommit limit)',
      };
    }
    return { allowed: true };
  }

  // Adding regular (non-precommit) work appointment
  if (regular.length > 0) {
    return {
      allowed: false,
      existingAppointmentId: regular[0].id,
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
