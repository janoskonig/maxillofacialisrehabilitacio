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
    `SELECT si.*, pe.patient_id as "patientId", pe.assigned_provider_id as "assignedProviderId"
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

    // Guard: refuse to book a step that is already completed/skipped
    try {
      const stepDoneCheck = await pool.query(
        `SELECT status FROM episode_steps
         WHERE episode_id = $1 AND step_code = $2 AND status IN ('completed', 'skipped')
         LIMIT 1`,
        [intent.episode_id, intent.step_code]
      );
      if (stepDoneCheck.rows.length > 0) {
        await pool.query(
          `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [intentId]
        );
        await pool.query('COMMIT');
        return { ok: false, status: 409, error: `Lépés már teljesítve/kihagyva: ${intent.step_code}`, code: 'STEP_ALREADY_DONE' };
      }
    } catch { /* episode_steps may not exist */ }

    // Guard: refuse to book when same step already has a non-cancelled appointment
    const existingStepAppt = await pool.query(
      `SELECT 1 FROM appointments
       WHERE episode_id = $1 AND step_code = $2
         AND (appointment_status IS NULL OR appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
       LIMIT 1`,
      [intent.episode_id, intent.step_code]
    );
    if (existingStepAppt.rows.length > 0) {
      await pool.query(
        `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [intentId]
      );
      await pool.query('COMMIT');
      return { ok: false, status: 409, error: `Lépéshez már van aktív foglalás: ${intent.step_code}`, code: 'STEP_ALREADY_BOOKED' };
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

      // Batch convert: DB partial unique index allows only one future work appt with requires_precommit=false per episode.
      // Force precommit for 2nd and later appointments so the index doesn't block.
      if (skipOneHardNext) {
        const existingFuture = await pool.query(
          `SELECT 1 FROM appointments
           WHERE episode_id = $1 AND pool = 'work'
           AND start_time > CURRENT_TIMESTAMP
           AND (appointment_status IS NULL OR appointment_status = 'completed')
           LIMIT 1`,
          [intent.episode_id]
        );
        if (existingFuture.rows.length > 0) {
          requiresPrecommit = true;
        }
      }
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

    const assignedProviderId = intent.assignedProviderId ?? (intent as { assigned_provider_id?: string }).assigned_provider_id ?? null;

    if (!slotId) {
      const windowStart = intent.window_start
        ? new Date(intent.window_start)
        : new Date();
      const windowEnd = intent.window_end
        ? new Date(intent.window_end)
        : new Date(windowStart.getTime() + 14 * 24 * 60 * 60 * 1000);

      const baseParams = [intent.pool, windowStart, windowEnd, intent.duration_minutes];
      const providerParam = assignedProviderId ? [assignedProviderId] : [];
      const paramsWithProvider = (extra: unknown[]) => [...baseParams, ...extra, ...providerParam];

      // Prefer same day-of-week and time as suggested_start (postpone by week, don't skip to another day)
      const suggestedStart = intent.suggested_start ? new Date(intent.suggested_start) : null;
      let slotResult: { rows: Array<{ id: string }> };

      if (suggestedStart) {
        // Use AT TIME ZONE to compare local hours/minutes — avoids DST mismatch between CET and CEST
        const tz = `'Europe/Budapest'`;
        const sql1 = `SELECT id FROM available_time_slots ats
           WHERE state = 'free' AND (ats.slot_purpose = $1 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
           AND ats.start_time >= $2 AND ats.start_time <= $3
           AND (ats.duration_minutes >= $4 OR ats.duration_minutes IS NULL)
           AND EXTRACT(DOW FROM ats.start_time AT TIME ZONE ${tz}) = EXTRACT(DOW FROM $5::timestamptz AT TIME ZONE ${tz})
           AND EXTRACT(HOUR FROM ats.start_time AT TIME ZONE ${tz}) = EXTRACT(HOUR FROM $5::timestamptz AT TIME ZONE ${tz})
           AND EXTRACT(MINUTE FROM ats.start_time AT TIME ZONE ${tz}) = EXTRACT(MINUTE FROM $5::timestamptz AT TIME ZONE ${tz})${assignedProviderId ? ` AND ats.user_id = $6` : ''}
           ORDER BY ats.start_time ASC LIMIT 1
           FOR UPDATE SKIP LOCKED`;
        slotResult = await pool.query(sql1, paramsWithProvider([suggestedStart]));
        if (slotResult.rows.length === 0) {
          const sql2 = `SELECT id FROM available_time_slots ats
             WHERE state = 'free' AND (ats.slot_purpose = $1 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
             AND ats.start_time >= $2 AND ats.start_time <= $3
             AND (ats.duration_minutes >= $4 OR ats.duration_minutes IS NULL)${assignedProviderId ? ` AND ats.user_id = $5` : ''}
             ORDER BY ats.start_time ASC LIMIT 1
             FOR UPDATE SKIP LOCKED`;
          slotResult = await pool.query(sql2, paramsWithProvider([]));
        }
      } else {
        const sql3 = `SELECT id FROM available_time_slots ats
           WHERE state = 'free' AND (ats.slot_purpose = $1 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
           AND ats.start_time >= $2 AND ats.start_time <= $3
           AND (ats.duration_minutes >= $4 OR ats.duration_minutes IS NULL)${assignedProviderId ? ` AND ats.user_id = $5` : ''}
           ORDER BY ats.start_time ASC LIMIT 1
           FOR UPDATE SKIP LOCKED`;
        slotResult = await pool.query(sql3, paramsWithProvider([]));
      }

      if (slotResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return {
          ok: false,
          status: 404,
          error: assignedProviderId
            ? 'Nincs szabad időpont a kijelölt orvosnál a megadott ablakban'
            : 'Nincs szabad időpont a megadott ablakban',
        };
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
    if (assignedProviderId && slot.user_id !== assignedProviderId) {
      await pool.query('ROLLBACK');
      return { ok: false, status: 403, error: 'Csak a kijelölt orvoshoz adható időpont.' };
    }
    if (slot.state !== 'free') {
      await pool.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Az időpont már nem szabad' };
    }

    // Reserve slot immediately so same batch won't pick it again (avoids duplicate key on time_slot_id)
    await pool.query(
      `UPDATE available_time_slots SET state = 'booked', status = 'booked' WHERE id = $1`,
      [slotId]
    );

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

    const existingAppt = await pool.query(
      `SELECT 1 FROM appointments WHERE time_slot_id = $1 LIMIT 1`,
      [slotId]
    );
    if (existingAppt.rows.length > 0) {
      await pool.query('ROLLBACK');
      return { ok: false, status: 409, error: 'A slot már másik foglaláshoz tartozik (verseny); kihagyva.' };
    }

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
