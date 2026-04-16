import type { Pool } from 'pg';

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
