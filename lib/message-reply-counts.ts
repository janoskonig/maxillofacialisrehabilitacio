import { getDbPool } from './db';

/**
 * Fázis 1.1 — közvetlen válaszok száma üzenetenként (egy batch query).
 * A 041-es partial index (`reply_to_message_id IS NOT NULL`) ezt támogatja.
 */
export async function batchDoctorMessageReplyCounts(
  messageIds: string[],
): Promise<Map<string, number>> {
  if (messageIds.length === 0) return new Map();

  const pool = getDbPool();
  const result = await pool.query<{ parent_id: string; cnt: string }>(
    `SELECT reply_to_message_id AS parent_id, COUNT(*)::int AS cnt
       FROM doctor_messages
      WHERE reply_to_message_id = ANY($1::uuid[])
      GROUP BY reply_to_message_id`,
    [messageIds],
  );

  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.parent_id, Number(row.cnt));
  }
  return map;
}

export async function batchPatientMessageReplyCounts(
  messageIds: string[],
): Promise<Map<string, number>> {
  if (messageIds.length === 0) return new Map();

  const pool = getDbPool();
  const result = await pool.query<{ parent_id: string; cnt: string }>(
    `SELECT reply_to_message_id AS parent_id, COUNT(*)::int AS cnt
       FROM messages
      WHERE reply_to_message_id = ANY($1::uuid[])
      GROUP BY reply_to_message_id`,
    [messageIds],
  );

  const map = new Map<string, number>();
  for (const row of result.rows) {
    map.set(row.parent_id, Number(row.cnt));
  }
  return map;
}

/** Üzenet ID-k a listából + replyCount mező hozzárendelése. */
export function attachReplyCounts<T extends { id: string }>(
  items: T[],
  countMap: Map<string, number>,
): Array<T & { replyCount: number }> {
  return items.map((item) => ({
    ...item,
    replyCount: countMap.get(item.id) ?? 0,
  }));
}
