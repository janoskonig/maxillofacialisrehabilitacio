/**
 * Intent TTL expiry: auto-expire open slot_intents where expires_at <= now.
 * Run as cron (e.g. daily or every few hours).
 */

import { getDbPool } from './db';

export async function runIntentExpiry(): Promise<{
  expired: number;
  errors: string[];
}> {
  const pool = getDbPool();
  const errors: string[] = [];

  const r = await pool.query(
    `UPDATE slot_intents SET state = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE state = 'open' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
     RETURNING id`,
    []
  );

  const expired = r.rowCount ?? 0;
  return { expired, errors };
}
