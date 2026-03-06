/**
 * Create admin_notification_queue table.
 * Instead of sending individual emails to admins for every event,
 * notifications are queued here and sent as a single daily summary at 06:00 Budapest time.
 *
 * Usage: npx tsx scripts/run-admin-notification-queue-migration.ts
 * Or:    npm run migrate:admin-notification-queue
 */

import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });
import { getDbPool } from '../lib/db';

async function run() {
  const pool = getDbPool();

  await pool.query('BEGIN');

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_notification_queue (
        id SERIAL PRIMARY KEY,
        notification_type VARCHAR(50) NOT NULL,
        summary_text TEXT NOT NULL,
        detail_json JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed BOOLEAN NOT NULL DEFAULT FALSE,
        processed_at TIMESTAMPTZ
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_notif_queue_unprocessed
        ON admin_notification_queue (processed, created_at)
        WHERE processed = FALSE
    `);

    await pool.query('COMMIT');
    console.log('OK: admin_notification_queue table created.');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  } finally {
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
