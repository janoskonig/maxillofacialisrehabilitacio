/**
 * Scheduling events outbox: emit events on state changes.
 * Worker consumes and updates episode_next_step_cache.
 */

import { getDbPool } from './db';

export type SchedulingEntityType = 'episode' | 'stage' | 'block' | 'team' | 'appointment';

/**
 * Emit a scheduling event. Call after writes to episode, stage, block, team, or appointment.
 */
export async function emitSchedulingEvent(
  entityType: SchedulingEntityType,
  entityId: string,
  eventType: string
): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO scheduling_events (entity_type, entity_id, event_type) VALUES ($1, $2, $3)`,
    [entityType, entityId, eventType]
  );
}
