/**
 * Backfill episode_work_phases for active episodes that have a care pathway but no
 * generated plan yet (WP2). Idempotent — generateEpisodeWorkPhases skips episodes
 * that already have phases, so re-running is safe.
 *
 * SAFE BY DEFAULT: dry-run unless APPLY=1. Dry-run only lists candidates and counts.
 *
 * Env:
 *   DATABASE_URL   required (read by lib/db)
 *   APPLY          set to 1/true to actually generate; otherwise dry-run
 *   LIMIT          optional cap on number of episodes processed (default: all)
 *
 * Usage:
 *   npx tsx scripts/backfill-episode-work-phases.ts            # dry-run
 *   APPLY=1 npx tsx scripts/backfill-episode-work-phases.ts    # execute
 */

import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });
import { getDbPool } from '../lib/db';
import { generateEpisodeWorkPhases } from '../lib/generate-episode-work-phases';

const apply = process.env.APPLY === '1' || process.env.APPLY === 'true';
const limit = process.env.LIMIT ? Math.max(1, parseInt(process.env.LIMIT, 10)) : null;

/** Active episodes with a pathway but no generated work phases. */
async function findCandidates(pool: ReturnType<typeof getDbPool>): Promise<string[]> {
  const withPathways = `
    SELECT pe.id
    FROM patient_episodes pe
    WHERE pe.status = 'open'
      AND (
        pe.care_pathway_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM episode_pathways ep WHERE ep.episode_id = pe.id)
      )
      AND NOT EXISTS (SELECT 1 FROM episode_work_phases ewp WHERE ewp.episode_id = pe.id)
    ORDER BY pe.opened_at`;
  const careOnly = `
    SELECT pe.id
    FROM patient_episodes pe
    WHERE pe.status = 'open'
      AND pe.care_pathway_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM episode_work_phases ewp WHERE ewp.episode_id = pe.id)
    ORDER BY pe.opened_at`;
  try {
    const r = await pool.query(withPathways);
    return r.rows.map((row: { id: string }) => row.id);
  } catch {
    const r = await pool.query(careOnly); // episode_pathways missing on older DBs
    return r.rows.map((row: { id: string }) => row.id);
  }
}

async function run() {
  const pool = getDbPool();
  let candidates = await findCandidates(pool);
  if (limit != null) candidates = candidates.slice(0, limit);

  console.log(`[backfill-work-phases] mode=${apply ? 'APPLY' : 'DRY-RUN'} candidates=${candidates.length}`);

  if (!apply) {
    candidates.forEach((id) => console.log(`  would generate: ${id}`));
    console.log('[backfill-work-phases] dry-run complete (no writes). Set APPLY=1 to execute.');
    await pool.end();
    return;
  }

  let ok = 0;
  let generated = 0;
  let skipped = 0;
  const failures: Array<{ id: string; reason: string }> = [];

  for (const id of candidates) {
    try {
      const res = await generateEpisodeWorkPhases(pool, id);
      if (res.status === 'ok') {
        ok++;
        generated += res.totalGenerated;
        if (res.totalGenerated === 0) skipped++;
        console.log(`  ${id}: generated ${res.totalGenerated}`);
      } else {
        skipped++;
        console.log(`  ${id}: skipped (${res.status})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ id, reason: msg });
      console.error(`  ${id}: FAILED — ${msg}`);
    }
  }

  console.log(
    `[backfill-work-phases] done. episodes_ok=${ok} phases_generated=${generated} skipped=${skipped} failed=${failures.length}`
  );
  await pool.end();
  if (failures.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error('[backfill-work-phases] fatal:', e);
  process.exit(1);
});
