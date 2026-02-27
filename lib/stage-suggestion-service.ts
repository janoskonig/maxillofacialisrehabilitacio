/**
 * Stage suggestion service: compute, persist (UPSERT), dismiss, and query stage suggestions.
 * Handles dedupe + TTL logic so dismissed suggestions don't re-appear.
 */

import { getDbPool } from './db';
import { computeStageSuggestion, type ReducerResult } from './stage-reducer';
import type { StageSuggestion } from './types';

function rowToSuggestion(row: Record<string, unknown>): StageSuggestion {
  return {
    id: row.id as string,
    episodeId: (row.episode_id ?? row.episodeId) as string,
    suggestedStage: (row.suggested_stage ?? row.suggestedStage) as string,
    fromStage: (row.from_stage ?? row.fromStage) as string | null,
    rulesetVersion: (row.ruleset_version ?? row.rulesetVersion) as number,
    snapshotVersion: (row.snapshot_version ?? row.snapshotVersion) as number,
    dedupeKey: (row.dedupe_key ?? row.dedupeKey) as string,
    ruleIds: (row.rule_ids ?? row.ruleIds) as string[],
    computedAt: ((row.computed_at ?? row.computedAt) as Date)?.toISOString?.() ??
      String(row.computed_at ?? row.computedAt),
  };
}

/**
 * Check if a suggestion with this dedupe key was recently dismissed (within TTL).
 */
async function isDismissed(
  pool: ReturnType<typeof getDbPool>,
  episodeId: string,
  dedupeKey: string
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM dismissed_stage_suggestions
     WHERE episode_id = $1 AND dedupe_key = $2 AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [episodeId, dedupeKey]
  );
  return r.rows.length > 0;
}

/**
 * Compute suggestion, check dedupe/dismiss, persist if new.
 * Returns the suggestion or null if no suggestion / dismissed.
 */
export async function computeAndPersistSuggestion(
  episodeId: string
): Promise<StageSuggestion | null> {
  const result = await computeStageSuggestion(episodeId);
  if (!result || !result.suggestedStage) return null;

  const pool = getDbPool();

  const dismissed = await isDismissed(pool, episodeId, result.dedupeKey);
  if (dismissed) return null;

  const upserted = await pool.query(
    `INSERT INTO stage_suggestions (episode_id, suggested_stage, from_stage, ruleset_version, snapshot_version, dedupe_key, rule_ids, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     ON CONFLICT (episode_id) DO UPDATE SET
       suggested_stage = EXCLUDED.suggested_stage,
       from_stage = EXCLUDED.from_stage,
       ruleset_version = EXCLUDED.ruleset_version,
       snapshot_version = EXCLUDED.snapshot_version,
       dedupe_key = EXCLUDED.dedupe_key,
       rule_ids = EXCLUDED.rule_ids,
       computed_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      episodeId,
      result.suggestedStage,
      result.fromStage,
      result.rulesetVersion,
      result.snapshotVersion,
      result.dedupeKey,
      result.matchedRuleIds,
    ]
  );

  await pool.query(
    `INSERT INTO episode_stage_suggestion_log (episode_id, suggested_stage, from_stage, ruleset_version, snapshot_version, dedupe_key, rule_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      episodeId,
      result.suggestedStage,
      result.fromStage,
      result.rulesetVersion,
      result.snapshotVersion,
      result.dedupeKey,
      result.matchedRuleIds,
    ]
  );

  return upserted.rows[0] ? rowToSuggestion(upserted.rows[0]) : null;
}

/**
 * Get current suggestion for episode (from stage_suggestions table).
 */
export async function getCurrentSuggestion(
  episodeId: string
): Promise<StageSuggestion | null> {
  const pool = getDbPool();
  try {
    const r = await pool.query(
      `SELECT * FROM stage_suggestions WHERE episode_id = $1`,
      [episodeId]
    );
    if (r.rows.length === 0) return null;

    const suggestion = rowToSuggestion(r.rows[0]);

    const dismissed = await isDismissed(pool, episodeId, suggestion.dedupeKey);
    if (dismissed) return null;

    return suggestion;
  } catch (e) {
    const err = e as { code?: string };
    if (err?.code === '42P01') return null; // table does not exist yet
    throw e;
  }
}

/**
 * Dismiss a suggestion (user clicks "dismiss" on modal).
 * Inserts into dismissed_stage_suggestions with TTL.
 */
export async function dismissSuggestion(
  episodeId: string,
  dedupeKey: string,
  dismissedBy: string,
  ttlDays: number = 14
): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO dismissed_stage_suggestions (episode_id, dedupe_key, dismissed_by, expires_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP + make_interval(days => $4))
     ON CONFLICT DO NOTHING`,
    [episodeId, dedupeKey, dismissedBy, ttlDays]
  );
}

/**
 * Clear suggestion for episode (after stage transition is accepted).
 */
export async function clearSuggestion(episodeId: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `DELETE FROM stage_suggestions WHERE episode_id = $1`,
    [episodeId]
  );
}

/**
 * Bump snapshot_version for episode (called when relevant data changes).
 */
export async function bumpSnapshotVersion(episodeId: string): Promise<number> {
  const pool = getDbPool();
  const r = await pool.query(
    `UPDATE patient_episodes SET snapshot_version = snapshot_version + 1 WHERE id = $1 RETURNING snapshot_version`,
    [episodeId]
  );
  return r.rows[0]?.snapshot_version ?? 0;
}
