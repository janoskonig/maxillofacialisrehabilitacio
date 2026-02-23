/**
 * Intent invalidation: expire open slot_intents when pathway/flags change or episode closes.
 * Call invalidateIntentsForEpisode(episodeId, reason) when:
 * - Episode status changes to closed
 * - care_pathway_id or care_pathway_version changes on episode
 * - assigned_provider_id changes (team attribution)
 */

import { getDbPool } from './db';
import { emitSchedulingEvent } from './scheduling-events';

export type InvalidationReason =
  | 'episode_closed'
  | 'pathway_changed'
  | 'provider_changed'
  | 'stage_changed';

/**
 * Expire all open slot_intents for an episode. Idempotent.
 */
export async function invalidateIntentsForEpisode(
  episodeId: string,
  reason: InvalidationReason
): Promise<number> {
  const db = getDbPool();
  const r = await db.query(
    `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE episode_id = $1 AND state = 'open'
     RETURNING id`,
    [episodeId]
  );
  const count = r.rowCount ?? 0;
  if (count > 0 && reason !== 'episode_closed') {
    try {
      await emitSchedulingEvent('episode', episodeId, 'REPROJECT_INTENTS');
    } catch {
      // Non-blocking
    }
  }
  return count;
}

/**
 * Expire open intents for multiple episodes (e.g. when closing all open episodes for a patient).
 */
export async function invalidateIntentsForEpisodes(
  episodeIds: string[],
  reason: InvalidationReason
): Promise<number> {
  if (episodeIds.length === 0) return 0;
  const db = getDbPool();
  const r = await db.query(
    `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE episode_id = ANY($1::uuid[]) AND state = 'open'
     RETURNING id`,
    [episodeIds]
  );
  return r.rowCount ?? 0;
}
