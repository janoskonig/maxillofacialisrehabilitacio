/**
 * Episode activation: create initial slot_intents when episode is activated
 * (care_pathway_id + assigned_provider_id set).
 * Creates open slot_intents for next 2 work phases — pre-scheduling for governance.
 */

import { getDbPool } from './db';
import type { PathwayWorkPhaseTemplate } from './pathway-work-phases-for-episode';
import { getPathwayWorkPhasesForEpisode } from './pathway-work-phases-for-episode';
import { computeStepWindow } from './step-window';

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
 * Create initial slot_intents for next 2 work phases when episode is activated.
 * Idempotent: uses UNIQUE(episode_id, step_code, step_seq) — skips if already exists.
 * (DB column remains step_code; value is the work phase code string.)
 */
export async function createInitialSlotIntentsForEpisode(episodeId: string): Promise<number> {
  const pool = getDbPool();

  const [pathwayWorkPhases, anchor, completedCount] = await Promise.all([
    getPathwayWorkPhasesForEpisode(pool, episodeId),
    getAnchor(pool, episodeId),
    getCompletedCount(pool, episodeId),
  ]);

  if (!pathwayWorkPhases || pathwayWorkPhases.length === 0) return 0;

  const workPhases: { phase: PathwayWorkPhaseTemplate; stepSeq: number }[] = [];
  for (let i = completedCount; i < pathwayWorkPhases.length && workPhases.length < 2; i++) {
    const phase = pathwayWorkPhases[i];
    if (phase.pool === 'work') {
      workPhases.push({ phase, stepSeq: i });
    }
  }

  if (workPhases.length === 0) return 0;

  let created = 0;
  for (const { phase, stepSeq } of workPhases) {
    const offset = phase.default_days_offset ?? 14;
    const duration = phase.duration_minutes ?? 30;
    const { windowStart, windowEnd } = computeStepWindow(anchor, offset);

    try {
      const result = await pool.query(
        `INSERT INTO slot_intents (episode_id, step_code, step_seq, pool, duration_minutes, window_start, window_end, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
         ON CONFLICT (episode_id, step_code, step_seq) DO NOTHING`,
        [
          episodeId,
          phase.work_phase_code,
          stepSeq,
          phase.pool,
          duration,
          windowStart.toISOString(),
          windowEnd.toISOString(),
        ]
      );
      if (result.rowCount && result.rowCount > 0) created++;
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === '23505') continue;
      throw e;
    }
  }

  return created;
}
