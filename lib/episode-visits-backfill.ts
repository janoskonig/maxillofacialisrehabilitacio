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

/** 2. lépés: a beolvasztott gyerekek a primary vizitjét kapják. */
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
  db: EpisodeVisitsBackfillQueryable
): Promise<EpisodeVisitsBackfillResult> {
  const primaries = await db.query(BACKFILL_PRIMARY_VISITS_SQL);
  const children = await db.query(BACKFILL_CHILD_VISITS_SQL);
  return {
    visitsCreated: primaries.rowCount ?? 0,
    childrenLinked: children.rowCount ?? 0,
  };
}
