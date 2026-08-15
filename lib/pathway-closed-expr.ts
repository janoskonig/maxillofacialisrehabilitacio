/**
 * `pathwayClosed` SQL-kifejezés — a fog-kezelési igény munkafázisa le van-e zárva.
 *
 * Ez a kifejezés **nem konstans**: két `information_schema` próbától függően háromféle
 * alakot vehet fel (nincs `episode_work_phases` tábla / van, de nincs
 * `merged_into_episode_work_phase_id` oszlop / van mindkettő). Aki eddig másolni akarta,
 * a próbákat is kénytelen volt másolni — ezért helper, nem copy-paste.
 *
 * A „le van zárva" fogalom a lezárt igényt jelenti a munkafázis oldaláról: `completed`
 * vagy `skipped`. Összevont (merged) fázisoknál az ELSŐDLEGES fázis státusza dönt.
 *
 * Hívók: `GET /api/patients/[id]/tooth-treatments` (ma), és a fogazati idővonal
 * (`getDentalStatusTimeline`), ami jelenleg csak `status <> 'completed'`-et szűr, és
 * ezért a munkafázison már lezárt igényt is beleszámítja a célállapotba.
 *
 * (2026-08-15)
 */

import type { Pool, PoolClient } from 'pg';

export interface DbQueryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

/**
 * Interpolálás előtt kötelező ellenőrzések.
 * A tábla-alias idézőjel nélkül kerül a lekérdezésbe, ezért csak kisbetűs lehet;
 * a kimeneti alias idézőjelbe kerül (`AS "pathwayClosed"`), ott a camelCase szabályos.
 */
const SAFE_TABLE_ALIAS = /^[a-z_][a-z0-9_]*$/;
const SAFE_OUTPUT_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface SchemaShape {
  ewpTableExists: boolean;
  mergedIntoColumnExists: boolean;
}

/**
 * Séma-próbák eredménye. A séma futás közben nem változik, ezért folyamat-lokálisan
 * cache-eljük — enélkül minden lekérés két fölösleges `information_schema` kört fut.
 */
let cachedShape: SchemaShape | null = null;

/** Tesztekhez / migráció utáni újraprobáláshoz. */
export function resetPathwayClosedExprCache(): void {
  cachedShape = null;
}

async function probeSchema(db: DbQueryable | Pool | PoolClient): Promise<SchemaShape> {
  if (cachedShape) return cachedShape;
  const q = db as DbQueryable;

  const ewpTable = await q.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'episode_work_phases' LIMIT 1`
  );
  const ewpTableExists = ewpTable.rows.length > 0;

  let mergedIntoColumnExists = false;
  if (ewpTableExists) {
    const col = await q.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'episode_work_phases'
          AND column_name = 'merged_into_episode_work_phase_id' LIMIT 1`
    );
    mergedIntoColumnExists = col.rows.length > 0;
  }

  cachedShape = { ewpTableExists, mergedIntoColumnExists };
  return cachedShape;
}

/**
 * A `SELECT` listába illeszthető kifejezés, `AS "<outputAlias>"`-szal együtt.
 *
 * @param toothTreatmentAlias a `tooth_treatments` tábla aliasa a hívó lekérdezésében
 */
export async function buildPathwayClosedExpr(
  db: DbQueryable | Pool | PoolClient,
  toothTreatmentAlias = 'tt',
  outputAlias = 'pathwayClosed'
): Promise<string> {
  if (!SAFE_TABLE_ALIAS.test(toothTreatmentAlias)) {
    throw new Error(`Érvénytelen tábla-alias: ${toothTreatmentAlias}`);
  }
  if (!SAFE_OUTPUT_ALIAS.test(outputAlias)) {
    throw new Error(`Érvénytelen oszlop-alias: ${outputAlias}`);
  }

  const { ewpTableExists, mergedIntoColumnExists } = await probeSchema(db);

  if (!ewpTableExists) {
    return `false AS "${outputAlias}"`;
  }

  // Összevont fázisoknál az elsődleges (merged_into...) fázis státusza dönt.
  const statusSource = mergedIntoColumnExists
    ? `(SELECT (prim.status IN ('completed', 'skipped'))
        FROM episode_work_phases ewp
        JOIN episode_work_phases prim ON prim.id = COALESCE(ewp.merged_into_episode_work_phase_id, ewp.id)
        WHERE ewp.tooth_treatment_id = ${toothTreatmentAlias}.id
        LIMIT 1)`
    : `(SELECT (ewp.status IN ('completed', 'skipped'))
        FROM episode_work_phases ewp
        WHERE ewp.tooth_treatment_id = ${toothTreatmentAlias}.id
        LIMIT 1)`;

  return `COALESCE(${statusSource}, false) AS "${outputAlias}"`;
}
