/**
 * STAGE_6 (átadás) után létrejövő, kezelési tervtől független recall-feladatok.
 * A tényleges időpont a control poolba foglalható.
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from './db';

export const RECALL_SCHEDULE_DAYS = [180, 365] as const;

type Queryable = Pick<Pool | PoolClient, 'query'>;

/** DST-től független, naptári nap alapú recall-határidő. */
export function recallDueAt(deliveryAt: Date, intervalDays: number): Date {
  const dueAt = new Date(deliveryAt);
  dueAt.setUTCDate(dueAt.getUTCDate() + intervalDays);
  return dueAt;
}

/**
 * Idempotensen létrehozza/javítja a 6 és 12 hónapos recall-párt. A határidő
 * alapja a tényleges első STAGE_6 esemény, nem az ensure futási időpontja.
 */
export async function ensureRecallTasksForEpisode(
  episodeId: string,
  db: Queryable = getDbPool(),
): Promise<number> {
  const episodeResult = await db.query(
    `SELECT pe.id, MIN(se.at) AS delivery_at
       FROM patient_episodes pe
       JOIN patients p ON p.id = pe.patient_id
       JOIN stage_events se ON se.episode_id = pe.id AND se.stage_code = 'STAGE_6'
      WHERE pe.id = $1
        AND pe.status = 'open'
        AND p.halal_datum IS NULL
      GROUP BY pe.id`,
    [episodeId],
  );
  if (episodeResult.rows.length === 0 || !episodeResult.rows[0].delivery_at) return 0;

  const deliveryAt = new Date(episodeResult.rows[0].delivery_at);
  const intervals = [...RECALL_SCHEDULE_DAYS];
  const dueDates = intervals.map((days) => recallDueAt(deliveryAt, days));

  // Egyetlen UPSERT: párhuzamos hívásnál sincs duplikáció, félbemaradt régi
  // létrehozásnál pedig a hiányzó pár önjavítóan létrejön. Visszadátumozott
  // átadásnál csak a még nem foglalt/teljesített határidőt korrigáljuk.
  const result = await db.query(
    `INSERT INTO episode_tasks (episode_id, task_type, due_at, recall_interval_days)
     SELECT $1, 'recall_due', due_at, interval_days
       FROM UNNEST($2::int[], $3::timestamptz[]) AS schedule(interval_days, due_at)
     ON CONFLICT (episode_id, recall_interval_days)
       WHERE task_type = 'recall_due' AND recall_interval_days IS NOT NULL
     DO UPDATE SET due_at = EXCLUDED.due_at
       WHERE episode_tasks.completed_at IS NULL
         AND episode_tasks.appointment_id IS NULL
     RETURNING id`,
    [episodeId, intervals, dueDates],
  );

  return result.rowCount ?? result.rows.length;
}
