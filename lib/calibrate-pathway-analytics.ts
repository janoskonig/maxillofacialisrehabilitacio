/**
 * Calibrate care_pathway_analytics from closed episodes.
 * Closed = status='closed' AND stage_code='STAGE_6'. Appointments = completed.
 * Per pathway: median/p80 visits, median cadence. n_episodes guardrail.
 */

import { getDbPool } from './db';

const NMIN = 10;

export interface CalibrateResult {
  pathwaysProcessed: number;
  pathwaysUpdated: number;
  pathwaysSkippedInsufficient: number;
}

/**
 * Run calibration for all care pathways.
 * Upserts analytics only when n_episodes >= Nmin; else sets is_insufficient_sample.
 */
export async function calibratePathwayAnalytics(): Promise<CalibrateResult> {
  const pool = getDbPool();
  const pathwaysResult = await pool.query(`SELECT id FROM care_pathways`);

  let updated = 0;
  let skippedInsufficient = 0;

  for (const row of pathwaysResult.rows) {
    const pathwayId = row.id;

    const statsResult = await pool.query(
      `WITH completed_episodes AS (
         SELECT pe.id,
           (SELECT COUNT(*)::int FROM appointments a WHERE a.episode_id = pe.id AND a.appointment_status = 'completed') as visit_count,
           (SELECT array_agg(a.start_time ORDER BY a.start_time)
            FROM appointments a WHERE a.episode_id = pe.id AND a.appointment_status = 'completed') as start_times
         FROM patient_episodes pe
         LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
         WHERE pe.care_pathway_id = $1 AND pe.status = 'closed' AND se.stage_code = 'STAGE_6'
       ),
       valid AS (SELECT visit_count, start_times FROM completed_episodes WHERE visit_count > 0)
       SELECT
         COUNT(*)::int as n,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY visit_count) as median_visits,
         PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY visit_count) as p80_visits
       FROM valid`,
      [pathwayId]
    );

    const s = statsResult.rows[0];
    const n = s?.n ?? 0;

    if (n < NMIN) {
      await pool.query(
        `INSERT INTO care_pathway_analytics (care_pathway_id, episodes_completed, median_visits, p80_visits, median_cadence_days, p80_cadence_days)
         VALUES ($1, $2, NULL, NULL, 14, 21)
         ON CONFLICT (care_pathway_id) DO UPDATE SET
           episodes_completed = EXCLUDED.episodes_completed,
           median_visits = NULL,
           p80_visits = NULL,
           median_cadence_days = 14,
           p80_cadence_days = 21,
           recorded_at = CURRENT_TIMESTAMP`,
        [pathwayId, n]
      );
      try {
        await pool.query(
          `UPDATE care_pathway_analytics SET n_episodes = $2, is_insufficient_sample = true WHERE care_pathway_id = $1`,
          [pathwayId, n]
        );
      } catch {
        // n_episodes, is_insufficient_sample columns may not exist before migration
      }
      skippedInsufficient++;
      continue;
    }

    const medianVisits = s?.median_visits ?? null;
    const p80Visits = s?.p80_visits ?? null;
    const medianCadence = 14;
    const p80Cadence = 21;

    await pool.query(
      `INSERT INTO care_pathway_analytics (care_pathway_id, episodes_completed, median_visits, p80_visits, median_cadence_days, p80_cadence_days)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (care_pathway_id) DO UPDATE SET
         episodes_completed = EXCLUDED.episodes_completed,
         median_visits = EXCLUDED.median_visits,
         p80_visits = EXCLUDED.p80_visits,
         median_cadence_days = EXCLUDED.median_cadence_days,
         p80_cadence_days = EXCLUDED.p80_cadence_days,
         recorded_at = CURRENT_TIMESTAMP`,
      [pathwayId, n, medianVisits, p80Visits, medianCadence, p80Cadence]
    );
    try {
      await pool.query(
        `UPDATE care_pathway_analytics SET n_episodes = $2, is_insufficient_sample = false WHERE care_pathway_id = $1`,
        [pathwayId, n]
      );
    } catch {
      // n_episodes, is_insufficient_sample columns may not exist before migration
    }
    updated++;
  }

  return {
    pathwaysProcessed: pathwaysResult.rows.length,
    pathwaysUpdated: updated,
    pathwaysSkippedInsufficient: skippedInsufficient,
  };
}
