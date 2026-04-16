import type { Pool } from 'pg';

/**
 * SQL for episode_id + step_code rows used to mark "booked" steps in the next-step engine.
 * When READ_PLAN_ITEMS is on, plan-linked appointments contribute work_phase_code via episode_work_phases.appointment_id.
 */
export function sqlAppointmentStepCodesCompleted(readPlanItems: boolean): string {
  if (!readPlanItems) {
    return `SELECT a.episode_id, a.step_code
       FROM appointments a
       WHERE a.episode_id = ANY($1)
         AND a.step_code IS NOT NULL
         AND a.appointment_status = 'completed'`;
  }
  return `SELECT episode_id, step_code FROM (
    SELECT a.episode_id, a.step_code
    FROM appointments a
    WHERE a.episode_id = ANY($1)
      AND a.step_code IS NOT NULL
      AND a.appointment_status = 'completed'
      AND a.plan_item_id IS NULL
    UNION ALL
    SELECT a.episode_id, ewp.work_phase_code AS step_code
    FROM appointments a
    INNER JOIN episode_work_phases ewp ON ewp.appointment_id = a.id
    WHERE a.episode_id = ANY($1)
      AND a.appointment_status = 'completed'
      AND a.plan_item_id IS NOT NULL
  ) appt_steps`;
}

export function sqlAppointmentStepCodesActive(readPlanItems: boolean): string {
  if (!readPlanItems) {
    return `SELECT a.episode_id, a.step_code
       FROM appointments a
       WHERE a.episode_id = ANY($1)
         AND a.step_code IS NOT NULL
         AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))`;
  }
  return `SELECT episode_id, step_code FROM (
    SELECT a.episode_id, a.step_code
    FROM appointments a
    WHERE a.episode_id = ANY($1)
      AND a.step_code IS NOT NULL
      AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
      AND a.plan_item_id IS NULL
    UNION ALL
    SELECT a.episode_id, ewp.work_phase_code AS step_code
    FROM appointments a
    INNER JOIN episode_work_phases ewp ON ewp.appointment_id = a.id
    WHERE a.episode_id = ANY($1)
      AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
      AND a.plan_item_id IS NOT NULL
  ) appt_steps`;
}

/** Future bookings: effective step_code for matching worklist rows (ewp wins when plan-linked). */
export function sqlBookedFutureAppointmentsWithEffectiveStep(): string {
  return `SELECT a.id, a.episode_id,
          COALESCE(ewp.work_phase_code, a.step_code) AS step_code,
          a.step_seq,
          COALESCE(a.start_time, ats.start_time) AS effective_start,
          a.dentist_email
   FROM appointments a
   JOIN available_time_slots ats ON a.time_slot_id = ats.id
   LEFT JOIN episode_work_phases ewp ON ewp.appointment_id = a.id
   WHERE a.episode_id = ANY($1)
     AND COALESCE(a.start_time, ats.start_time) > CURRENT_TIMESTAMP
     AND (a.appointment_status IS NULL OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient', 'no_show'))`;
}

/** Row: plan item materialized from an episode_work_phase, optional linked appointment (appointments.plan_item_id). */
export type PlanItemAppointmentLinkRow = {
  planItemId: string;
  legacyEpisodeWorkPhaseId: string;
  episodeId: string;
  appointmentId: string | null;
  startTime: string | null;
  appointmentStatus: string | null;
};

type Queryable = Pick<Pool, 'query'>;

/**
 * Load plan items keyed by legacy episode_work_phases.id for timeline-style dedupe.
 * Only rows with legacy_episode_work_phase_id set participate (pathway-materialized / backfill).
 */
export async function loadPlanItemLinksByLegacyEwp(
  pool: Queryable,
  episodeIds: string[]
): Promise<Map<string, PlanItemAppointmentLinkRow>> {
  if (episodeIds.length === 0) {
    return new Map();
  }
  const res = await pool.query(
    `SELECT pi.id AS "planItemId",
            pi.legacy_episode_work_phase_id AS "legacyEpisodeWorkPhaseId",
            pi.episode_id AS "episodeId",
            a.id AS "appointmentId",
            a.start_time AS "startTime",
            a.appointment_status AS "appointmentStatus"
     FROM episode_plan_items pi
     LEFT JOIN appointments a ON a.plan_item_id = pi.id
     WHERE pi.episode_id = ANY($1::uuid[])
       AND pi.archived_at IS NULL
       AND pi.legacy_episode_work_phase_id IS NOT NULL`,
    [episodeIds]
  );
  const map = new Map<string, PlanItemAppointmentLinkRow>();
  for (const row of res.rows as PlanItemAppointmentLinkRow[]) {
    map.set(row.legacyEpisodeWorkPhaseId, row);
  }
  return map;
}
