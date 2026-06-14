/**
 * Episode activation: create initial slot_intents when episode is activated
 * (care_pathway_id + assigned_provider_id set).
 * Creates open slot_intents for next 2 work phases — pre-scheduling for governance.
 */

import { getDbPool } from './db';
import { getPathwayWorkPhasesForEpisode } from './pathway-work-phases-for-episode';
import { computeStepWindow } from './step-window';
import { getMergedFilterFragment, probeColumnExists } from './schema-probe';
import {
  selectInitialWorkPhasesFromSteps,
  selectInitialWorkPhasesFromPathway,
  type EpisodeWorkPhaseLite,
  type InitialWorkPhase,
} from './initial-work-phase-selection';

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
 * Load the curated work phases (episode_work_phases) in scheduling order, merged
 * children excluded. Returns null when no plan has been generated yet — that is the
 * signal to fall back to the pathway-template heuristic.
 */
async function getCuratedWorkPhases(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  episodeId: string
): Promise<EpisodeWorkPhaseLite[] | null> {
  const [mergedFilter, hasOffset] = await Promise.all([
    getMergedFilterFragment(pool, 'episode_work_phases'),
    probeColumnExists(pool, 'episode_work_phases', 'default_days_offset'),
  ]);
  const offsetCol = hasOffset ? ', default_days_offset' : '';
  const r = await pool.query(
    `SELECT work_phase_code, pool, duration_minutes, status, pathway_order_index${offsetCol}
     FROM episode_work_phases ewp
     WHERE ewp.episode_id = $1 ${mergedFilter}
     ORDER BY COALESCE(seq, pathway_order_index), pathway_order_index`,
    [episodeId]
  );
  if (r.rows.length === 0) return null;
  return r.rows.map((row: Record<string, unknown>) => ({
    workPhaseCode: String(row.work_phase_code),
    pool: (row.pool as string | null) ?? null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    defaultDaysOffset: row.default_days_offset != null ? Number(row.default_days_offset) : null,
    status: String(row.status),
    pathwayOrderIndex: Number(row.pathway_order_index),
  }));
}

/**
 * Create initial slot_intents for the next 2 work phases when an episode is activated.
 * Idempotent: uses UNIQUE(episode_id, step_code, step_seq) — skips if already exists.
 * (DB column remains step_code; value is the work phase code string.)
 *
 * WP2 (safe slice): prefers the curated plan (episode_work_phases, skip-aware) as the
 * source of truth; only when no plan exists yet does it fall back to the old
 * count-based pathway heuristic.
 */
export async function createInitialSlotIntentsForEpisode(episodeId: string): Promise<number> {
  const pool = getDbPool();

  const [curated, anchor] = await Promise.all([
    getCuratedWorkPhases(pool, episodeId),
    getAnchor(pool, episodeId),
  ]);

  let selected: InitialWorkPhase[];
  if (curated) {
    // Curated plan exists → follow what the doctor actually left to do.
    selected = selectInitialWorkPhasesFromSteps(curated, 2);
  } else {
    // No plan generated yet → fall back to the pathway template by completed count.
    const [pathwayWorkPhases, completedCount] = await Promise.all([
      getPathwayWorkPhasesForEpisode(pool, episodeId),
      getCompletedCount(pool, episodeId),
    ]);
    if (!pathwayWorkPhases || pathwayWorkPhases.length === 0) return 0;
    selected = selectInitialWorkPhasesFromPathway(pathwayWorkPhases, completedCount, 2);
  }

  if (selected.length === 0) return 0;

  let created = 0;
  for (const phase of selected) {
    const { windowStart, windowEnd } = computeStepWindow(anchor, phase.defaultDaysOffset);

    try {
      const result = await pool.query(
        `INSERT INTO slot_intents (episode_id, step_code, step_seq, pool, duration_minutes, window_start, window_end, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
         ON CONFLICT (episode_id, step_code, step_seq) DO NOTHING`,
        [
          episodeId,
          phase.workPhaseCode,
          phase.stepSeq,
          phase.pool,
          phase.durationMinutes,
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
