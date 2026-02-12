/**
 * Calibrate pathway analytics from completed episodes.
 * Computes median/p80 visits, cadence. Run periodically (e.g. weekly).
 * Usage: npx ts-node scripts/calibrate-pathway-analytics.ts
 */

import 'dotenv/config';
import { getDbPool } from '../lib/db';

async function run() {
  const pool = getDbPool();

  const pathwaysResult = await pool.query(`SELECT id FROM care_pathways`);
  for (const row of pathwaysResult.rows) {
    const pathwayId = row.id;

    const statsResult = await pool.query(
      `WITH completed_episodes AS (
         SELECT pe.id,
           (SELECT COUNT(*)::int FROM appointments a WHERE a.episode_id = pe.id AND a.appointment_status = 'completed') as visit_count
         FROM patient_episodes pe
         LEFT JOIN (SELECT DISTINCT ON (episode_id) episode_id, stage_code FROM stage_events ORDER BY episode_id, at DESC) se ON pe.id = se.episode_id
         WHERE pe.care_pathway_id = $1 AND pe.status = 'closed' AND se.stage_code = 'STAGE_6'
       ),
       valid AS (SELECT visit_count FROM completed_episodes WHERE visit_count > 0)
       SELECT
         COUNT(*)::int as n,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY visit_count) as median_visits,
         PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY visit_count) as p80_visits
       FROM valid`,
      [pathwayId]
    );

    const s = statsResult.rows[0];
    if (!s || s.n < 3) continue;

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
      [pathwayId, s.n, s.median_visits, s.p80_visits, medianCadence, p80Cadence]
    );
  }

  console.log('Calibration complete');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
