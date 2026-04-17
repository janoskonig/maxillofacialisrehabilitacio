/**
 * Single scheduling service: slot consumption, invariant checks, hold expiry, conversions.
 * Slot state precedence: blocked > booked > held/offered > free. Rebalance touches only free.
 */

import { PoolClient } from 'pg';
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

/**
 * Check if there is at least one free slot in the window for the given pool.
 * Shared by slots-for-booking and BLOCKED_CAPACITY check.
 * When providerId is set, only that user's slots count (aligned with assigned-provider booking).
 */
export async function hasFreeSlotInWindow(
  pool: 'consult' | 'work' | 'control',
  windowStart: Date,
  windowEnd: Date,
  durationMinutes: number,
  providerId?: string | null
): Promise<boolean> {
  const db = getDbPool();
  const r = await db.query(
    `SELECT 1 FROM available_time_slots ats
     WHERE ats.state = 'free' AND ats.start_time > CURRENT_TIMESTAMP
       AND ats.start_time >= $1 AND ats.start_time <= $2
       AND (ats.slot_purpose = $3 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
       AND (ats.duration_minutes >= $4 OR ats.duration_minutes IS NULL)
       AND ($5::text IS NULL OR ats.user_id = $5)
     LIMIT 1`,
    [windowStart.toISOString(), windowEnd.toISOString(), pool, durationMinutes, providerId ?? null]
  );
  return (r.rowCount ?? 0) > 0;
}
import { computeNoShowRiskWithConfig, getPatientNoShowsLast12m } from './no-show-risk';

export type CreatedVia = 'worklist' | 'patient_self' | 'admin_override' | 'surgeon_override' | 'migration' | 'google_import';

export interface OneHardNextCheckResult {
  allowed: boolean;
  existingAppointmentId?: string;
  reason?: string;
}

/**
 * Check one-hard-next: for episode in WIP, at most one future hard work appointment that is neither
 * precommit nor chain-reservation. Batch chain bookings set is_chain_reservation and do not count here.
 * Exception: requires_precommit steps allow up to 2 future work appointments (both must be precommit).
 */
export async function checkOneHardNext(
  episodeId: string | null,
  pool: 'work' | 'consult' | 'control',
  options?: { requiresPrecommit?: boolean; stepCode?: string; dbClient?: PoolClient }
): Promise<OneHardNextCheckResult> {
  if (!episodeId || pool !== 'work') {
    return { allowed: true };
  }

  const db = options?.dbClient ?? getDbPool();
  const futureWork = await db.query(
    `SELECT id, requires_precommit, is_chain_reservation FROM appointments
     WHERE episode_id = $1 AND pool = 'work'
     AND start_time > CURRENT_TIMESTAMP
     AND (appointment_status IS NULL OR appointment_status = 'completed')`,
    [episodeId]
  );

  type Row = { id: string; requires_precommit: boolean; is_chain_reservation: boolean };
  const regular = futureWork.rows.filter(
    (r: Row) => !r.requires_precommit && !r.is_chain_reservation
  );
  /** Futures that count toward the precommit cap (chain reservations are excluded like one-hard-next). */
  const futureWorkNonChain = futureWork.rows.filter((r: Row) => !r.is_chain_reservation);

  const addingPrecommit = options?.requiresPrecommit === true;

  if (addingPrecommit) {
    if (regular.length > 0) {
      return {
        allowed: false,
        existingAppointmentId: regular[0].id,
        reason: 'Episode has a non-precommit future work appointment; cannot add precommit (one-hard-next)',
      };
    }
    if (futureWorkNonChain.length >= 2) {
      return {
        allowed: false,
        existingAppointmentId: futureWorkNonChain[0]?.id,
        reason: 'Episode already has 2 future work appointments (precommit limit)',
      };
    }
    return { allowed: true };
  }

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
