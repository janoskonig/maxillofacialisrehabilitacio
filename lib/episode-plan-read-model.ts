import type { Pool } from 'pg';
import { SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT } from './active-appointment';

/** Future bookings: effective step_code for matching worklist rows (ewp wins when plan-linked). */
export function sqlBookedFutureAppointmentsWithEffectiveStep(): string {
  // Visible-status excludes no_show: a múltbeli no_show-t nem akarjuk
  // jövőbeli foglalásként mutatni, akkor sem ha a slot start_time még jövőben van.
  //
  // WP-4.1b: a `work_phase_id` oszlop az identitás-elsődleges párosításhoz —
  // az EWP-oldali link (ewp.appointment_id = a.id) nyer, fallback az
  // appointment saját work_phase_id-je. Duplikált work_phase_code-nál csak
  // ezzel dönthető el, MELYIK fázis foglalása ez.
  //
  // WP-4.2 (review-javítás): összevont (merged) GYEREKHEZ kötött foglalásnál
  // a csoport PRIMARY-jának id-ját adjuk vissza — a lánc-sorok / terv-sorok a
  // gyerekeket kiszűrik (mergedFilter), így a gyerek-id-s párosítás sosem
  // találna; a csoport "egy alkalom", a foglalás a primary sorhoz horgonyoz.
  return `SELECT a.id, a.episode_id,
          COALESCE(ewp.work_phase_code, a.step_code) AS step_code,
          a.step_seq,
          COALESCE(ewp.merged_into_episode_work_phase_id, ewp.id,
                   awp.merged_into_episode_work_phase_id, a.work_phase_id) AS work_phase_id,
          COALESCE(a.start_time, ats.start_time) AS effective_start,
          a.dentist_email
   FROM appointments a
   JOIN available_time_slots ats ON a.time_slot_id = ats.id
   LEFT JOIN episode_work_phases ewp ON ewp.appointment_id = a.id
   LEFT JOIN episode_work_phases awp ON awp.id = a.work_phase_id
   WHERE a.episode_id = ANY($1)
     AND COALESCE(a.start_time, ats.start_time) > CURRENT_TIMESTAMP
     AND ${SQL_APPOINTMENT_VISIBLE_STATUS_FRAGMENT}`;
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
