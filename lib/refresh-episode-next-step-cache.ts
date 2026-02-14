/**
 * Refresh episode_next_step_cache for one or more episodes.
 * Used by scheduling-events worker.
 * G4: BLOCKED_CAPACITY when no free work slot in SLA window.
 */

import { getDbPool } from './db';
import { nextRequiredStep, isBlocked } from './next-step-engine';
import { hasFreeSlotInWindow } from './scheduling-service';

/**
 * Get provider_id for an episode (assigned_provider or primary care team member).
 */
async function getProviderIdForEpisode(pool: Awaited<ReturnType<typeof getDbPool>>, episodeId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT COALESCE(pe.assigned_provider_id, ect.user_id) as provider_id
     FROM patient_episodes pe
     LEFT JOIN episode_care_team ect ON pe.id = ect.episode_id AND ect.is_primary = true
     WHERE pe.id = $1`,
    [episodeId]
  );
  return r.rows[0]?.provider_id ?? null;
}

/**
 * Refresh cache for a single episode.
 */
export async function refreshEpisodeNextStepCache(episodeId: string): Promise<void> {
  const pool = getDbPool();
  const providerId = await getProviderIdForEpisode(pool, episodeId);
  if (!providerId) return;

  const result = await nextRequiredStep(episodeId);

  // G4: For work pool "ready" — check slot availability; if none → BLOCKED_CAPACITY
  if (!isBlocked(result) && result.pool === 'work') {
    const hasSlot = await hasFreeSlotInWindow(
      'work',
      result.earliest_date,
      result.latest_date,
      result.duration_minutes
    );
    if (!hasSlot) {
      await pool.query(
        `INSERT INTO episode_next_step_cache (episode_id, provider_id, pool, duration_minutes, window_start, window_end, step_code, status, blocked_reason, overdue_days, updated_at)
         VALUES ($1, $2, 'work', $3, $4, $5, $6, 'blocked', $7, 0, CURRENT_TIMESTAMP)
         ON CONFLICT (episode_id) DO UPDATE SET
           provider_id = EXCLUDED.provider_id,
           pool = 'work',
           duration_minutes = EXCLUDED.duration_minutes,
           window_start = EXCLUDED.window_start,
           window_end = EXCLUDED.window_end,
           step_code = EXCLUDED.step_code,
           status = 'blocked',
           blocked_reason = EXCLUDED.blocked_reason,
           overdue_days = 0,
           updated_at = CURRENT_TIMESTAMP`,
        [
          episodeId,
          providerId,
          result.duration_minutes,
          result.earliest_date.toISOString(),
          result.latest_date.toISOString(),
          result.step_code,
          'BLOCKED_CAPACITY: Nincs szabad work időpont az SLA ablakban',
        ]
      );
      return;
    }
  }

  if (isBlocked(result)) {
    await pool.query(
      `INSERT INTO episode_next_step_cache (episode_id, provider_id, pool, duration_minutes, window_start, window_end, step_code, status, blocked_reason, overdue_days, updated_at)
       VALUES ($1, $2, 'work', 0, NULL, NULL, NULL, 'blocked', $3, 0, CURRENT_TIMESTAMP)
       ON CONFLICT (episode_id) DO UPDATE SET
         provider_id = EXCLUDED.provider_id,
         pool = 'work',
         duration_minutes = 0,
         window_start = NULL,
         window_end = NULL,
         step_code = NULL,
         status = 'blocked',
         blocked_reason = EXCLUDED.blocked_reason,
         overdue_days = 0,
         updated_at = CURRENT_TIMESTAMP`,
      [episodeId, providerId, result.reason]
    );
    return;
  }

  const now = new Date();
  const overdueDays = result.latest_date < now
    ? Math.ceil((now.getTime() - result.latest_date.getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  await pool.query(
    `INSERT INTO episode_next_step_cache (episode_id, provider_id, pool, duration_minutes, window_start, window_end, step_code, status, blocked_reason, overdue_days, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', NULL, $8, CURRENT_TIMESTAMP)
     ON CONFLICT (episode_id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id,
       pool = EXCLUDED.pool,
       duration_minutes = EXCLUDED.duration_minutes,
       window_start = EXCLUDED.window_start,
       window_end = EXCLUDED.window_end,
       step_code = EXCLUDED.step_code,
       status = 'ready',
       blocked_reason = NULL,
       overdue_days = EXCLUDED.overdue_days,
       updated_at = CURRENT_TIMESTAMP`,
    [
      episodeId,
      providerId,
      result.pool,
      result.duration_minutes,
      result.earliest_date.toISOString(),
      result.latest_date.toISOString(),
      result.step_code,
      overdueDays,
    ]
  );
}

/**
 * Resolve episode_id from a scheduling event.
 */
export async function resolveEpisodeIdFromEvent(
  pool: Awaited<ReturnType<typeof getDbPool>>,
  entityType: string,
  entityId: string
): Promise<string | null> {
  if (entityType === 'episode') return entityId;

  if (entityType === 'appointment') {
    const r = await pool.query('SELECT episode_id FROM appointments WHERE id = $1', [entityId]);
    return r.rows[0]?.episode_id ?? null;
  }

  if (entityType === 'stage') {
    const r = await pool.query('SELECT episode_id FROM stage_events WHERE id = $1', [entityId]);
    return r.rows[0]?.episode_id ?? null;
  }

  if (entityType === 'block') {
    const r = await pool.query('SELECT episode_id FROM episode_blocks WHERE id = $1', [entityId]);
    return r.rows[0]?.episode_id ?? null;
  }

  if (entityType === 'team') {
    const r = await pool.query('SELECT episode_id FROM episode_care_team WHERE id = $1', [entityId]);
    return r.rows[0]?.episode_id ?? null;
  }

  return null;
}
