import type { Pool, PoolClient } from 'pg';
import { describeEpisodeBlocks } from './episode-block-taxonomy';

/** Call inside the booking transaction so a stale client cannot bypass an obstacle. */
export async function activeObstacleReason(db: Pool | PoolClient, episodeId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT key, waiting_on FROM episode_blocks WHERE episode_id = $1 AND active = true
     AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
     ORDER BY waiting_since ASC, id`,
    [episodeId]
  );
  return result.rows.length ? describeEpisodeBlocks(result.rows) : null;
}
