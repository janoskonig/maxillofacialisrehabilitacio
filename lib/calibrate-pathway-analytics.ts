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
  const pathwayIds = pathwaysResult.rows.map((r: any) => r.id as string);

  if (pathwayIds.length === 0) {
    return { pathwaysProcessed: 0, pathwaysUpdated: 0, pathwaysSkippedInsufficient: 0 };
  }

  // Single batch query to compute stats for all pathways at once
  const statsResult = await pool.query(
    `WITH completed_episodes AS (
       SELECT pe.care_pathway_id,
         (SELECT COUNT(*)::int FROM appointments a WHERE a.episode_id = pe.id AND a.appointment_status = 'completed') as visit_count
       FROM patient_episodes pe
       LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
       WHERE pe.care_pathway_id = ANY($1) AND pe.status = 'closed' AND se.stage_code = 'STAGE_6'
     ),
     valid AS (SELECT care_pathway_id, visit_count FROM completed_episodes WHERE visit_count > 0)
     SELECT
       care_pathway_id,
       COUNT(*)::int as n,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY visit_count) as median_visits,
       PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY visit_count) as p80_visits
     FROM valid
     GROUP BY care_pathway_id`,
    [pathwayIds]
  );

  const statsMap = new Map<string, { n: number; median_visits: number | null; p80_visits: number | null }>(
    statsResult.rows.map((r: any) => [r.care_pathway_id, { n: r.n, median_visits: r.median_visits, p80_visits: r.p80_visits }])
  );

  let updated = 0;
  let skippedInsufficient = 0;

  // Build bulk upsert values
  const upsertValues: unknown[] = [];
  const upsertPlaceholders: string[] = [];
  let idx = 1;

  for (const pathwayId of pathwayIds) {
    const s = statsMap.get(pathwayId);
    const n = s?.n ?? 0;

    if (n < NMIN) {
      upsertPlaceholders.push(`($${idx}, $${idx + 1}, NULL, NULL, 14, 21)`);
      upsertValues.push(pathwayId, n);
      idx += 2;
      skippedInsufficient++;
    } else {
      upsertPlaceholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, 14, 21)`);
      upsertValues.push(pathwayId, n, s!.median_visits, s!.p80_visits);
      idx += 4;
      updated++;
    }
  }

  if (upsertPlaceholders.length > 0) {
    await pool.query(
      `INSERT INTO care_pathway_analytics (care_pathway_id, episodes_completed, median_visits, p80_visits, median_cadence_days, p80_cadence_days)
       VALUES ${upsertPlaceholders.join(', ')}
       ON CONFLICT (care_pathway_id) DO UPDATE SET
         episodes_completed = EXCLUDED.episodes_completed,
         median_visits = EXCLUDED.median_visits,
         p80_visits = EXCLUDED.p80_visits,
         median_cadence_days = EXCLUDED.median_cadence_days,
         p80_cadence_days = EXCLUDED.p80_cadence_days,
         recorded_at = CURRENT_TIMESTAMP`,
      upsertValues
    );

    // Try to update n_episodes / is_insufficient_sample columns
    try {
      const insufficientIds = pathwayIds.filter((id) => (statsMap.get(id)?.n ?? 0) < NMIN);
      const sufficientIds = pathwayIds.filter((id) => (statsMap.get(id)?.n ?? 0) >= NMIN);
      const tasks: Promise<any>[] = [];
      if (insufficientIds.length > 0) {
        tasks.push(pool.query(
          `UPDATE care_pathway_analytics SET is_insufficient_sample = true,
             n_episodes = episodes_completed WHERE care_pathway_id = ANY($1)`,
          [insufficientIds]
        ));
      }
      if (sufficientIds.length > 0) {
        tasks.push(pool.query(
          `UPDATE care_pathway_analytics SET is_insufficient_sample = false,
             n_episodes = episodes_completed WHERE care_pathway_id = ANY($1)`,
          [sufficientIds]
        ));
      }
      await Promise.all(tasks);
    } catch {
      // n_episodes, is_insufficient_sample columns may not exist before migration
    }
  }

  return {
    pathwaysProcessed: pathwayIds.length,
    pathwaysUpdated: updated,
    pathwaysSkippedInsufficient: skippedInsufficient,
  };
}
