import type { Pool, PoolClient } from 'pg';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export class DeceasedPatientEpisodeError extends Error {
  readonly code = 'DECEASED_PATIENT_EPISODE_FORBIDDEN';

  constructor() {
    super('Elhunyt beteghez nem nyitható új ellátási epizód.');
    this.name = 'DeceasedPatientEpisodeError';
  }
}
export function isDeceasedPatientEpisodeError(error: unknown): error is DeceasedPatientEpisodeError {
  return error instanceof DeceasedPatientEpisodeError
    || (typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'DECEASED_PATIENT_EPISODE_FORBIDDEN');
}

/**
 * Halálozás rögzítésekor az ellátási és recall-ütemezési állapot atomikus lezárása.
 * A műveletek idempotensek, ezért a DB-triggerrel együtt is biztonságosan futnak.
 */
export async function closePatientCareOnDeath(
  db: Queryable,
  patientId: string,
): Promise<{ episodesClosed: number; tasksCompleted: number; intentsExpired: number }> {
  const episodes = await db.query(
    `UPDATE patient_episodes
        SET status = 'closed',
            closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)
      WHERE patient_id = $1
        AND status = 'open'
      RETURNING id`,
    [patientId],
  );

  const tasks = await db.query(
    `UPDATE episode_tasks et
        SET completed_at = COALESCE(et.completed_at, CURRENT_TIMESTAMP)
       FROM patient_episodes pe
      WHERE et.episode_id = pe.id
        AND pe.patient_id = $1
        AND et.completed_at IS NULL
      RETURNING et.id`,
    [patientId],
  );

  const intents = await db.query(
    `UPDATE slot_intents si
        SET state = 'expired', updated_at = CURRENT_TIMESTAMP
       FROM patient_episodes pe
      WHERE si.episode_id = pe.id
        AND pe.patient_id = $1
        AND si.state = 'open'
      RETURNING si.id`,
    [patientId],
  );

  return {
    episodesClosed: episodes.rowCount ?? episodes.rows.length,
    tasksCompleted: tasks.rowCount ?? tasks.rows.length,
    intentsExpired: intents.rowCount ?? intents.rows.length,
  };
}
