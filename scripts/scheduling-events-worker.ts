#!/usr/bin/env npx ts-node
/**
 * Scheduling events worker: consume scheduling_events outbox, refresh episode_next_step_cache.
 * Supports REPROJECT_INTENTS event type for demand projection.
 * Run via cron every 1-5 minutes.
 */

import { getDbPool } from '../lib/db';
import { refreshEpisodeNextStepCache } from '../lib/refresh-episode-next-step-cache';
import { refreshEpisodeForecastCache } from '../lib/refresh-episode-forecast-cache';
import { projectRemainingSteps } from '../lib/slot-intent-projector';

const BATCH_SIZE = 50;

async function runWorker(): Promise<void> {
  const pool = getDbPool();

  // JOIN-based resolve: 1 query instead of N+1
  const result = await pool.query(
    `SELECT se.id, se.entity_type, se.entity_id, se.event_type,
      CASE se.entity_type
        WHEN 'episode' THEN se.entity_id
        WHEN 'appointment' THEN (SELECT episode_id FROM appointments WHERE id = se.entity_id)
        WHEN 'stage' THEN (SELECT episode_id FROM stage_events WHERE id = se.entity_id)
        WHEN 'block' THEN (SELECT episode_id FROM episode_blocks WHERE id = se.entity_id)
        WHEN 'team' THEN (SELECT episode_id FROM episode_care_team WHERE id = se.entity_id)
      END AS resolved_episode_id
    FROM scheduling_events se
    WHERE se.processed_at IS NULL
    ORDER BY se.created_at ASC LIMIT $1`,
    [BATCH_SIZE]
  );

  const events = result.rows;
  if (events.length === 0) {
    return;
  }

  // Handle unresolvable events (entity deleted)
  const unresolvedEventIds = events
    .filter((e: { resolved_episode_id: string | null }) => e.resolved_episode_id == null)
    .map((e: { id: string }) => e.id);
  if (unresolvedEventIds.length > 0) {
    console.warn(`[worker] ${unresolvedEventIds.length} events with unresolvable episode, marking processed`);
    await pool.query(
      `UPDATE scheduling_events SET processed_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`,
      [unresolvedEventIds]
    );
  }

  // Group resolvable events by episode_id, track which episodes need reprojection
  const episodeEvents = new Map<string, { eventIds: string[]; hasReproject: boolean }>();
  for (const ev of events) {
    if (!ev.resolved_episode_id) continue;
    const entry = episodeEvents.get(ev.resolved_episode_id) ?? { eventIds: [], hasReproject: false };
    entry.eventIds.push(ev.id);
    if (ev.event_type === 'REPROJECT_INTENTS') {
      entry.hasReproject = true;
    }
    episodeEvents.set(ev.resolved_episode_id, entry);
  }

  // Process per-episode: mark processed ONLY on success
  for (const [episodeId, { eventIds, hasReproject }] of Array.from(episodeEvents.entries())) {
    try {
      await refreshEpisodeNextStepCache(episodeId);
      await refreshEpisodeForecastCache(episodeId);
      if (hasReproject) {
        await projectRemainingSteps(episodeId);
      }
      await pool.query(
        `UPDATE scheduling_events SET processed_at = CURRENT_TIMESTAMP WHERE id = ANY($1)`,
        [eventIds]
      );
    } catch (err) {
      console.error(`[worker] Episode ${episodeId} failed, events NOT marked processed:`, err);
    }
  }
}

runWorker()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[scheduling-events-worker] Fatal error:', err);
    process.exit(1);
  });
