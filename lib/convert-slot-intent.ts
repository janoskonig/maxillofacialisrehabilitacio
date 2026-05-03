/**
 * Shared logic: convert a single open slot_intent to a hard appointment.
 * Used by POST /api/slot-intents/[id]/convert and POST /api/episodes/[id]/convert-all-intents.
 * Batch convert (skipOneHardNext) sets is_chain_reservation on work appointments so multiple future
 * work slots are allowed without requires_precommit workarounds; one-hard-next is skipped in that path.
 */

import { Pool, type PoolClient } from 'pg';
import { checkOneHardNext, getAppointmentRiskSettings } from '@/lib/scheduling-service';
import { getSchedulingFeatureFlag } from '@/lib/scheduling-feature-flags';
import type { AuthPayload } from '@/lib/auth-server';
import { normalizePathwayWorkPhaseArray } from '@/lib/pathway-work-phases-for-episode';
import { isSchedulerUsePlanItemsEnabled } from '@/lib/plan-items-flags';
import { translateUniqueViolation } from '@/lib/appointment-constraint-errors';
import {
  SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT,
  probeAppointmentsWorkPhaseIdColumn,
} from '@/lib/active-appointment';

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

/**
 * Drift-tolerant slot picker filter (W: bulk-convert robustness).
 *
 * The legacy filter was just `state = 'free'`. That is ALMOST right — but if
 * the slot row was somehow desynced from the appointments table (e.g. a status
 * PATCH set appt to cancelled but the slot.state never got reset, or a manual
 * intervention reset slot.state without touching appointments), we'd pick a
 * "free-looking" slot and the UPSERT would then bounce on the canonical
 * UPSERT WHERE-cancelled filter, surfacing as SLOT_ALREADY_BOOKED for every
 * subsequent intent in the bulk-convert loop (because picker keeps choosing
 * the same drifted slot).
 *
 * The NOT EXISTS clause makes the picker ignore any slot that has an ACTIVE
 * appointment row attached, regardless of `state`. Cancelled rows are still
 * fine — the UPSERT will revive them.
 *
 * The fragment uses the canonical SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT (with
 * alias `a.`) so this stays in sync with the booking guards.
 */
const FREE_SLOT_PREDICATE_SQL = `state = 'free'
     AND NOT EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.time_slot_id = ats.id
          AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
     )`;

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
     WHERE ${FREE_SLOT_PREDICATE_SQL} AND (ats.slot_purpose = $1 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
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

      // Guard: refuse to book when same step already has an active appointment.
      // Uses the canonical SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT so this check
      // matches the worklist's "this step is BOOKED" predicate exactly.
      const existingStepAppt = await client.query(
        `SELECT 1 FROM appointments a
         WHERE a.episode_id = $1 AND a.step_code = $2
           AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
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

      // The one-hard-next invariant is now feature-flagged. When
      // `enforce_one_hard_next` is OFF (default), the check is skipped — both
      // single-intent and bulk paths behave the same. The bulk path's
      // `skipOneHardNext` flag still wins when set, for backward compat.
      if (!skipOneHardNext) {
        const enforceOneHardNext = await getSchedulingFeatureFlag('enforce_one_hard_next');
        if (enforceOneHardNext) {
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

        // lowerBound semantics differ between single-intent and bulk-convert flows.
        //
        // SINGLE-INTENT (skipOneHardNext = false): the intent's projector-derived
        // window_start / suggested_start are reliable — no batched anchor skew —
        // so we use the historical max(now, windowStart, suggested, chainMin).
        //
        // BULK-CONVERT (skipOneHardNext = true): the projector's chained
        // suggested_start values can drift FAR into the future when an earlier
        // booking already moved `lastHardAnchor` forward (e.g. K2 booked for Sep 3
        // pushes EVERY new pending intent to "Sep 3 + accumulated offsets",
        // including Anatómiai lenyomat which logically belongs in May). Honouring
        // the projector-derived anchor here would force the picker past every
        // free slot in May–August, then skip "Nincs szabad slot" or land in
        // December — the symptom the user observed. The user's prescription is:
        //
        //   minimumStartTime = previousScheduledSlot.start + pathwayMinGap
        //
        // — which in this codebase is the explicit `chainMinStartTime` passed by
        // convert-all-intents (computed from `default_days_offset`). For the
        // FIRST intent in a batch chainMinStartTime is undefined, so the floor
        // is just `now` and we pick the earliest free slot regardless of the
        // stale projector window.
        const lowerParts: number[] = [Date.now()];
        if (skipOneHardNext) {
          if (chainMinStartTime) lowerParts.push(chainMinStartTime.getTime());
        } else {
          lowerParts.push(windowStart.getTime());
          if (suggested) lowerParts.push(suggested.getTime());
          if (chainMinStartTime) lowerParts.push(chainMinStartTime.getTime());
        }
        const lowerBound = new Date(Math.max(...lowerParts));

        const baseParams: unknown[] = [intent.pool, lowerBound, windowEnd, intent.duration_minutes];
        if (assignedProviderId) baseParams.push(assignedProviderId);

        const provClause = assignedProviderId ? ` AND ats.user_id = $5` : '';
        // Reuses FREE_SLOT_PREDICATE_SQL so windowed and nearest paths share the
        // same drift-tolerant definition of "free".
        const sqlInWindow = `SELECT id FROM available_time_slots ats
             WHERE ${FREE_SLOT_PREDICATE_SQL} AND (ats.slot_purpose = $1 OR ats.slot_purpose IS NULL OR ats.slot_purpose = 'flexible')
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

      // We intentionally do NOT pre-check for existing appointment rows on this
      // slot. The `appointments_time_slot_id_key` UNIQUE constraint forces a
      // 1:1 link between a slot and its appointment, but cancelled appointment
      // rows ("cancelled_by_doctor" / "cancelled_by_patient") stay in the
      // table after the slot is freed back to `state = 'free'`. The legacy
      // diagnostic at `database/legacy/migration_fix_cancelled_appointments_rebooking.sql`
      // documents exactly this drift.
      //
      // The single-slot booking path in `lib/appointment-service.ts` handles
      // this via INSERT ... ON CONFLICT (time_slot_id) DO UPDATE ... WHERE
      // appointment_status IN (cancelled). We mirror that here so
      // "Összes szükséges időpont lefoglalása" can re-use slots that only
      // carry a stale cancelled row. Slots that carry an ACTIVE row will fall
      // through with no rows in RETURNING — we surface that as
      // SLOT_ALREADY_BOOKED.

      const dentistRes = await client.query(
        `SELECT u.email FROM available_time_slots ats JOIN users u ON ats.user_id = u.id WHERE ats.id = $1`,
        [slotId]
      );
      const dentistEmail: string = dentistRes.rows[0]?.email ?? '';

      // Migration 025: include work_phase_id when the column exists. The intent's
      // own work_phase_id wins; if absent, fall back to the unambiguous lookup
      // via (episode_id, step_code).
      //
      // FAIL-FAST policy (W4 plan §4): the fallback only succeeds with EXACTLY
      // 1 candidate. 0 candidates means the intent points at a step that has
      // no episode_work_phases row (data drift); >1 means the (episode_id,
      // work_phase_code) is ambiguous (e.g. tooth-treatment merge collisions).
      // Both are bugs the operator must resolve via the
      // /api/admin/booking-consistency report — silently writing NULL would
      // disable the canonical unique-index protection on the new appointment.
      const hasWorkPhaseIdColumn = await probeAppointmentsWorkPhaseIdColumn(pool);
      let resolvedWorkPhaseId: string | null = null;
      if (hasWorkPhaseIdColumn) {
        const intentWorkPhaseId = (intent as { work_phase_id?: string | null }).work_phase_id ?? null;
        if (intentWorkPhaseId) {
          resolvedWorkPhaseId = intentWorkPhaseId;
        } else {
          const candidatesRes = await client.query(
            `SELECT id FROM episode_work_phases
             WHERE episode_id = $1 AND work_phase_code = $2
               AND (
                 -- Skip merged-into children when the column exists; they'd
                 -- duplicate the primary phase artificially.
                 NOT EXISTS (
                   SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
                     AND column_name = 'merged_into_episode_work_phase_id'
                 )
                 OR merged_into_episode_work_phase_id IS NULL
               )`,
            [intent.episode_id, intent.step_code]
          );
          if (candidatesRes.rows.length === 1) {
            resolvedWorkPhaseId = candidatesRes.rows[0].id;
          } else {
            await client.query('ROLLBACK');
            const candidateIds = candidatesRes.rows.map((r: { id: string }) => r.id);
            const code =
              candidatesRes.rows.length === 0
                ? 'WORK_PHASE_LOOKUP_NO_CANDIDATE'
                : 'WORK_PHASE_LOOKUP_AMBIGUOUS';
            const error =
              candidatesRes.rows.length === 0
                ? `Nem található munkafázis az intenthez: ${intent.step_code} (epizód: ${intent.episode_id}). Az adatkonzisztenciát ellenőrizd: /api/admin/booking-consistency.`
                : `Több munkafázis-jelölt található (${candidatesRes.rows.length} db) erre az intentre: ${intent.step_code} (epizód: ${intent.episode_id}). Csak a /api/admin/booking-consistency listán szereplő duplikációk kézi rendezése után konvertálhatod. Jelöltek: ${candidateIds.join(', ')}`;
            return { ok: false, status: 409, error, code };
          }
        }
      }

      const insertColumns = [
        'patient_id', 'episode_id', 'time_slot_id', 'created_by', 'dentist_email', 'appointment_type',
        'pool', 'duration_minutes', 'no_show_risk', 'requires_confirmation', 'hold_expires_at', 'created_via',
        'requires_precommit', 'is_chain_reservation', 'start_time', 'end_time',
        'slot_intent_id', 'step_code', 'step_seq',
      ];
      const insertValues: Array<string | number | boolean | Date | null> = [
        intent.patientId,
        intent.episode_id,
        slotId,
        auth.email,
        dentistEmail,
        appointmentType,
        intent.pool,
        durationMinutes,
        noShowRisk,
        requiresConfirmation,
        holdExpiresAt,
        'worklist',
        requiresPrecommit,
        isChainReservation,
        startTime,
        new Date(startTime.getTime() + durationMinutes * 60 * 1000),
        intentId,
        intent.step_code,
        intent.step_seq,
      ];
      if (hasWorkPhaseIdColumn) {
        insertColumns.push('work_phase_id');
        insertValues.push(resolvedWorkPhaseId);
      }
      const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ');
      // Mirror lib/appointment-service.ts: revive a stale cancelled row on the
      // same slot rather than crashing on the UNIQUE(time_slot_id) constraint.
      // `time_slot_id` is the conflict key so we never re-assign it.
      //
      // The cancelled-status literals are inlined to mirror appointment-service.ts
      // and keep the SQL self-documenting; the canonical TS-side mirror is
      // `CANCELLED_APPOINTMENT_STATUSES` in lib/active-appointment.ts and the
      // unit-test in __tests__/lib/convert-slot-intent-upsert.test.ts asserts
      // these stay in sync.
      const updateAssignments = insertColumns
        .filter((col) => col !== 'time_slot_id')
        .map((col) => `${col} = EXCLUDED.${col}`)
        .join(',\n           ');
      const apptResult = await client.query(
        `INSERT INTO appointments (${insertColumns.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT (time_slot_id)
         DO UPDATE SET
           ${updateAssignments},
           appointment_status = NULL,
           completion_notes = NULL,
           google_calendar_event_id = NULL,
           approved_at = NULL,
           approval_status = NULL,
           approval_token = NULL,
           alternative_time_slot_ids = NULL,
           current_alternative_index = NULL,
           is_late = false
         WHERE appointments.appointment_status IN ('cancelled_by_patient', 'cancelled_by_doctor')
         RETURNING id`,
        insertValues
      );

      if (apptResult.rows.length === 0) {
        // CONFLICT hit but the existing row is ACTIVE (NULL/completed/no_show) —
        // treat as a real slot-already-booked race rather than silently
        // overwriting a live booking.
        await client.query('ROLLBACK');
        // Self-heal (W: bulk-convert robustness): the slot picker handed us
        // a slot whose `state='free'` but in fact carries an active appointment
        // row. After rollback the slot state is back to 'free', which means
        // the next iteration of the bulk-convert loop would pick the SAME
        // drifted slot and bounce again — turning one drift row into a
        // cascade of skipped intents. We patch the state to 'booked' in a
        // separate, best-effort statement so subsequent picker calls skip it
        // (the new FREE_SLOT_PREDICATE_SQL also filters drifted slots, but the
        // self-heal pins the state column to match reality).
        try {
          await pool.query(
            `UPDATE available_time_slots
                SET state = 'booked', status = 'booked'
              WHERE id = $1
                AND state = 'free'
                AND EXISTS (
                  SELECT 1 FROM appointments a
                   WHERE a.time_slot_id = $1
                     AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
                )`,
            [slotId]
          );
        } catch {
          /* non-blocking: drift is logged via SLOT_ALREADY_BOOKED return */
        }
        return {
          ok: false,
          status: 409,
          error: 'A slot már másik foglaláshoz tartozik (verseny); kihagyva.',
          code: 'SLOT_ALREADY_BOOKED',
        };
      }

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
      const translation = translateUniqueViolation(e);
      if (translation) {
        return {
          ok: false,
          status: translation.status,
          error: translation.error,
          code: translation.code,
          overrideHint: translation.hint,
        };
      }
      throw e;
    } finally {
      client.release();
    }
  }

  return { ok: false, status: 503, error: 'Időpont-konverzió többszöri próbálkozás után sem sikerült (zárolási ütközés). Próbálja újra.' };
}
