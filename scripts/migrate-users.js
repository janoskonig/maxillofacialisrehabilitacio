/**
 * Script a meglévő env-ben tárolt felhasználók migrálásához az adatbázisba
 * 
 * Használat:
 * node scripts/migrate-users.js
 * 
 * Vagy adjon meg felhasználókat kézzel:
 * node scripts/migrate-users.js "user1:password1,user2:password2"
 */

// .env fájlok betöltése (először .env.local, majd .env fallback)
const fs = require('fs');
const path = require('path');

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  // Próbáljuk a default .env.local fájlt is
  require('dotenv').config();
}

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Hiba: DATABASE_URL környezeti változó nincs beállítva!');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('render.com') || connectionString.includes('amazonaws.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function parseUsers(envValue) {
  const map = {};
  if (!envValue) return map;
  envValue
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [user, pass] = pair.split(':');
      if (user && pass) {
        map[user.trim()] = pass.trim();
      }
    });
  return map;
}

async function migrateUsers() {
  const envUsers = process.argv[2] || process.env.NEXT_PUBLIC_ALLOWED_USERS;
  
  if (!envUsers) {
    console.error('Hiba: Nincs megadva felhasználó lista!');
    console.log('Használat: node scripts/migrate-users.js "user1:pass1,user2:pass2"');
    process.exit(1);
  }

  const users = await parseUsers(envUsers);
  console.log(`\n${Object.keys(users).length} felhasználó migrálása...\n`);

  try {
    // Ellenőrizzük, hogy létezik-e a users tábla
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'users'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.error('Hiba: A users tábla még nem létezik!');
      console.log('Futtassa le először: psql -d YOUR_DB -f database/migration_users.sql');
      process.exit(1);
    }

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const [email, password] of Object.entries(users)) {
      try {
        // Ellenőrizzük, hogy létezik-e már
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        
        if (existing.rows.length > 0) {
          console.log(`⏭️  Kihagyva: ${email} (már létezik)`);
          skipped++;
          continue;
        }

        // Jelszó hash-elése
        const passwordHash = await bcrypt.hash(password, 10);

        // Alapértelmezett szerepkör: admin (vagy módosítható)
        const defaultRole = 'fogpótlástanász';

        // Felhasználó létrehozása
        await pool.query(
          `INSERT INTO users (email, password_hash, role, active)
           VALUES ($1, $2, $3, true)`,
          [email.toLowerCase().trim(), passwordHash, defaultRole]
        );

        console.log(`✅ Létrehozva: ${email} (${defaultRole})`);
        created++;
      } catch (error) {
        console.error(`❌ Hiba ${email} létrehozásakor:`, error.message);
        errors++;
      }
    }

    console.log(`\n📊 Összesítés:`);
    console.log(`   ✅ Létrehozva: ${created}`);
    console.log(`   ⏭️  Kihagyva: ${skipped}`);
    console.log(`   ❌ Hiba: ${errors}`);
    console.log(`\n✨ Migráció befejezve!\n`);

  } catch (error) {
    console.error('Kritikus hiba:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrateUsers().catch(console.error);

