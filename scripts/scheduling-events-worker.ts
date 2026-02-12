#!/usr/bin/env npx ts-node
/**
 * Scheduling events worker: consume scheduling_events outbox, refresh episode_next_step_cache.
 * Run via cron every 1-5 minutes.
 */

import { getDbPool } from '../lib/db';
import { refreshEpisodeNextStepCache, resolveEpisodeIdFromEvent } from '../lib/refresh-episode-next-step-cache';

const BATCH_SIZE = 50;

async function runWorker(): Promise<void> {
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT id, entity_type, entity_id, event_type 
     FROM scheduling_events 
     WHERE processed_at IS NULL 
     ORDER BY created_at ASC 
     LIMIT $1`,
    [BATCH_SIZE]
  );

  const events = result.rows;
  if (events.length === 0) {
    return;
  }

  const processedIds: string[] = [];

  for (const ev of events) {
    try {
      const episodeId = await resolveEpisodeIdFromEvent(pool, ev.entity_type, ev.entity_id);
      if (episodeId) {
        await refreshEpisodeNextStepCache(episodeId);
      }
    } catch (err) {
      console.error(`[scheduling-events-worker] Error processing event ${ev.id}:`, err);
    }
    processedIds.push(ev.id);
  }

  if (processedIds.length > 0) {
    await pool.query(
      `UPDATE scheduling_events SET processed_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`,
      [processedIds]
    );
  }
}

runWorker()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[scheduling-events-worker] Fatal error:', err);
    process.exit(1);
  });
