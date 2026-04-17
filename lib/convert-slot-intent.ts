/**
 * Shared logic: convert a single open slot_intent to a hard appointment.
 * Used by POST /api/slot-intents/[id]/convert and POST /api/episodes/[id]/convert-all-intents.
 * Batch convert (skipOneHardNext) sets is_chain_reservation on work appointments so multiple future
 * work slots are allowed without requires_precommit workarounds; one-hard-next is skipped in that path.
 */

import { Pool, type PoolClient } from 'pg';
import { checkOneHardNext, getAppointmentRiskSettings } from '@/lib/scheduling-service';
import type { AuthPayload } from '@/lib/auth-server';
import { normalizePathwayWorkPhaseArray } from '@/lib/pathway-work-phases-for-episode';
import { isSchedulerUsePlanItemsEnabled } from '@/lib/plan-items-flags';

export interface ConvertIntentOptions {
  /** Pre-selected time slot id; if not set, a free slot is found in the window */
  timeSlotId?: string;
  /** When true, skip one-hard-next check (used by batch convert) */
  skipOneHardNext?: boolean;
  /**
   * Batch chain: earliest allowed slot start (typically prevActualStart + (currSuggested - prevSuggested)).
   * Prevents stacking all steps on the same day when pathway windows are stale (all in the past).
   */
  chainMinStartTime?: Date;
}

export interface ConvertIntentResult {
  ok: true;
  appointmentId: string;
  intentId: string;
  /** Booked slot start (same transaction); use for batch chain anchors without a follow-up read. */
  startTime: Date;
}

export interface ConvertIntentError {
  ok: false;
  status: number;
  error: string;
  code?: string;
  overrideHint?: string;
}

export type ConvertIntentOutcome = ConvertIntentResult | ConvertIntentError;

function isRetriableLockError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  if (err?.code === '40P01') return true;
  if (err?.code === '40001') return true;
  if (
    err?.code === '57014' &&
    typeof err?.message === 'string' &&
    err.message.includes('while locking tuple')
  ) {
    return true;
  }
  return false;
}

async function pickNearestFreeSlot(
  client: PoolClient,
  args: {
    pool: string;
    lowerBound: Date;
    durationMinutes: number;
    assignedProviderId: string | null;
  }
): Promise<{ rows: Array<{ id: string }> }> {
  const { pool, lowerBound, durationMinutes, assignedProviderId } = args;
  const nearestParams: unknown[] = [pool, lowerBound.toISOString(), durationMinutes];
  let provClause = '';
  if (assignedProviderId) {
    nearestParams.push(assignedProviderId);
    provClause = ' AND ats.user_id = $4';
  }
  return client.query(
    `SELECT id FROM available_time_slots ats
     WHERE state = 'free' AND (ats.slot_purpose = $1 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
     AND ats.start_time >= $2::timestamptz
     AND (ats.duration_minutes >= $3 OR ats.duration_minutes IS NULL)${provClause}
     ORDER BY ats.start_time ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
    nearestParams
  );
}

/**
 * Convert one open slot_intent to an appointment. Runs in its own transaction.
 * Slot search lower bound uses max(now, window_start, suggested_start, optional chainMinStartTime).
 * chainMinStartTime (batch) preserves pathway spacing when windows are stale.
 */
export async function convertIntentToAppointment(
  pool: Pool,
  intentId: string,
  auth: AuthPayload,
  options: ConvertIntentOptions = {}
): Promise<ConvertIntentOutcome> {
  const { timeSlotId: providedSlotId, skipOneHardNext = false, chainMinStartTime } = options;

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

  for (let attempt = 0; attempt < 3; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const intentLock = await client.query(
        `SELECT id FROM slot_intents WHERE id = $1 AND state = 'open' FOR UPDATE`,
        [intentId]
      );
      if (intentLock.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'Intent nem található vagy már nem open' };
      }

      // Batch convert-all: skip episode row FOR UPDATE — it contends with other requests (UI, appointment-service)
      // and caused statement_timeout (57014) while waiting. Intent + slot rows still serialize this flow.
      const episodeLock = skipOneHardNext
        ? await client.query(`SELECT id FROM patient_episodes WHERE id = $1`, [intent.episode_id])
        : await client.query(`SELECT id FROM patient_episodes WHERE id = $1 FOR UPDATE`, [intent.episode_id]);
      if (episodeLock.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'Epizód nem található' };
      }

      // Guard: refuse to book a step that is already completed/skipped
      try {
        const stepDoneCheck = await client.query(
          `SELECT status FROM episode_work_phases
           WHERE episode_id = $1 AND work_phase_code = $2 AND status IN ('completed', 'skipped')
           LIMIT 1`,
          [intent.episode_id, intent.step_code]
        );
        if (stepDoneCheck.rows.length > 0) {
          await client.query(
            `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [intentId]
          );
          await client.query('COMMIT');
          return { ok: false, status: 409, error: `Lépés már teljesítve/kihagyva: ${intent.step_code}`, code: 'STEP_ALREADY_DONE' };
        }
      } catch {
        /* table may not exist */
      }

      // Guard: refuse to book when same step already has a non-cancelled appointment
      const existingStepAppt = await client.query(
        `SELECT 1 FROM appointments
         WHERE episode_id = $1 AND step_code = $2
           AND (appointment_status IS NULL OR appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
         LIMIT 1`,
        [intent.episode_id, intent.step_code]
      );
      if (existingStepAppt.rows.length > 0) {
        await client.query(
          `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [intentId]
        );
        await client.query('COMMIT');
        return { ok: false, status: 409, error: `Lépéshez már van aktív foglalás: ${intent.step_code}`, code: 'STEP_ALREADY_BOOKED' };
      }

      let requiresPrecommit = false;
      if (intent.pool === 'work') {
        const pathwayResult = await client.query(
          `SELECT cp.work_phases_json, cp.steps_json FROM patient_episodes pe
           JOIN care_pathways cp ON pe.care_pathway_id = cp.id
           WHERE pe.id = $1`,
          [intent.episode_id]
        );
        const prow = pathwayResult.rows[0];
        const steps =
          normalizePathwayWorkPhaseArray(prow?.work_phases_json) ??
          normalizePathwayWorkPhaseArray(prow?.steps_json);
        const step = steps?.find((s) => s.work_phase_code === intent.step_code);
        requiresPrecommit = step?.requires_precommit === true;
      }

      const isChainReservation = skipOneHardNext === true && intent.pool === 'work';

      if (!skipOneHardNext) {
        const oneHardNext = await checkOneHardNext(intent.episode_id, intent.pool as 'work' | 'consult' | 'control', {
          requiresPrecommit,
          stepCode: intent.step_code,
        });
        if (!oneHardNext.allowed) {
          await client.query('ROLLBACK');
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
        await client.query(
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
        const suggested = intent.suggested_start ? new Date(intent.suggested_start) : null;
        const lowerParts = [Date.now(), windowStart.getTime()];
        if (suggested) lowerParts.push(suggested.getTime());
        if (chainMinStartTime) lowerParts.push(chainMinStartTime.getTime());
        const lowerBound = new Date(Math.max(...lowerParts));

        const baseParams: unknown[] = [intent.pool, lowerBound, windowEnd, intent.duration_minutes];
        if (assignedProviderId) baseParams.push(assignedProviderId);

        const provClause = assignedProviderId ? ` AND ats.user_id = $5` : '';
        const sqlInWindow = `SELECT id FROM available_time_slots ats
             WHERE state = 'free' AND (ats.slot_purpose = $1 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
             AND ats.start_time >= $2 AND ats.start_time <= $3
             AND (ats.duration_minutes >= $4 OR ats.duration_minutes IS NULL)${provClause}
             ORDER BY ats.start_time ASC LIMIT 1
             FOR UPDATE SKIP LOCKED`;

        let slotResult: { rows: Array<{ id: string }> } = await client.query(sqlInWindow, baseParams);

        if (slotResult.rows.length === 0) {
          slotResult = await pickNearestFreeSlot(client, {
            pool: intent.pool,
            lowerBound,
            durationMinutes: intent.duration_minutes,
            assignedProviderId,
          });
        }

        if (slotResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return {
            ok: false,
            status: 404,
            error: assignedProviderId
              ? skipOneHardNext
                ? 'Nincs szabad időpont a kijelölt orvosnál a megadott ablakban'
                : 'Nincs szabad időpont a kijelölt orvosnál (sem az ablakban, sem utána a következő elérhető időpontig)'
              : skipOneHardNext
                ? 'Nincs szabad időpont a megadott ablakban'
                : 'Nincs szabad időpont a megadott ablakban, és nem található megfelelő szabad időpont az ablakon kívül sem',
          };
        }

        slotId = slotResult.rows[0].id;
      }

      const slotCheck = await client.query(
        `SELECT id, start_time, user_id, state FROM available_time_slots WHERE id = $1 FOR UPDATE`,
        [slotId]
      );

      if (slotCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: 'Időpont nem található' };
      }

      const slot = slotCheck.rows[0];
      if (assignedProviderId && slot.user_id !== assignedProviderId) {
        await client.query('ROLLBACK');
        return { ok: false, status: 403, error: 'Csak a kijelölt orvoshoz adható időpont.' };
      }
      if (slot.state !== 'free') {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, error: 'Az időpont már nem szabad' };
      }

      // Reserve slot immediately so same batch won't pick it again (avoids duplicate key on time_slot_id)
      await client.query(
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

      const existingAppt = await client.query(
        `SELECT 1 FROM appointments WHERE time_slot_id = $1 LIMIT 1`,
        [slotId]
      );
      if (existingAppt.rows.length > 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 409, error: 'A slot már másik foglaláshoz tartozik (verseny); kihagyva.' };
      }

      const apptResult = await client.query(
        `INSERT INTO appointments (
          patient_id, episode_id, time_slot_id, created_by, dentist_email, appointment_type,
          pool, duration_minutes, no_show_risk, requires_confirmation, hold_expires_at, created_via, requires_precommit, is_chain_reservation, start_time, end_time,
          slot_intent_id, step_code, step_seq
        )
        SELECT $1, $2, $3, $4, u.email, $5, $6, $7, $8, $9, $10, 'worklist', $11, $12, $13, $14,
               $15, $16, $17
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
          isChainReservation,
          startTime,
          new Date(startTime.getTime() + durationMinutes * 60 * 1000),
          intentId,
          intent.step_code,
          intent.step_seq,
        ]
      );

      const appointmentId = apptResult.rows[0].id;

      if (isSchedulerUsePlanItemsEnabled()) {
        await client.query(
          `UPDATE appointments a SET plan_item_id = pi.id
           FROM episode_plan_items pi
           INNER JOIN episode_work_phases ewp ON ewp.id = pi.legacy_episode_work_phase_id
           WHERE a.id = $1
             AND ewp.episode_id = $2
             AND ewp.work_phase_code = $3
             AND a.plan_item_id IS NULL
             AND pi.archived_at IS NULL`,
          [appointmentId, intent.episode_id, intent.step_code]
        );
      }

      await client.query(
        `UPDATE slot_intents SET state = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [intentId]
      );

      await client.query('COMMIT');

      return { ok: true, appointmentId, intentId, startTime };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection may already be aborted */
      }
      if (isRetriableLockError(e) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 120 * 2 ** attempt));
        continue;
      }
      throw e;
    } finally {
      client.release();
    }
  }

  return { ok: false, status: 503, error: 'Időpont-konverzió többszöri próbálkozás után sem sikerült (zárolási ütközés). Próbálja újra.' };
}
