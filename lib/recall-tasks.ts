/**
 * Recall tasks: when episode reaches STAGE_6 (delivery), create episode_tasks for recalls.
 * Recalls book into control pool only.
 *
 * A recall (kontroll) NEM a kezelési terv része — a sablonokból ki lett véve
 * (075_remove_control_steps_from_pathway_templates.sql), így az emlékeztető
 * feladatok ütemezése sem a sablonból jön, hanem fix ütemterv szerint megy.
 * A tényleges időpont a terv-hub „Gyors foglalás” blokkjában foglalható.
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
    `SELECT pe.id,
            (SELECT se.at
               FROM stage_events se
              WHERE se.episode_id = pe.id AND se.stage_code = 'STAGE_6'
              ORDER BY se.at DESC
              LIMIT 1) AS delivery_at
       FROM patient_episodes pe
       JOIN patients p ON p.id = pe.patient_id
      WHERE pe.id = $1
        AND pe.status = 'open'
        AND p.halal_datum IS NULL`,
    [episodeId]
  );
  if (episodeResult.rows.length === 0) return 0;

  const recallDays = RECALL_SCHEDULE_DAYS;
  // Utólag rögzített átadásnál is a klinikai átadás dátumától számoljunk,
  // ne attól a naptól, amikor valaki bepótolta a stádiumbejegyzést.
  const deliveryAt = episodeResult.rows[0].delivery_at
    ? new Date(episodeResult.rows[0].delivery_at)
    : new Date();

  const existing = await pool.query(
    `SELECT task_type FROM episode_tasks WHERE episode_id = $1 AND task_type = 'recall_due'`,
    [episodeId]
  );
  if (existing.rows.length > 0) return 0;

  let created = 0;
  for (const days of recallDays) {
    const dueAt = new Date(deliveryAt);
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
