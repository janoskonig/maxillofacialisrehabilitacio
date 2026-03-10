/**
 * Run all SQL migrations in database/migrations in order (by filename).
 * Tracks completed migrations in table node_migrations so each runs only once.
 *
 * Usage:
 *   npm run migrate
 *   node scripts/run-all-migrations.js
 *
 * Optional: run a single migration by name
 *   node scripts/run-all-migrations.js 009_sebeszorvos_to_beutalo_orvos.sql
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

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');

async function getPool() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL nincs beállítva (.env vagy .env.local)');
    process.exit(1);
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=') || process.env.DATABASE_URL?.startsWith('postgresql://')
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS node_migrations (
      name TEXT PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function getMigrationFiles(singleFile) {
  if (singleFile) {
    const withDir = path.join(MIGRATIONS_DIR, path.basename(singleFile));
    const withRoot = path.join(__dirname, '..', singleFile);
    const full = fs.existsSync(withDir) ? withDir : fs.existsSync(withRoot) ? withRoot : null;
    if (!full || !fs.existsSync(full)) {
      console.error(`Migration file not found: ${singleFile}`);
      process.exit(1);
    }
    return [{ name: path.basename(full), path: full }];
  }
  const names = fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort();
  return names.map((n) => ({ name: n, path: path.join(MIGRATIONS_DIR, n) }));
}

async function runAll() {
  const singleArg = process.argv[2];
  const pool = await getPool();
  const migrationNames = getMigrationFiles(singleArg || null);

  try {
    await ensureMigrationsTable(pool);

    const done = await pool.query('SELECT name FROM node_migrations');
    const doneSet = new Set(done.rows.map((r) => r.name));

    let run = 0;
    for (const { name, path: filePath } of migrationNames) {
      if (doneSet.has(name)) {
        console.log(`⏭️  Skipped (already run): ${name}`);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf8').trim();
      if (!sql) {
        console.log(`⏭️  Empty, marking done: ${name}`);
        await pool.query(
          'INSERT INTO node_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [name]
        );
        doneSet.add(name);
        continue;
      }
      console.log(`▶️  Running: ${name}`);
      await pool.query(sql);
      await pool.query(
        'INSERT INTO node_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [name]
      );
      doneSet.add(name);
      run++;
    }

    if (run === 0 && !singleArg) {
      console.log('No new migrations to run.');
    } else if (run > 0) {
      console.log(`\n✅ ${run} migration(s) completed.`);
    } else if (singleArg) {
      console.log('✅ Migration completed.');
    }
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runAll();
