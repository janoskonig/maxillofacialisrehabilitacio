/**
 * Shared logic: convert a single open slot_intent to a hard appointment.
 * Used by POST /api/slot-intents/[id]/convert and POST /api/episodes/[id]/convert-all-intents.
 * When skipOneHardNext is true (batch), the one-hard-next check is not performed.
 */

import { Pool } from 'pg';
import { checkOneHardNext, getAppointmentRiskSettings } from '@/lib/scheduling-service';
import type { AuthPayload } from '@/lib/auth-server';

export interface ConvertIntentOptions {
  /** Pre-selected time slot id; if not set, a free slot is found in the window */
  timeSlotId?: string;
  /** When true, skip one-hard-next check (used by batch convert) */
  skipOneHardNext?: boolean;
}

export interface ConvertIntentResult {
  ok: true;
  appointmentId: string;
  intentId: string;
}

export interface ConvertIntentError {
  ok: false;
  status: number;
  error: string;
  code?: string;
  overrideHint?: string;
}

export type ConvertIntentOutcome = ConvertIntentResult | ConvertIntentError;

/**
 * Convert one open slot_intent to an appointment. Runs in its own transaction.
 * Uses suggested_start/suggested_end for the search window when present, else window_start/window_end.
 */
export async function convertIntentToAppointment(
  pool: Pool,
  intentId: string,
  auth: AuthPayload,
  options: ConvertIntentOptions = {}
): Promise<ConvertIntentOutcome> {
  const { timeSlotId: providedSlotId, skipOneHardNext = false } = options;

  const intentResult = await pool.query(
    `SELECT si.*, pe.patient_id as "patientId"
     FROM slot_intents si
     JOIN patient_episodes pe ON si.episode_id = pe.id
     WHERE si.id = $1 AND si.state = 'open'`,
    [intentId]
  );

  if (intentResult.rows.length === 0) {
    return { ok: false, status: 404, error: 'Intent nem található vagy már nem open' };
  }

  const intent = intentResult.rows[0];

  await pool.query('BEGIN');

  try {
    const intentLock = await pool.query(
      `SELECT id FROM slot_intents WHERE id = $1 AND state = 'open' FOR UPDATE`,
      [intentId]
    );
    if (intentLock.rows.length === 0) {
      await pool.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Intent nem található vagy már nem open' };
    }

    const episodeLock = await pool.query(
      `SELECT id FROM patient_episodes WHERE id = $1 FOR UPDATE`,
      [intent.episode_id]
    );
    if (episodeLock.rows.length === 0) {
      await pool.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Epizód nem található' };
    }

    let requiresPrecommit = false;
    if (intent.pool === 'work') {
      const pathwayResult = await pool.query(
        `SELECT cp.steps_json FROM patient_episodes pe
         JOIN care_pathways cp ON pe.care_pathway_id = cp.id
         WHERE pe.id = $1`,
        [intent.episode_id]
      );
      const steps = pathwayResult.rows[0]?.steps_json as Array<{ step_code: string; requires_precommit?: boolean }> | null;
      const step = steps?.find((s: { step_code: string }) => s.step_code === intent.step_code);
      requiresPrecommit = step?.requires_precommit === true;
    }

    if (!skipOneHardNext) {
      const oneHardNext = await checkOneHardNext(intent.episode_id, intent.pool as 'work' | 'consult' | 'control', {
        requiresPrecommit,
        stepCode: intent.step_code,
      });
      if (!oneHardNext.allowed) {
        await pool.query('ROLLBACK');
        return {
          ok: false,
          status: 409,
          error: oneHardNext.reason ?? 'Episode already has a future work appointment (one-hard-next)',
          code: 'ONE_HARD_NEXT_VIOLATION',
          overrideHint:
            "Egyszerre minden szükséges lépést az „Összes szükséges időpont lefoglalása” gombbal foglalhatod.",
        };
      }
    }

    if (requiresPrecommit && intent.episode_id) {
      await pool.query(
        `INSERT INTO scheduling_override_audit (episode_id, user_id, override_reason) VALUES ($1, $2, $3)`,
        [intent.episode_id, auth.userId, `precommit: ${intent.step_code}`]
      );
    }

    let slotId = providedSlotId;

    if (!slotId) {
      const windowStart = intent.suggested_start
        ? new Date(intent.suggested_start)
        : intent.window_start
          ? new Date(intent.window_start)
          : new Date();
      const windowEnd = intent.suggested_end
        ? new Date(intent.suggested_end)
        : intent.window_end
          ? new Date(intent.window_end)
          : new Date(windowStart.getTime() + 14 * 24 * 60 * 60 * 1000);

      const slotResult = await pool.query(
        `SELECT id FROM available_time_slots
         WHERE state = 'free' AND (slot_purpose = $1 OR slot_purpose IS NULL OR slot_purpose = 'flexible')
         AND start_time >= $2 AND start_time <= $3
         AND (duration_minutes >= $4 OR duration_minutes IS NULL)
         ORDER BY start_time ASC LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [intent.pool, windowStart, windowEnd, intent.duration_minutes]
      );

      if (slotResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return { ok: false, status: 404, error: 'Nincs szabad időpont a megadott ablakban' };
      }

      slotId = slotResult.rows[0].id;
    }

    const slotCheck = await pool.query(
      `SELECT id, start_time, user_id, state FROM available_time_slots WHERE id = $1 FOR UPDATE`,
      [slotId]
    );

    if (slotCheck.rows.length === 0) {
      await pool.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Időpont nem található' };
    }

    const slot = slotCheck.rows[0];
    if (slot.state !== 'free') {
      await pool.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Az időpont már nem szabad' };
    }

    const startTime = new Date(slot.start_time);
    const durationMinutes = intent.duration_minutes || 30;

    let noShowRisk = 0;
    let requiresConfirmation = false;
    let holdExpiresAt: Date | null = null;
    try {
      const riskSettings = await getAppointmentRiskSettings(intent.patientId, startTime, auth.email);
      noShowRisk = riskSettings.noShowRisk;
      requiresConfirmation = riskSettings.requiresConfirmation;
      holdExpiresAt = riskSettings.holdExpiresAt;
    } catch {
      holdExpiresAt = new Date();
      holdExpiresAt.setHours(holdExpiresAt.getHours() + 48);
    }

    const appointmentType =
      intent.pool === 'consult' ? 'elso_konzultacio' : intent.pool === 'control' ? 'kontroll' : 'munkafazis';

    const apptResult = await pool.query(
      `INSERT INTO appointments (
        patient_id, episode_id, time_slot_id, created_by, dentist_email, appointment_type,
        pool, duration_minutes, no_show_risk, requires_confirmation, hold_expires_at, created_via, requires_precommit, start_time, end_time,
        slot_intent_id, step_code, step_seq
      )
      SELECT $1, $2, $3, $4, u.email, $5, $6, $7, $8, $9, $10, 'worklist', $11, $12, $13,
             $14, $15, $16
      FROM available_time_slots ats
      JOIN users u ON ats.user_id = u.id
      WHERE ats.id = $3
      RETURNING id`,
      [
        intent.patientId,
        intent.episode_id,
        slotId,
        auth.email,
        appointmentType,
        intent.pool,
        durationMinutes,
        noShowRisk,
        requiresConfirmation,
        holdExpiresAt,
        requiresPrecommit,
        startTime,
        new Date(startTime.getTime() + durationMinutes * 60 * 1000),
        intentId,
        intent.step_code,
        intent.step_seq,
      ]
    );

    const appointmentId = apptResult.rows[0].id;

    await pool.query(
      `UPDATE available_time_slots SET state = 'booked', status = 'booked' WHERE id = $1`,
      [slotId]
    );

    await pool.query(
      `UPDATE slot_intents SET state = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [intentId]
    );

    await pool.query('COMMIT');

    return { ok: true, appointmentId, intentId };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}
