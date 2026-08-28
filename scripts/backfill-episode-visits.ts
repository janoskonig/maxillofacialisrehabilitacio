/**
 * WP-4.1a: EWP → vizit backfill, újrafuttatható formában (terv 4.4: eldobható
 * DB-n próbálható ki, mielőtt élesbe megy). Ugyanazt a set-alapú SQL-t
 * futtatja, mint a 089-es migráció (lib/episode-visits-backfill.ts).
 *
 * Idempotens: csak visit_id IS NULL sorokra fut — második futás 0 változás.
 *
 * SAFE BY DEFAULT: dry-run, hacsak nincs APPLY=1. A dry-run csak megszámolja
 * a vizit nélküli sorokat.
 *
 * Env:
 *   DATABASE_URL   kötelező (lib/db olvassa)
 *   APPLY          1/true → tényleges backfill; különben dry-run
 *
 * Usage:
 *   npx tsx scripts/backfill-episode-visits.ts            # dry-run
 *   APPLY=1 npx tsx scripts/backfill-episode-visits.ts    # végrehajtás
 */

import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });
import { getDbPool } from '../lib/db';
import { backfillEpisodeVisits } from '../lib/episode-visits-backfill';

const apply = process.env.APPLY === '1' || process.env.APPLY === 'true';

async function main(): Promise<void> {
  const pool = getDbPool();

  const pending = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE merged_into_episode_work_phase_id IS NULL) AS primaries,
       COUNT(*) FILTER (WHERE merged_into_episode_work_phase_id IS NOT NULL) AS children,
       COUNT(DISTINCT episode_id) AS episodes
     FROM episode_work_phases
     WHERE visit_id IS NULL`
  );
  const stats = pending.rows[0];
  console.log(
    `Vizit nélküli EWP sorok: ${stats.primaries} primary + ${stats.children} merge-gyerek, ${stats.episodes} epizódban.`
  );

  if (!apply) {
    console.log('Dry-run (APPLY=1 a végrehajtáshoz) — nem történt írás.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await backfillEpisodeVisits(client);
    await client.query('COMMIT');
    console.log(
      `Kész: ${result.visitsCreated} vizit létrehozva, ${result.childrenLinked} merge-gyerek bekötve a primary vizitjébe.`
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill hiba:', err);
    process.exit(1);
  });
