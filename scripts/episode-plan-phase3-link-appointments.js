/**
 * Phase 3 — link appointments.plan_item_id using only
 *   episode_work_phases.appointment_id = appointments.id
 *   + episode_plan_items.legacy_episode_work_phase_id = episode_work_phases.id
 *
 * Env:
 *   DATABASE_URL (required)
 *   BATCH_SIZE (default 200)
 *   MAX_BATCHES (default 50) — safety cap per process invocation
 *
 * Usage:
 *   node scripts/episode-plan-phase3-link-appointments.js
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=') || process.env.DATABASE_URL?.startsWith('postgresql://')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  let total = 0;
  try {
    for (let b = 0; b < maxBatches; b++) {
      const batchId = crypto.randomUUID();
      const client = await pool.connect();
      let updated = 0;
      try {
        await client.query('BEGIN');
        const sel = await client.query(
          `SELECT a.id
           FROM appointments a
           INNER JOIN episode_work_phases ewp ON ewp.appointment_id = a.id
           WHERE a.plan_item_id IS NULL
           FOR UPDATE OF a SKIP LOCKED
           LIMIT $1`,
          [batchSize]
        );
        if (sel.rows.length === 0) {
          await client.query('ROLLBACK');
          break;
        }
        const ids = sel.rows.map((r) => r.id);
        const upd = await client.query(
          `UPDATE appointments a
           SET
             plan_item_id = pi.id,
             plan_item_link_batch_id = $2::uuid,
             plan_item_linked_at = now()
           FROM episode_work_phases ewp
           JOIN episode_plan_items pi ON pi.legacy_episode_work_phase_id = ewp.id
           WHERE a.id = ANY($1::uuid[])
             AND ewp.appointment_id = a.id
             AND a.plan_item_id IS NULL`,
          [ids, batchId]
        );
        updated = upd.rowCount || 0;
        await client.query('COMMIT');
        total += updated;
        console.log(`Batch ${b + 1}: linked ${updated} (batch_id=${batchId})`);
        if (sel.rows.length < batchSize) break;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
    console.log('Total rows updated (this run):', total);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
