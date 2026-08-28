/**
 * WP-4.1a: EWP → vizit backfill — ugyanaz a set-alapú, idempotens SQL, mint a
 * 089-es migrációban (database/migrations/089_episode_visits.sql). A két
 * helyet együtt kell módosítani.
 *
 * Leképezés:
 *   • merge-csoport (primary + a rá mutató merged_into gyerekek) → EGY vizit;
 *   • magányos primary sor → saját egyfős vizit.
 * A vizit seq-je a primary COALESCE(seq, pathway_order_index) sorrendjét
 * követi (0-tól epizódon belül; meglévő vizitek után folytatódik).
 * days_offset := a primary default_days_offset-je; label NULL.
 *
 * Idempotens: CSAK visit_id IS NULL sorokra fut — a második futás 0 változás.
 */

export type EpisodeVisitsBackfillQueryable = {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/**
 * 1. lépés: minden vizit nélküli primary (nem-beolvasztott) sor saját vizitet
 * kap. A vizit id-t a CTE generálja, így az INSERT és az EWP-UPDATE ugyanazon
 * a lenyomaton dolgozik (a wCTE egyszer értékelődik ki).
 */
export const BACKFILL_PRIMARY_VISITS_SQL = `
WITH primaries AS (
  SELECT
    ewp.id AS ewp_id,
    ewp.episode_id,
    ewp.default_days_offset,
    gen_random_uuid() AS visit_id,
    ROW_NUMBER() OVER (
      PARTITION BY ewp.episode_id
      ORDER BY COALESCE(ewp.seq, ewp.pathway_order_index),
               ewp.pathway_order_index, ewp.created_at, ewp.id
    ) - 1 AS rn
  FROM episode_work_phases ewp
  WHERE ewp.visit_id IS NULL
    AND ewp.merged_into_episode_work_phase_id IS NULL
),
base AS (
  SELECT episode_id, MAX(seq) + 1 AS base_seq
  FROM episode_visits
  GROUP BY episode_id
),
inserted AS (
  INSERT INTO episode_visits (id, episode_id, seq, days_offset)
  SELECT p.visit_id, p.episode_id, COALESCE(b.base_seq, 0) + p.rn, p.default_days_offset
  FROM primaries p
  LEFT JOIN base b ON b.episode_id = p.episode_id
)
UPDATE episode_work_phases ewp
SET visit_id = p.visit_id
FROM primaries p
WHERE ewp.id = p.ewp_id`;

/**
 * 2. lépés: a beolvasztott gyerekek a primary vizitjét kapják.
 *
 * FIGYELEM (review-javítás): egyetlen futás a statement-snapshotból olvas —
 * láncolt csoportnál (C → B → A) a lánc alja kimaradna. Ezért a
 * backfillEpisodeVisits CIKLUSBAN futtatja rowCount = 0-ig (a migrációban
 * ugyanez DO $$ ... LOOP + GET DIAGNOSTICS formában él).
 */
export const BACKFILL_CHILD_VISITS_SQL = `
UPDATE episode_work_phases child
SET visit_id = parent.visit_id
FROM episode_work_phases parent
WHERE child.merged_into_episode_work_phase_id = parent.id
  AND child.episode_id = parent.episode_id
  AND child.visit_id IS NULL
  AND parent.visit_id IS NOT NULL`;

export interface EpisodeVisitsBackfillResult {
  /** Létrehozott vizitek (= vizitet kapott primary sorok) száma. */
  visitsCreated: number;
  /** A primary vizitjébe bekötött merge-gyerek sorok száma. */
  childrenLinked: number;
}

export async function backfillEpisodeVisits(
  db: EpisodeVisitsBackfillQueryable,
  /**
   * WP-4.2: opcionális epizód-szűkítés — teszthez / célzott újrafuttatáshoz.
   * Nélküle a teljes állomány visit_id IS NULL sorai kapnak vizitet (migráció).
   */
  episodeId?: string
): Promise<EpisodeVisitsBackfillResult> {
  const scoped = episodeId != null;
  const primarySql = scoped
    ? BACKFILL_PRIMARY_VISITS_SQL.replace(
        'WHERE ewp.visit_id IS NULL',
        'WHERE ewp.visit_id IS NULL\n    AND ewp.episode_id = $1'
      )
    : BACKFILL_PRIMARY_VISITS_SQL;
  if (scoped && primarySql === BACKFILL_PRIMARY_VISITS_SQL) {
    throw new Error('backfillEpisodeVisits: az epizód-szűkítés horgonya nem található a SQL-ben');
  }
  const childSql = scoped
    ? `${BACKFILL_CHILD_VISITS_SQL}\n  AND child.episode_id = $1`
    : BACKFILL_CHILD_VISITS_SQL;
  const params = scoped ? [episodeId] : undefined;

  const primaries = await db.query(primarySql, params);

  // Ciklusban rowCount = 0-ig: láncolt csoportnál (C → B → A) az első kör csak
  // a közvetlen gyerekeket éri el, a mélyebb szintek a következő körökben
  // kapják meg a vizitet. Minden kör legalább egy szinttel lejjebb ér (csak
  // visit_id IS NULL sort ír), így a ciklus véges.
  let childrenLinked = 0;
  for (;;) {
    const children = await db.query(childSql, params);
    const linked = children.rowCount ?? 0;
    if (linked === 0) break;
    childrenLinked += linked;
  }

  return {
    visitsCreated: primaries.rowCount ?? 0,
    childrenLinked,
  };
}
