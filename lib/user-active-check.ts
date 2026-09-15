/**
 * Fiók-aktivitás ellenőrzés a JWT-n felül.
 *
 * A JWT 7 napig érvényes, és önmagában nem tudja, hogy az admin időközben
 * inaktiválta-e a fiókot. A `verifyAuth` ezért minden (session-alapú) API-
 * hívásnál megkérdezi, aktív-e még a felhasználó — de nem az adatbázist
 * terhelve kérésenként: felhasználónként rövid TTL-ű, processz-szintű cache
 * ül előtte. Inaktiválás után legfeljebb a TTL-nyi idő múlva zárul le
 * minden élő munkamenet (az inaktiváló kérés a saját processzében azonnal
 * érvényteleníti a bejegyzést).
 *
 * Hibatűrés: ha a lekérdezés elszáll (pl. 53300 too many clients), nem
 * léptetjük ki az egész felhasználótábort — a legutóbbi ismert állapot, ennek
 * híján „aktív" marad a válasz (fail-open). A kérés a saját DB-műveletén
 * úgyis elhasal, ha az adatbázis tényleg nem elérhető.
 */

import { getDbPool } from './db';
import { logger } from './logger';

export const USER_ACTIVE_CACHE_TTL_MS = 30_000;

type CacheEntry = { active: boolean; expiresAt: number };

const cache = new Map<string, CacheEntry>();

export async function isUserActive(
  userId: string,
  opts: { now?: number } = {}
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.active;

  try {
    const result = await getDbPool().query('SELECT active FROM users WHERE id = $1', [userId]);
    const active = result.rows.length > 0 && result.rows[0].active === true;
    cache.set(userId, { active, expiresAt: now + USER_ACTIVE_CACHE_TTL_MS });
    return active;
  } catch (error) {
    logger.error('[user-active-check] A fiók-aktivitás lekérdezése sikertelen, fail-open', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return hit ? hit.active : true;
  }
}

/** Egy felhasználó (vagy paraméter nélkül mindenki) cache-bejegyzésének törlése. */
export function invalidateUserActiveCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/** Tesztekhez: a cache aktuális mérete. */
export function userActiveCacheSize(): number {
  return cache.size;
}
