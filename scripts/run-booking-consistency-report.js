#!/usr/bin/env node
/**
 * CLI wrapper around lib/booking-consistency-report.ts with HARD prod safety
 * gates. Intended workflow:
 *
 *   1. Készíts production dumpot:
 *        pg_dump "$PROD_URL" > /tmp/maxfac-dump.sql
 *   2. Lokális vagy staging Postgres:
 *        createdb maxfac_consistency_check
 *        psql maxfac_consistency_check < /tmp/maxfac-dump.sql
 *   3. Futtasd a riportot a másolaton:
 *        TEST_DATABASE_URL=postgresql://localhost/maxfac_consistency_check \
 *          node scripts/run-booking-consistency-report.js
 *
 * Csak miután a riport itt gyors és helyes, futtasd élesen — read-only userrel,
 * munkaidőn kívül, kifejezett `--allow-prod-readonly` flaggel:
 *   ALLOW_PROD_READONLY=1 node scripts/run-booking-consistency-report.js \
 *       --allow-prod-readonly
 *
 * Defaults:
 *   - statement_timeout: 5s (overridable via STATEMENT_TIMEOUT_MS)
 *   - sampleLimit: 25       (overridable via SAMPLE_LIMIT)
 *   - output: pretty JSON to stdout, summary table to stderr
 *
 * Env precedence:
 *   TEST_DATABASE_URL > DATABASE_URL
 *
 * The script REFUSES to run if it detects the well-known production host
 * fingerprint (`165.232.117.171`) UNLESS `--allow-prod-readonly` is set AND
 * the connection is verified read-only via `SHOW transaction_read_only`.
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

const PROD_HOST_FINGERPRINTS = ['165.232.117.171'];
const allowProdReadonly =
  process.argv.includes('--allow-prod-readonly') ||
  process.env.ALLOW_PROD_READONLY === '1' ||
  process.env.ALLOW_PROD_READONLY === 'true';
const summaryOnly = process.argv.includes('--summary-only');

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('No TEST_DATABASE_URL or DATABASE_URL set. Aborting.');
  process.exit(2);
}

const looksLikeProd = PROD_HOST_FINGERPRINTS.some((fp) => databaseUrl.includes(fp));

if (looksLikeProd && !allowProdReadonly) {
  console.error('REFUSING to run against the production host fingerprint without --allow-prod-readonly.');
  console.error('Use TEST_DATABASE_URL pointing at a local restored dump first.');
  console.error('Procedure: see scripts/run-booking-consistency-report.js header.');
  process.exit(3);
}

const sampleLimit = Math.min(Math.max(parseInt(process.env.SAMPLE_LIMIT || '25', 10), 1), 200);
const statementTimeoutMs = Math.max(parseInt(process.env.STATEMENT_TIMEOUT_MS || '5000', 10), 100);

async function main() {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl:
      databaseUrl.includes('sslmode=') || databaseUrl.startsWith('postgresql://')
        ? { rejectUnauthorized: false }
        : undefined,
    statement_timeout: statementTimeoutMs,
    max: 2,
  });

  const summary = { startedAt: new Date().toISOString() };

  try {
    if (looksLikeProd) {
      const ro = await pool.query(`SHOW transaction_read_only`);
      const isReadOnly = ro.rows[0]?.transaction_read_only === 'on';
      if (!isReadOnly) {
        console.error(
          'Production host detected but the connecting role is NOT read-only ' +
          '(transaction_read_only = off). Refusing to proceed.\n' +
          'Use a read-only DB user (CREATE ROLE consistency_reader WITH LOGIN PASSWORD … ' +
          'IN ROLE pg_read_all_data;) and re-run.'
        );
        process.exit(4);
      }
      console.error('[safety] Confirmed read-only role on production host. Continuing.');
    }

    // Lazy require so .env is loaded first.
    const { buildBookingConsistencyReport } = require('../lib/booking-consistency-report');
    const report = await buildBookingConsistencyReport(pool, {
      sampleLimit,
      statementTimeoutMs,
    });

    const totalQuarantine = report.checks.reduce((sum, c) => sum + (c.available ? c.total : 0), 0);

    // SUMMARY mode strips every PII / connection detail so the output is safe
    // to paste in a chat. NEVER include the connection string, host, sample
    // rows, or anything that could identify a patient. The aggregated `total`
    // per check is enough for go/no-go decisions on the migration.
    const summaryPayload = {
      generatedAt: report.generatedAt,
      sampleLimit: report.sampleLimit,
      statementTimeoutMs,
      totalQuarantine,
      checks: report.checks.map((c) => ({
        id: c.id,
        available: c.available,
        total: c.total,
        // notes might contain a SQL error string but never row content; safe to keep.
        ...(c.notes ? { notes: c.notes } : {}),
      })),
    };

    if (summaryOnly) {
      process.stdout.write(JSON.stringify(summaryPayload, null, 2) + '\n');
    } else {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }

    // Stderr summary — printable, contains zero credentials. Connection
    // string is masked; sample rows (PII) are excluded.
    console.error('\n[booking-consistency-report] target=', maskUrl(databaseUrl));
    console.error('[booking-consistency-report] sampleLimit=', sampleLimit, 'statement_timeout_ms=', statementTimeoutMs);
    console.error('\n[booking-consistency-report] Quarantine size by check:');
    for (const c of report.checks) {
      console.error(
        `  - ${c.id.padEnd(50)}  total=${String(c.total).padStart(8)}  available=${c.available}${c.notes ? '  note=' + c.notes : ''}`
      );
    }
    console.error(`\n[booking-consistency-report] TOTAL QUARANTINE ROWS: ${totalQuarantine}`);
    console.error(
      summaryOnly
        ? '\n[booking-consistency-report] --summary-only: stdout contains no row-level data, safe to share.'
        : '\n[booking-consistency-report] WARNING: stdout contains row-level samples (PII). Do NOT paste raw stdout in a chat — re-run with --summary-only or share only the per-check totals from stderr.'
    );
    summary.totalQuarantine = totalQuarantine;
  } catch (e) {
    summary.error = e && e.message ? e.message : String(e);
    console.error('FAILED:', summary.error);
    process.exitCode = 1;
  } finally {
    await pool.end();
    summary.completedAt = new Date().toISOString();
  }
}

function maskUrl(url) {
  return url.replace(/\/\/[^@]*@/, '//***:***@');
}

main();
