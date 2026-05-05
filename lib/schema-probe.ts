/**
 * Schema-probe cache: olyan oszlop-létezési ellenőrzések ide kerülnek,
 * amelyeket runtime-ban változatlan eredménnyel hívunk minden requestre.
 *
 * Történet: a kódbázis több helye (next-step-engine, slot-intent-projector,
 * step-projections, episode-work-phase-revert-lookup, attempt-outcome,
 * status route — a régebbi inline `NOT EXISTS` subquery-vel) minden
 * requestre futtatott egy `information_schema.columns` query-t, hogy
 * eldöntse, létezik-e az `episode_work_phases.merged_into_episode_work_phase_id`
 * oszlop. Ez:
 *   1. extra round-trip a tranzakciónként
 *   2. inline subquery-ben rontja a query-planner cache-t
 *   3. zsírnyom a forródik DB pool kapcsolatlimitjén
 *
 * A schema runtime-ban nem változik: egy lazy modulszintű cache elég.
 *
 * Mintaként a `lib/active-appointment.ts:probeAppointmentsWorkPhaseIdColumn`
 * már alkalmazza ezt a `appointments.work_phase_id`-re.
 */

import type { Pool, PoolClient } from 'pg';

interface SchemaQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

const cache = new Map<string, boolean>();
const inFlight = new Map<string, Promise<boolean>>();

async function checkColumnExistsRaw(
  db: SchemaQueryable,
  table: string,
  column: string
): Promise<boolean> {
  try {
    const res = await db.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        LIMIT 1`,
      [table, column]
    );
    return res.rows.length > 0;
  } catch {
    // Ha az information_schema query maga is hibázik (pl. permission gond),
    // legbiztonságosabb azt feltételezni, hogy nincs az oszlop — a hívók
    // ilyenkor nem hagyatkoznak rá szűrő-feltételként.
    return false;
  }
}

/**
 * Megnézi, létezik-e a megadott oszlop, és modul-szinten cache-eli az
 * eredményt. A párhuzamos első hívások egy probe-on osztoznak (`inFlight`).
 *
 * Hívók: `getEpisodeWorkPhasesMergedColumnExists()` (tipikus eset).
 */
export async function probeColumnExists(
  db: Pool | PoolClient | SchemaQueryable,
  table: string,
  column: string
): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const probe = checkColumnExistsRaw(db as SchemaQueryable, table, column).then(
    (exists) => {
      cache.set(key, exists);
      inFlight.delete(key);
      return exists;
    }
  );
  inFlight.set(key, probe);
  return probe;
}

/** Convenience: a leggyakoribb használt oszlopra. */
export async function getEpisodeWorkPhasesMergedColumnExists(
  db: Pool | PoolClient | SchemaQueryable
): Promise<boolean> {
  return probeColumnExists(db, 'episode_work_phases', 'merged_into_episode_work_phase_id');
}

/**
 * Visszaadja a `merged_into_episode_work_phase_id` szűrő SQL-fragment-et
 * `episode_work_phases ewp` aliasra értelmezve. Ha az oszlop nem létezik
 * (régi DB), üres stringet ad vissza, így a hívó nyugodtan beleilleszti a
 * WHERE záradékba — nem kell külön elágazást írni.
 *
 *   const filter = await getMergedFilterFragment(pool);  // → 'AND ewp.merged_into_... IS NULL' | ''
 *   const sql = `... WHERE ewp.episode_id = $1 ${filter}`;
 */
export async function getMergedFilterFragment(
  db: Pool | PoolClient | SchemaQueryable,
  alias: string = 'ewp'
): Promise<string> {
  const exists = await getEpisodeWorkPhasesMergedColumnExists(db);
  return exists ? `AND ${alias}.merged_into_episode_work_phase_id IS NULL` : '';
}

/** Csak tesztekhez — a cache reset egy tiszta állapotra. */
export function _resetSchemaProbeCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
