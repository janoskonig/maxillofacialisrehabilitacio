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

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL nincs beállítva!');
  process.exit(1);
}

async function run() {
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('render.com') || connectionString.includes('amazonaws.com')
      ? { rejectUnauthorized: false }
      : false,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE episode_pathways
        ADD COLUMN IF NOT EXISTS jaw VARCHAR(10)
        CHECK (jaw IS NULL OR jaw IN ('felso', 'also'))
    `);
    console.log('jaw column added (or already exists)');

    await client.query(`
      ALTER TABLE episode_pathways
        DROP CONSTRAINT IF EXISTS uq_episode_pathways_episode_pathway
    `);
    console.log('old unique constraint dropped (if existed)');

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_episode_pathways_episode_pathway_jaw
        ON episode_pathways (episode_id, care_pathway_id, COALESCE(jaw, '_none_'))
    `);
    console.log('new unique index created (or already exists)');

    await client.query('COMMIT');
    console.log('Migration 006 completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
