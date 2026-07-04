/**
 * Egyszeri, READ-ONLY duplikátum-audit a meglévő betegállományon.
 *
 * Két csoportot listáz:
 *   A) normalizált TAJ ütközések (ugyanaz a 9 számjegy több betegnél) —
 *      a POST /api/patients 409-es blokkja előtt rögzített duplikátumok;
 *   B) azonos születési dátum + hasonló (normalizált) név, eltérő vagy
 *      hiányzó TAJ — valószínű újrarögzítések.
 *
 * A talált csoportokat kézzel kell átnézni; az összevonás az admin
 * merge-patients funkciójával történhet. A script semmit nem módosít.
 *
 * Usage: npx tsx scripts/audit-duplicate-patients.ts
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

import { getDbPool } from '../lib/db';
import { namesSimilar, normalizeTaj } from '../lib/patient-duplicate-check';

interface PatientRow {
  id: string;
  nev: string | null;
  taj: string | null;
  szuletesi_datum: string | null;
  created_at: string;
}

async function main() {
  const pool = getDbPool();

  // A) Normalizált TAJ ütközések
  const tajCollisions = await pool.query(
    `SELECT REPLACE(taj, '-', '') AS taj_normalized,
            COUNT(*) AS db,
            json_agg(json_build_object('id', id, 'nev', nev, 'szuletesi_datum', szuletesi_datum, 'created_at', created_at) ORDER BY created_at) AS betegek
     FROM patients
     WHERE taj IS NOT NULL AND REPLACE(taj, '-', '') <> ''
     GROUP BY REPLACE(taj, '-', '')
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC`
  );

  // B) Azonos születési dátum — a név-hasonlóságot alkalmazás-oldalon szűrjük
  const dobGroups = await pool.query(
    `SELECT szuletesi_datum::text AS szuletesi_datum,
            json_agg(json_build_object('id', id, 'nev', nev, 'taj', taj, 'created_at', created_at) ORDER BY created_at) AS betegek
     FROM patients
     WHERE szuletesi_datum IS NOT NULL
     GROUP BY szuletesi_datum
     HAVING COUNT(*) > 1`
  );

  const nameDobSuspects: Array<{ szuletesi_datum: string; betegek: PatientRow[] }> = [];
  for (const group of dobGroups.rows) {
    const patients: PatientRow[] = group.betegek;
    const flagged = new Set<string>();
    for (let i = 0; i < patients.length; i++) {
      for (let j = i + 1; j < patients.length; j++) {
        const a = patients[i];
        const b = patients[j];
        // A pontos TAJ-egyezést az A) csoport már listázza — itt a
        // különböző/hiányzó TAJ-ú, hasonló nevű párok érdekesek.
        const sameTaj =
          normalizeTaj(a.taj) !== '' && normalizeTaj(a.taj) === normalizeTaj(b.taj);
        if (sameTaj) continue;
        if (namesSimilar(a.nev, b.nev)) {
          flagged.add(a.id);
          flagged.add(b.id);
        }
      }
    }
    if (flagged.size > 0) {
      nameDobSuspects.push({
        szuletesi_datum: group.szuletesi_datum,
        betegek: patients.filter(p => flagged.has(p.id)),
      });
    }
  }

  const report = {
    generated_for: 'duplicate-patient audit (read-only)',
    taj_collisions: {
      count: tajCollisions.rows.length,
      groups: tajCollisions.rows,
    },
    name_dob_suspects: {
      count: nameDobSuspects.length,
      groups: nameDobSuspects,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `\nÖsszegzés: ${tajCollisions.rows.length} TAJ-ütközés csoport, ` +
      `${nameDobSuspects.length} név+születési dátum gyanús csoport.`
  );
  console.error('Az összevonáshoz az admin felület merge-patients funkciója használható.');

  await pool.end();
}

main().catch(err => {
  console.error('Audit hiba:', err);
  process.exit(1);
});
