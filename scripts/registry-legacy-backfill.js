/**
 * Registry legacy backfill: revision, quality_state, compliance status.
 * Idempotent; supports --dry-run for reporting.
 *
 * Usage:
 *   node scripts/registry-legacy-backfill.js --dry-run
 *   node scripts/registry-legacy-backfill.js
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

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  const report = {
    dryRun,
    patients: { legacyUnverified: 0, importedLegacy: 0, qualitySeeded: 0 },
    revisions: { patients: 0, episodes: 0, appointments: 0 },
  };

  try {
    const patients = await pool.query(`SELECT id, created_at, legacy_compliance_status FROM patients`);
    const crfVersion = await pool.query(
      `SELECT id FROM crf_form_versions WHERE form_code = 'patient_intake' AND version_label = 'v1' LIMIT 1`
    );
    const crfFormVersionId = crfVersion.rows[0]?.id ?? null;

    for (const p of patients.rows) {
      const status =
        p.legacy_compliance_status && p.legacy_compliance_status !== 'LEGACY_UNVERIFIED'
          ? p.legacy_compliance_status
          : 'LEGACY_UNVERIFIED';

      if (status === 'LEGACY_UNVERIFIED') report.patients.legacyUnverified++;
      if (status === 'IMPORTED_LEGACY') report.patients.importedLegacy++;

      if (!dryRun) {
        await pool.query(
          `UPDATE patients SET
             domain_revision = COALESCE(domain_revision, 1),
             legacy_compliance_status = COALESCE(legacy_compliance_status, 'LEGACY_UNVERIFIED'),
             recorded_at = COALESCE(recorded_at, created_at, CURRENT_TIMESTAMP)
           WHERE id = $1`,
          [p.id]
        );
        report.revisions.patients++;

        await pool.query(
          `INSERT INTO entity_quality_state (entity_type, entity_id, quality_state, crf_form_version_id, source_revision)
           VALUES ('patient', $1, $2, $3, 1)
           ON CONFLICT (entity_type, entity_id) DO NOTHING`,
          [p.id, status === 'IMPORTED_LEGACY' ? 'IMPORTED_LEGACY' : 'LEGACY_UNVERIFIED', crfFormVersionId]
        );
        report.patients.qualitySeeded++;
      }
    }

    if (!dryRun) {
      const ep = await pool.query(
        `UPDATE patient_episodes SET domain_revision = COALESCE(domain_revision, 1) WHERE domain_revision IS NULL RETURNING id`
      );
      report.revisions.episodes = ep.rowCount ?? 0;

      const ap = await pool.query(
        `UPDATE appointments SET domain_revision = COALESCE(domain_revision, 1) WHERE domain_revision IS NULL RETURNING id`
      );
      report.revisions.appointments = ap.rowCount ?? 0;
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
