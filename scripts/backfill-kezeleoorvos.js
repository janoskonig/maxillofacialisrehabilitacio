/**
 * Backfill `patients.kezeleoorvos_user_id` (és sync `patients.kezeleoorvos`
 * VARCHAR mező) az új recompute szabály szerint, MINDEN beteghez.
 *
 * Logika tükör — lásd lib/recompute-kezeleoorvos.ts:
 *   B-eset:  legutóbb nyitott AKTÍV `patient_episodes` provider nyer.
 *   A-eset:  ha B nincs → now()-hoz időben legközelebbi nem-cancelled,
 *            nem-rejected appointment dentist_email → users.id (ablak:
 *            jövőbeli ∪ utolsó 30 nap).
 *   Egyik sem: NEM írjuk át (recompute „nem vonja vissza").
 *
 * A script idempotens — ismételten futtatható, csak a változó sorokat írja.
 *
 * Felülírás: a felhasználó döntése szerint (kérdéssorozat 3. pont) az új
 * szabály felülírja a meglévő `kezeleoorvos` értékeket. Ezt a recompute
 * SQL-ek természetesen megteszik (a write feltétele a user_id változás).
 *
 * Env:
 *   DATABASE_URL              required
 *   DRY_RUN                   default 0 (ha 1: nem ír, csak számol)
 *   BATCH_SIZE                default 500 (egy iterációban hány páciens)
 *
 * Usage:
 *   npm run backfill:kezeleoorvos
 *   DRY_RUN=1 npm run backfill:kezeleoorvos
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

const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const batchSize = Math.max(50, Math.min(parseInt(process.env.BATCH_SIZE || '500', 10), 5000));

async function columnExists(pool, table, column) {
  const r = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column]
  );
  return r.rows[0]?.exists === true;
}

/**
 * Kiszámolja a beteg új kezelőorvosát. NEM ír — csak a jelöltet adja vissza.
 * Visszatérési érték: { userId: string|null, name: string|null, source: 'episode'|'appointment'|'none' }
 */
async function computeCandidate(pool, patientId) {
  const ep = await pool.query(
    `SELECT u.id AS user_id, COALESCE(u.doktor_neve, u.email) AS name
       FROM patient_episodes pe
       JOIN users u ON u.id = pe.assigned_provider_id
      WHERE pe.patient_id = $1
        AND pe.status = 'active'
        AND pe.assigned_provider_id IS NOT NULL
      ORDER BY pe.opened_at DESC NULLS LAST, pe.created_at DESC NULLS LAST
      LIMIT 1`,
    [patientId]
  );
  if (ep.rows.length > 0) {
    return { userId: ep.rows[0].user_id, name: ep.rows[0].name, source: 'episode' };
  }

  const ap = await pool.query(
    `SELECT u.id AS user_id, COALESCE(u.doktor_neve, u.email) AS name
       FROM appointments a
       JOIN users u ON u.email = a.dentist_email
      WHERE a.patient_id = $1
        AND a.start_time IS NOT NULL
        AND a.start_time >= now() - interval '30 days'
        AND (a.appointment_status IS NULL
             OR a.appointment_status NOT IN ('cancelled_by_doctor', 'cancelled_by_patient'))
        AND (a.approval_status IS NULL OR a.approval_status <> 'rejected')
      ORDER BY ABS(EXTRACT(EPOCH FROM (a.start_time - now()))) ASC,
               a.start_time ASC
      LIMIT 1`,
    [patientId]
  );
  if (ap.rows.length > 0) {
    return { userId: ap.rows[0].user_id, name: ap.rows[0].name, source: 'appointment' };
  }

  return { userId: null, name: null, source: 'none' };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL kötelező');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_URL?.includes('sslmode=') ||
      process.env.DATABASE_URL?.includes('render.com') ||
      process.env.DATABASE_URL?.includes('amazonaws.com')
        ? { rejectUnauthorized: false }
        : undefined,
  });

  try {
    if (!(await columnExists(pool, 'patients', 'kezeleoorvos_user_id'))) {
      throw new Error(
        'patients.kezeleoorvos_user_id oszlop hiányzik — futtasd előbb a 027-es migrációt (npm run migrate:027-kezeleoorvos)'
      );
    }

    const totalRow = await pool.query(`SELECT COUNT(*)::int AS total FROM patients`);
    const total = totalRow.rows[0].total;

    console.log('───────────────────────────────────────────────');
    console.log(`Kezelőorvos backfill — beteg darabszám: ${total}`);
    console.log(`DRY_RUN=${dryRun ? 'IGEN' : 'nem'}, BATCH_SIZE=${batchSize}`);
    console.log('───────────────────────────────────────────────');

    let lastId = '00000000-0000-0000-0000-000000000000';
    const stats = {
      processed: 0,
      changedUserId: 0,
      changedNameOnly: 0,
      noCandidatePreserved: 0,
      noCandidateNullStays: 0,
      sourceEpisode: 0,
      sourceAppointment: 0,
    };

    while (true) {
      const batch = await pool.query(
        `SELECT id, kezeleoorvos_user_id, kezeleoorvos
           FROM patients
          WHERE id > $1
          ORDER BY id ASC
          LIMIT $2`,
        [lastId, batchSize]
      );
      if (batch.rows.length === 0) break;

      for (const row of batch.rows) {
        stats.processed++;
        lastId = row.id;

        const candidate = await computeCandidate(pool, row.id);

        if (candidate.source === 'episode') stats.sourceEpisode++;
        if (candidate.source === 'appointment') stats.sourceAppointment++;

        if (candidate.userId === null) {
          // „Ne vonja vissza": ha van meglévő érték, hagyjuk; ha nincs, marad NULL.
          if (row.kezeleoorvos_user_id) {
            stats.noCandidatePreserved++;
          } else {
            stats.noCandidateNullStays++;
          }
          continue;
        }

        const userIdChanged = row.kezeleoorvos_user_id !== candidate.userId;
        const nameDrift = (row.kezeleoorvos || '') !== (candidate.name || '');

        if (userIdChanged) {
          stats.changedUserId++;
          if (!dryRun) {
            await pool.query(
              `UPDATE patients
                  SET kezeleoorvos_user_id = $1,
                      kezeleoorvos = $2
                WHERE id = $3`,
              [candidate.userId, candidate.name, row.id]
            );
          }
        } else if (nameDrift) {
          stats.changedNameOnly++;
          if (!dryRun) {
            await pool.query(
              `UPDATE patients SET kezeleoorvos = $1 WHERE id = $2`,
              [candidate.name, row.id]
            );
          }
        }
      }

      console.log(
        `  Feldolgozva: ${stats.processed}/${total}  (user_id változott: ${stats.changedUserId}, csak név: ${stats.changedNameOnly})`
      );
    }

    console.log('───────────────────────────────────────────────');
    console.log('Backfill összegzés:');
    console.log(`  Feldolgozott betegek:                     ${stats.processed}`);
    console.log(`  user_id beírva / megváltoztatva:          ${stats.changedUserId}`);
    console.log(`  Csak név (kezeleoorvos VARCHAR) frissült: ${stats.changedNameOnly}`);
    console.log(`  Nincs jelölt, korábbi érték megmaradt:    ${stats.noCandidatePreserved}`);
    console.log(`  Nincs jelölt, NULL marad:                 ${stats.noCandidateNullStays}`);
    console.log(`  ─ jelölt forrása: epizód:                 ${stats.sourceEpisode}`);
    console.log(`  ─ jelölt forrása: időpont:                ${stats.sourceAppointment}`);
    if (dryRun) {
      console.log('  (DRY_RUN aktív — semmilyen UPDATE nem futott le.)');
    }
    console.log('───────────────────────────────────────────────');
  } catch (e) {
    console.error('Backfill hiba:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
