/**
 * Recall tasks: when episode reaches STAGE_6 (delivery), create episode_tasks for recalls.
 * Recalls book into control pool only.
 */

import { getDbPool } from './db';

const RECALL_SCHEDULE_DAYS = [180, 365]; // 6 months, 12 months

/**
 * Create recall_due episode_tasks when episode transitions to STAGE_6.
 * Called after stage_event insert.
 */
export async function ensureRecallTasksForEpisode(episodeId: string): Promise<number> {
  const pool = getDbPool();

  const episodeResult = await pool.query(
    `SELECT pe.id, pe.care_pathway_id FROM patient_episodes pe
     WHERE pe.id = $1`,
    [episodeId]
  );
  if (episodeResult.rows.length === 0) return 0;

  const pathwayResult = episodeResult.rows[0].care_pathway_id
    ? await pool.query(
        `SELECT steps_json FROM care_pathways WHERE id = $1`,
        [episodeResult.rows[0].care_pathway_id]
      )
    : { rows: [] };

  const steps = pathwayResult.rows[0]?.steps_json as Array<{ step_code: string; pool: string; default_days_offset?: number }> | null;
  const controlSteps = steps?.filter((s) => s.pool === 'control').sort((a, b) => (a.default_days_offset ?? 0) - (b.default_days_offset ?? 0));
  const recallDays = controlSteps?.map((s) => s.default_days_offset ?? 180).slice(0, 2) ?? RECALL_SCHEDULE_DAYS;

  const existing = await pool.query(
    `SELECT task_type FROM episode_tasks WHERE episode_id = $1 AND task_type = 'recall_due'`,
    [episodeId]
  );
  if (existing.rows.length > 0) return 0;

  let created = 0;
  for (const days of recallDays) {
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + days);
    const exists = await pool.query(
      `SELECT 1 FROM episode_tasks WHERE episode_id = $1 AND task_type = 'recall_due' AND ABS(EXTRACT(EPOCH FROM (due_at - $2::timestamptz))) < 86400`,
      [episodeId, dueAt]
    );
    if (exists.rows.length === 0) {
      await pool.query(
        `INSERT INTO episode_tasks (episode_id, task_type, due_at) VALUES ($1, 'recall_due', $2)`,
        [episodeId, dueAt]
      );
      created++;
    }
  }
  return created;
}
