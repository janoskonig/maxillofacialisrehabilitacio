/**
 * Fejlesztői DB seed — SZINTETIKUS adat, valós beteg-PII nélkül.
 *
 * Létrehoz:
 *  - 4 teszt-usert (admin / fogpótlástanász / beutaló orvos / technikus),
 *    jelszó mindenkinél: dev12345
 *  - 8 szintetikus beteget vegyes állapotokban (nyitott epizód, hiányzó
 *    életmód-mezők a nudge-teszthez, beutalt betegek a beutaló-panelhez,
 *    fogpótlásos beteg az elégedettség-kérdéshez)
 *
 * Idempotens: e-mail/TAJ ütközésnél kihagy. CSAK dev DB-re való.
 *
 * Usage: npx tsx scripts/dev/seed-dev-db.ts
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envLocalPath = path.join(__dirname, '..', '..', '.env.local');
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });
else dotenv.config();

import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

// Védőkorlát: éles hostra SOHA.
if (process.env.DATABASE_URL?.includes('165.232.117.171')) {
  console.error('MEGTAGADVA: a DATABASE_URL az éles hostra mutat — a seed csak dev DB-re futtatható.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : undefined,
});

/** Érvényes TAJ generálása: 8 véletlen számjegy + mod-10 ellenőrzőszám. */
function makeTaj(seed: number): string {
  const digits = String(10000000 + ((seed * 7919) % 89999999)).slice(0, 8).split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 7), 0);
  const check = sum % 10;
  const all = [...digits, check].join('');
  return `${all.slice(0, 3)}-${all.slice(3, 6)}-${all.slice(6)}`;
}

const USERS = [
  { email: 'admin@dev.local', role: 'admin', doktor_neve: 'Dev Admin dr.', intezmeny: null },
  { email: 'fogpot@dev.local', role: 'fogpótlástanász', doktor_neve: 'Dev Fogpótlástanász dr.', intezmeny: 'SE Fogpótlástani Klinika' },
  { email: 'beutalo@dev.local', role: 'beutalo_orvos', doktor_neve: 'Dev Beutaló dr.', intezmeny: 'Észak-Pesti Centrumkórház' },
  { email: 'technikus@dev.local', role: 'technikus', doktor_neve: 'Dev Technikus', intezmeny: null },
];

const KERESZTNEVEK = ['Anna', 'Béla', 'Cecília', 'Dénes', 'Eszter', 'Ferenc', 'Gizella', 'Henrik'];

async function main() {
  const hash = await bcrypt.hash('dev12345', 10);

  for (const u of USERS) {
    await pool.query(
      `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny)
       VALUES ($1, $2, $3, true, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [u.email, hash, u.role, u.doktor_neve, u.intezmeny]
    );
  }
  console.log(`users: ${USERS.length} (jelszó: dev12345)`);

  const fogpot = await pool.query(`SELECT id FROM users WHERE email = 'fogpot@dev.local'`);
  const kezeloId = fogpot.rows[0].id;

  let created = 0;
  for (let i = 0; i < KERESZTNEVEK.length; i++) {
    const nev = `Tesztbeteg ${KERESZTNEVEK[i]}`;
    const taj = makeTaj(i + 1);
    const email = `beteg${i + 1}@dev.local`;
    const birth = `${1940 + i * 7}-0${(i % 9) + 1}-15`;

    const exists = await pool.query(`SELECT 1 FROM patients WHERE REPLACE(taj,'-','') = REPLACE($1,'-','')`, [taj]);
    if (exists.rows.length > 0) continue;

    const p = await pool.query(
      `INSERT INTO patients (nev, taj, email, telefonszam, szuletesi_datum, nem, kezeleoorvos, kezeleoorvos_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'Dev Fogpótlástanász dr.', $7, 'seed')
       RETURNING id`,
      [nev, taj, email, `+3630111${String(1000 + i)}`, birth, i % 2 === 0 ? 'no' : 'ferfi', kezeloId]
    );
    const pid = p.rows[0].id;

    // Altáblák: anamnézis (életmód szándékosan üresen az 1-5. betegnél → nudge-teszt),
    // fogazat (a 3. betegnél felső fogpótlással), beutaló (mind a Dev Beutalóé).
    await pool.query(
      `INSERT INTO patient_anamnesis (patient_id, kezelesre_erkezes_indoka, diagnozis, bno, alkoholfogyasztas, dohanyzas_szam)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        pid,
        i % 3 === 0 ? 'onkológiai kezelés utáni állapot' : i % 3 === 1 ? 'traumás sérülés' : 'veleszületett rendellenesség',
        `Szintetikus diagnózis ${i + 1}`,
        i >= 5 ? 'C03' : null,
        i >= 5 ? 'alkalmanként' : null,
        i >= 5 ? 'nem dohányzik' : null,
      ]
    );
    await pool.query(
      `INSERT INTO patient_dental_status (patient_id, meglevo_fogak, felso_fogpotlas_van)
       VALUES ($1, $2::jsonb, $3)`,
      [pid, JSON.stringify({ '11': 'M', '12': 'F', '21': 'D' }), i === 2]
    );
    await pool.query(
      `INSERT INTO patient_referral (patient_id, beutalo_orvos, beutalo_intezmeny)
       VALUES ($1, 'Dev Beutaló dr.', 'Észak-Pesti Centrumkórház')`,
      [pid]
    );

    // Nyitott epizód az első 6 betegnek (nudge/tölcsér tesztekhez).
    if (i < 6) {
      await pool.query(
        `INSERT INTO patient_episodes (patient_id, reason, chief_complaint, status)
         VALUES ($1, $2, 'Szintetikus panasz (seed)', 'open')`,
        [pid, i % 3 === 0 ? 'onkológiai kezelés utáni állapot' : i % 3 === 1 ? 'traumás sérülés' : 'veleszületett rendellenesség']
      );
    }
    created += 1;
  }
  console.log(`patients: ${created} új szintetikus beteg (6 nyitott epizóddal)`);

  await pool.end();
}

main().catch(err => {
  console.error('Seed hiba:', err);
  process.exit(1);
});
