/**
 * Episode activation: create initial slot_intents when episode is activated
 * (care_pathway_id + assigned_provider_id set).
 * Creates open slot_intents for next 2 work steps — pre-scheduling for governance.
 */

import { getDbPool } from './db';
import type { PathwayStep } from './next-step-engine';

/** Get pathway steps for episode (requires care_pathway_id) */
async function getPathwaySteps(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<PathwayStep[] | null> {
  const r = await pool.query(
    `SELECT cp.steps_json FROM patient_episodes pe
     JOIN care_pathways cp ON pe.care_pathway_id = cp.id
     WHERE pe.id = $1`,
    [episodeId]
  );
  const stepsJson = r.rows[0]?.steps_json;
  if (!stepsJson || !Array.isArray(stepsJson)) return null;
  return stepsJson as PathwayStep[];
}

/** Get anchor date: last completed appointment or opened_at */
async function getAnchor(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<Date> {
  const r = await pool.query(
    `SELECT
       (SELECT MAX(COALESCE(a.start_time, a.created_at)) FROM appointments a
        WHERE a.episode_id = pe.id AND a.appointment_status = 'completed') as last_completed_at,
       pe.opened_at
     FROM patient_episodes pe WHERE pe.id = $1`,
    [episodeId]
  );
  const row = r.rows[0];
  const lastCompleted = row?.last_completed_at ? new Date(row.last_completed_at) : null;
  const openedAt = row?.opened_at ? new Date(row.opened_at) : null;
  return lastCompleted ?? openedAt ?? new Date();
}

/** Get completed appointment count for episode */
async function getCompletedCount(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<number> {
  const r = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM appointments
     WHERE episode_id = $1 AND appointment_status = 'completed'`,
    [episodeId]
  );
  return r.rows[0]?.cnt ?? 0;
}

/**
 * Create initial slot_intents for next 2 work steps when episode is activated.
 * Idempotent: uses UNIQUE(episode_id, step_code, step_seq) — skips if already exists.
 */
export async function createInitialSlotIntentsForEpisode(episodeId: string): Promise<number> {
  const pool = getDbPool();

  const [pathwaySteps, anchor, completedCount] = await Promise.all([
    getPathwaySteps(pool, episodeId),
    getAnchor(pool, episodeId),
    getCompletedCount(pool, episodeId),
  ]);

  if (!pathwaySteps || pathwaySteps.length === 0) return 0;

  // Find next 2 work steps: indices >= completedCount, pool='work'
  const workSteps: { step: PathwayStep; stepSeq: number }[] = [];
  for (let i = completedCount; i < pathwaySteps.length && workSteps.length < 2; i++) {
    const step = pathwaySteps[i];
    if (step.pool === 'work') {
      workSteps.push({ step, stepSeq: i });
    }
  }

  if (workSteps.length === 0) return 0;

  let created = 0;
  for (const { step, stepSeq } of workSteps) {
    const offset = step.default_days_offset ?? 14;
    const duration = step.duration_minutes ?? 30;
    const windowStart = new Date(anchor);
    windowStart.setDate(windowStart.getDate() + Math.max(0, offset - 7));
    const windowEnd = new Date(anchor);
    windowEnd.setDate(windowEnd.getDate() + offset + 14);

    try {
      const result = await pool.query(
        `INSERT INTO slot_intents (episode_id, step_code, step_seq, pool, duration_minutes, window_start, window_end, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
         ON CONFLICT (episode_id, step_code, step_seq) DO NOTHING`,
        [
          episodeId,
          step.step_code,
          stepSeq,
          step.pool,
          duration,
          windowStart.toISOString(),
          windowEnd.toISOString(),
        ]
      );
      if (result.rowCount && result.rowCount > 0) created++;
    } catch (e) {
      // ON CONFLICT DO NOTHING handles duplicate; other errors propagate
      const err = e as { code?: string };
      if (err?.code === '23505') continue; // unique_violation
      throw e;
    }
  }

  return created;
}
