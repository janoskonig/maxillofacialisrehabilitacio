/**
 * Allow created_via = 'patient_form' on appointments.
 * Drops both possible constraint names (appointments_created_via_check, appointments_created_via_check1)
 * and adds a single constraint that includes patient_form.
 *
 * Usage: npx tsx scripts/run-created-via-patient-form-migration.ts
 * Or:    npm run migrate:created-via-patient-form
 */

import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });
import { getDbPool } from '../lib/db';

async function run() {
  const pool = getDbPool();

  await pool.query('BEGIN');

  try {
    const { rows } = await pool.query(`
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'appointments'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%created_via%'
    `);

    for (const row of rows) {
      console.log(`Dropping constraint: ${row.conname}`);
      await pool.query(`ALTER TABLE appointments DROP CONSTRAINT "${row.conname}"`);
    }

    await pool.query(`
      ALTER TABLE appointments ADD CONSTRAINT appointments_created_via_check
      CHECK (created_via IN ('worklist', 'patient_form', 'patient_self', 'admin_override', 'surgeon_override', 'migration', 'google_import'))
    `);
    await pool.query('COMMIT');
    console.log('OK: appointments created_via constraint updated; patient_form is now allowed.');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  } finally {
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
