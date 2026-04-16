/**
 * Phase 2 — deterministic episode_work_phases → episode_plan_items backfill (operator job).
 *
 * Env:
 *   DATABASE_URL (required)
 *   CUTOFF_AT — ISO-8601 timestamptz upper bound for ewp.created_at (required unless DRY_RUN=1)
 *   DRY_RUN — if "1" or "true", only prints counts
 *
 * Rules: created_at must be non-null and <= cutoff; NULL created_at → migration_ewp_anomaly only.
 *
 * Usage:
 *   CUTOFF_AT=2026-04-16T12:00:00Z node scripts/episode-plan-phase2-backfill.js
 *   DRY_RUN=1 node scripts/episode-plan-phase2-backfill.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const dryRun = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());
const cutoffAt = process.env.CUTOFF_AT?.trim();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (!dryRun && !cutoffAt) {
    console.error('CUTOFF_AT is required unless DRY_RUN=1');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=') || process.env.DATABASE_URL?.startsWith('postgresql://')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  try {
    const client = await pool.connect();
    try {
      if (dryRun) {
        const [eligible, missing] = await Promise.all([
          client.query(
            `SELECT COUNT(*)::int AS c FROM episode_work_phases ewp
             WHERE ewp.created_at IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM episode_plan_items pi WHERE pi.legacy_episode_work_phase_id = ewp.id)`
          ),
          client.query(
            `SELECT COUNT(*)::int AS c FROM episode_work_phases ewp
             WHERE ewp.created_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM episode_plan_items pi WHERE pi.legacy_episode_work_phase_id = ewp.id)`
          ),
        ]);
        console.log('DRY_RUN: rows eligible (has created_at, not yet linked):', eligible.rows[0].c);
        console.log('DRY_RUN: rows with missing created_at (anomaly candidates):', missing.rows[0].c);
        return;
      }

      await client.query('BEGIN');
      const runRes = await client.query(
        `INSERT INTO migration_runs (phase, cutoff_at, status, notes)
         VALUES ($1, $2::timestamptz, 'running', $3::jsonb)
         RETURNING id`,
        ['2_ewp_backfill', cutoffAt, JSON.stringify({ script: 'episode-plan-phase2-backfill.js' })]
      );
      const migrationRunId = runRes.rows[0].id;

      const insertPi = await client.query(
        `INSERT INTO episode_plan_items (
           id, episode_id, legacy_episode_work_phase_id, work_phase_code, treatment_type_id, location,
           status, planned_date, due_window_start, due_window_end, depends_on_item_id, source, migration_run_id
         )
         SELECT
           gen_random_uuid(),
           ewp.episode_id,
           ewp.id,
           ewp.work_phase_code,
           NULL,
           NULL,
           CASE ewp.status
             WHEN 'completed' THEN 'completed'
             WHEN 'scheduled' THEN 'scheduled'
             WHEN 'skipped' THEN 'cancelled'
             ELSE 'planned'
           END,
           NULL, NULL, NULL, NULL,
           'ewp_backfill',
           $1::uuid
         FROM episode_work_phases ewp
         WHERE ewp.created_at IS NOT NULL
           AND ewp.created_at <= $2::timestamptz
           AND NOT EXISTS (SELECT 1 FROM episode_plan_items pi WHERE pi.legacy_episode_work_phase_id = ewp.id)`,
        [migrationRunId, cutoffAt]
      );
      console.log('Inserted episode_plan_items:', insertPi.rowCount);

      const insAnom = await client.query(
        `INSERT INTO migration_ewp_anomaly (migration_run_id, episode_work_phase_id, reason_code, payload)
         SELECT $1::uuid, ewp.id, 'missing_created_at', '{}'::jsonb
         FROM episode_work_phases ewp
         WHERE ewp.created_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM episode_plan_items pi WHERE pi.legacy_episode_work_phase_id = ewp.id)
           AND NOT EXISTS (
             SELECT 1 FROM migration_ewp_anomaly m
             WHERE m.episode_work_phase_id = ewp.id AND m.reason_code = 'missing_created_at'
           )`,
        [migrationRunId]
      );
      console.log('Inserted migration_ewp_anomaly (missing_created_at):', insAnom.rowCount);

      await client.query(`UPDATE migration_runs SET status = $1, completed_at = now() WHERE id = $2`, [
        'completed',
        migrationRunId,
      ]);

      await client.query('COMMIT');
      console.log('migration_runs.id:', migrationRunId);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
