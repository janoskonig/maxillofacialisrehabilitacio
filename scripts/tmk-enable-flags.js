/**
 * Enable all TMK compliance feature flags (idempotent).
 * Usage: node scripts/tmk-enable-flags.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const KEYS = [
  'unified_audit_events',
  'entity_revision_locking',
  'quality_recompute_queue',
  'research_export_pipeline',
  'tighten_snapshot_changes_access',
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const key of KEYS) {
    await pool.query(
      `UPDATE compliance_feature_flags SET enabled = true, updated_at = CURRENT_TIMESTAMP WHERE key = $1`,
      [key]
    );
  }
  const r = await pool.query(
    `SELECT key, enabled FROM compliance_feature_flags ORDER BY key`
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
