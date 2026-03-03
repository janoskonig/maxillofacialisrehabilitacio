/**
 * Migrate editor/viewer roles to fogpótlástanász and update CHECK constraint.
 *
 * Usage:
 *   node scripts/migrate-roles-remove-editor-viewer.js
 */

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
  console.error('DATABASE_URL nincs beállítva');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    // 1. Show current state
    const before = await pool.query(
      "SELECT role, COUNT(*)::int as cnt FROM users GROUP BY role ORDER BY role"
    );
    console.log('Jelenlegi szerepkör-eloszlás:');
    before.rows.forEach(r => console.log(`  ${r.role}: ${r.cnt}`));

    // 2. Migrate editor -> fogpótlástanász
    const editorResult = await pool.query(
      "UPDATE users SET role = 'fogpótlástanász' WHERE role = 'editor' RETURNING id, email"
    );
    if (editorResult.rows.length > 0) {
      console.log(`\n${editorResult.rows.length} editor felhasználó migrálva fogpótlástanász-ra:`);
      editorResult.rows.forEach(r => console.log(`  ${r.email}`));
    } else {
      console.log('\nNincs editor felhasználó.');
    }

    // 3. Migrate viewer -> fogpótlástanász
    const viewerResult = await pool.query(
      "UPDATE users SET role = 'fogpótlástanász' WHERE role = 'viewer' RETURNING id, email"
    );
    if (viewerResult.rows.length > 0) {
      console.log(`${viewerResult.rows.length} viewer felhasználó migrálva fogpótlástanász-ra:`);
      viewerResult.rows.forEach(r => console.log(`  ${r.email}`));
    } else {
      console.log('Nincs viewer felhasználó.');
    }

    // 4. Update CHECK constraint
    await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    await pool.query(
      "ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'fogpótlástanász', 'technikus', 'sebészorvos'))"
    );
    console.log('\nCHECK constraint frissítve: admin, fogpótlástanász, technikus, sebészorvos');

    // 5. Show final state
    const after = await pool.query(
      "SELECT role, COUNT(*)::int as cnt FROM users GROUP BY role ORDER BY role"
    );
    console.log('\nÚj szerepkör-eloszlás:');
    after.rows.forEach(r => console.log(`  ${r.role}: ${r.cnt}`));

    console.log('\nMigráció sikeres!');
  } catch (error) {
    console.error('Hiba:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
