import type { Queryable } from './db';
import { getDbPool } from '@/lib/db';

/**
 * WP-4.1b kiegészítő helper — külön fájlban a párhuzamos agent-ágak
 * ütközésének elkerülésére (lásd factories.ts fejkommentje).
 */

/**
 * Az epizód kijelölt felelős orvosának beállítása. Az integrációs tesztekben
 * ezzel szűkítjük a slot-picker keresését a teszt saját providerének
 * slotjaira (`available_time_slots.user_id`), hogy a KÖZÖS maxfac_test DB-n
 * futó testvér-agentek szabad slotjait ne foglaljuk el véletlenül.
 */
export async function assignEpisodeProvider(
  db: Queryable | undefined,
  episodeId: string,
  providerUserId: string
): Promise<void> {
  await (db ?? getDbPool()).query(
    `UPDATE patient_episodes SET assigned_provider_id = $1 WHERE id = $2`,
    [providerUserId, episodeId]
  );
}
