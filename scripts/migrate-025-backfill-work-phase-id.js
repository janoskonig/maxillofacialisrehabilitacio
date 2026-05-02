/**
 * Migration 025 backfill — set appointments.work_phase_id from
 * (episode_id, step_code) ↔ episode_work_phases mapping.
 *
 * Plan: docs work_phase_booking_8f6f78b9 — Phase 3.
 *
 * Strategy:
 *   1. For each appointment with `work_phase_id IS NULL` and a non-null
 *      step_code, find candidate `episode_work_phases` rows for the same
 *      (episode_id, work_phase_code).
 *   2. If there is exactly ONE candidate, set work_phase_id and continue.
 *   3. If there are MULTIPLE candidates we tie-break by:
 *        a. preferring the row with `appointment_id = a.id` (already linked);
 *        b. otherwise preferring the row with `seq = a.step_seq` (legacy
 *           denormalized seq match);
 *        c. otherwise preferring the row whose `pathway_order_index = a.step_seq`;
 *      and only if a SINGLE row remains do we link it. Otherwise we record an
 *      anomaly (`reason_code = 'BACKFILL_AMBIGUOUS'`) and leave work_phase_id
 *      NULL — to be resolved manually.
 *   4. If there are ZERO candidates we record `reason_code = 'BACKFILL_NO_CANDIDATE'`
 *      and skip the row.
 *
 * The anomaly table is `migration_ewp_anomaly` (added by migration 021). When
 * the table is missing we still log to stdout but do not abort.
 *
 * Idempotent: only updates rows where `work_phase_id IS NULL`. Anomaly rows
 * are appended on each run; older runs can be filtered by `migration_run_id`.
 *
 * Env:
 *   DATABASE_URL              required
 *   BATCH_SIZE                default 200, max 5000
 *   MAX_BATCHES               default 50, max 10000
 *   DRY_RUN                   default 0 (set to 1 to skip UPDATEs and only count)
 *   MIGRATION_PHASE_LABEL     default 'work_phase_id_backfill_v1'
 *
 * Usage:
 *   node scripts/migrate-025-backfill-work-phase-id.js
 *   DRY_RUN=1 node scripts/migrate-025-backfill-work-phase-id.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const batchSize = Math.min(parseInt(process.env.BATCH_SIZE || '200', 10), 5000);
const maxBatches = Math.min(parseInt(process.env.MAX_BATCHES || '50', 10), 10000);
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const phaseLabel = process.env.MIGRATION_PHASE_LABEL || 'work_phase_id_backfill_v1';

async function tableExists(pool, name) {
  const r = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name]
  );
  return r.rows[0]?.exists === true;
}

async function columnExists(pool, table, column) {
  const r = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column]
  );
  return r.rows[0]?.exists === true;
}

async function ensureMigrationRun(pool) {
  if (!(await tableExists(pool, 'migration_runs'))) {
    return null;
  }
  const r = await pool.query(
    `INSERT INTO migration_runs (phase, status, notes)
     VALUES ($1, 'in_progress', $2::jsonb)
     RETURNING id`,
    [phaseLabel, JSON.stringify({ batchSize, maxBatches, dryRun, startedAt: new Date().toISOString() })]
  );
  return r.rows[0].id;
}

async function finishMigrationRun(pool, runId, summary) {
  if (!runId) return;
  await pool.query(
    `UPDATE migration_runs SET status = $2, completed_at = now(),
       notes = notes || $3::jsonb
     WHERE id = $1`,
    [runId, summary.error ? 'failed' : 'completed', JSON.stringify(summary)]
  );
}

async function recordAnomaly(client, runId, episodeWorkPhaseId, reasonCode, payload, anomalyTableExists) {
  if (!anomalyTableExists || !runId) return;
  await client.query(
    `INSERT INTO migration_ewp_anomaly (migration_run_id, episode_work_phase_id, reason_code, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [runId, episodeWorkPhaseId, reasonCode, JSON.stringify(payload)]
  );
}

function pickUniquePhase(candidates, appointment) {
  if (candidates.length === 0) return { match: null, reason: 'no_candidate' };
  if (candidates.length === 1) return { match: candidates[0], reason: 'single_candidate' };

  const linkedToAppt = candidates.filter((c) => c.appointment_id === appointment.id);
  if (linkedToAppt.length === 1) return { match: linkedToAppt[0], reason: 'linked_to_appointment' };

  if (appointment.step_seq != null) {
    const seqMatch = candidates.filter((c) => c.seq != null && c.seq === appointment.step_seq);
    if (seqMatch.length === 1) return { match: seqMatch[0], reason: 'seq_match' };

    const orderMatch = candidates.filter((c) => c.pathway_order_index === appointment.step_seq);
    if (orderMatch.length === 1) return { match: orderMatch[0], reason: 'pathway_order_match' };
  }

  // Final tie-break: prefer the lowest pathway_order_index that is still 'pending' or 'scheduled'.
  const active = candidates
    .filter((c) => c.status === 'pending' || c.status === 'scheduled')
    .sort((a, b) => a.pathway_order_index - b.pathway_order_index);
  if (active.length === 1) return { match: active[0], reason: 'unique_active' };

  return { match: null, reason: 'ambiguous' };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_URL?.includes('sslmode=') || process.env.DATABASE_URL?.startsWith('postgresql://')
        ? { rejectUnauthorized: false }
        : undefined,
  });

  const summary = {
    phaseLabel,
    dryRun,
    batchSize,
    maxBatches,
    appointmentsLinked: 0,
    appointmentsAmbiguous: 0,
    appointmentsNoCandidate: 0,
    batchesRun: 0,
    error: null,
  };

  let runId = null;
  try {
    if (!(await columnExists(pool, 'appointments', 'work_phase_id'))) {
      throw new Error('appointments.work_phase_id column missing — run migration 025 first');
    }
    if (!(await tableExists(pool, 'episode_work_phases'))) {
      throw new Error('episode_work_phases table missing');
    }
    const ewpHasSeq = await columnExists(pool, 'episode_work_phases', 'seq');
    const anomalyTableExists = await tableExists(pool, 'migration_ewp_anomaly');

    runId = await ensureMigrationRun(pool);
    console.log(
      `[backfill-025] phase=${phaseLabel} runId=${runId ?? 'n/a'} dryRun=${dryRun} batchSize=${batchSize}`
    );

    for (let b = 0; b < maxBatches; b++) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const candidatesRes = await client.query(
          `SELECT a.id, a.episode_id, a.step_code, a.step_seq
           FROM appointments a
           WHERE a.work_phase_id IS NULL
             AND a.episode_id IS NOT NULL
             AND a.step_code IS NOT NULL
           ORDER BY a.created_at NULLS LAST
           FOR UPDATE OF a SKIP LOCKED
           LIMIT $1`,
          [batchSize]
        );
        if (candidatesRes.rows.length === 0) {
          await client.query('ROLLBACK');
          break;
        }

        const episodeIds = Array.from(new Set(candidatesRes.rows.map((r) => r.episode_id)));
        const stepCodes = Array.from(new Set(candidatesRes.rows.map((r) => r.step_code)));

        const seqExpr = ewpHasSeq ? 'ewp.seq' : 'NULL::int AS seq';
        const ewpRes = await client.query(
          `SELECT ewp.id, ewp.episode_id, ewp.work_phase_code, ewp.pathway_order_index,
                  ewp.status, ewp.appointment_id, ${seqExpr}
           FROM episode_work_phases ewp
           WHERE ewp.episode_id = ANY($1::uuid[])
             AND ewp.work_phase_code = ANY($2::text[])
             ${
               (await columnExists(pool, 'episode_work_phases', 'merged_into_episode_work_phase_id'))
                 ? 'AND ewp.merged_into_episode_work_phase_id IS NULL'
                 : ''
             }`,
          [episodeIds, stepCodes]
        );

        const phasesByKey = new Map();
        for (const row of ewpRes.rows) {
          const key = `${row.episode_id}\u001f${row.work_phase_code}`;
          let arr = phasesByKey.get(key);
          if (!arr) {
            arr = [];
            phasesByKey.set(key, arr);
          }
          arr.push(row);
        }

        let batchLinked = 0;
        let batchAmbiguous = 0;
        let batchNoCandidate = 0;

        for (const appt of candidatesRes.rows) {
          const candidates = phasesByKey.get(`${appt.episode_id}\u001f${appt.step_code}`) ?? [];
          const decision = pickUniquePhase(candidates, appt);

          if (decision.match) {
            if (!dryRun) {
              await client.query(
                `UPDATE appointments SET work_phase_id = $1 WHERE id = $2 AND work_phase_id IS NULL`,
                [decision.match.id, appt.id]
              );
            }
            batchLinked++;
          } else if (decision.reason === 'no_candidate') {
            batchNoCandidate++;
            // No candidate phase to anchor an anomaly row to → log only.
          } else {
            batchAmbiguous++;
            // Pick a representative phase row to anchor the anomaly to (first by pathway order).
            const anchor = candidates
              .slice()
              .sort((a, b) => a.pathway_order_index - b.pathway_order_index)[0];
            if (!dryRun) {
              await recordAnomaly(client, runId, anchor.id, 'BACKFILL_AMBIGUOUS', {
                appointmentId: appt.id,
                episodeId: appt.episode_id,
                stepCode: appt.step_code,
                stepSeq: appt.step_seq,
                candidateIds: candidates.map((c) => c.id),
              }, anomalyTableExists);
            }
          }
        }

        await client.query('COMMIT');
        summary.appointmentsLinked += batchLinked;
        summary.appointmentsAmbiguous += batchAmbiguous;
        summary.appointmentsNoCandidate += batchNoCandidate;
        summary.batchesRun = b + 1;

        console.log(
          `[backfill-025] batch=${b + 1} linked=${batchLinked} ambiguous=${batchAmbiguous} no_candidate=${batchNoCandidate}`
        );

        if (candidatesRes.rows.length < batchSize) break;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }

    console.log('[backfill-025] DONE', summary);
  } catch (err) {
    summary.error = err && err.message ? err.message : String(err);
    console.error('[backfill-025] FAILED', summary);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await finishMigrationRun(pool, runId, summary).catch(() => {});
    await pool.end();
  }
}

main();
