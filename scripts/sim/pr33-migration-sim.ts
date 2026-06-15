/**
 * Focused PR #33 migration simulation (dummy data, throwaway pr33_sim DB).
 *
 * Directly demonstrates the two deploy-time schema fixes:
 *   - migration 059 (headline fix #6): a `no_show` must RELEASE the work-phase
 *     unique index so the phase can be re-booked. Shown by reproducing the bug
 *     under the pre-059 index, then proving migration 059 fixes it.
 *   - migration 058: step_code widened 50 -> 80 so a 54-char pathway code books.
 *
 * Run: tsx scripts/sim/pr33-migration-sim.ts   (needs DATABASE_URL -> pr33_sim)
 */
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL: ${name} ${detail}`); }
}
function read(p: string) { return readFileSync(join(process.cwd(), p), 'utf8'); }

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // ---------- migration 059: no_show releases the work-phase unique index ----------
  // appointments shaped like production (work_phase_id present), with the PRE-059
  // partial unique index that (incorrectly) treats no_show as an active booking.
  await c.query(`
    CREATE TABLE appointments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      work_phase_id uuid,
      appointment_status text,
      step_code varchar(50)
    );
    -- PRE-059 index (from migration 029): excludes cancelled + unsuccessful, NOT no_show
    CREATE UNIQUE INDEX idx_appointments_unique_work_phase_active
      ON appointments (work_phase_id)
      WHERE work_phase_id IS NOT NULL
        AND (appointment_status IS NULL
             OR appointment_status NOT IN ('cancelled_by_doctor','cancelled_by_patient','unsuccessful'));
  `);
  const W = '11111111-1111-1111-1111-111111111111';

  // a no_show'd attempt on work phase W
  await c.query(`INSERT INTO appointments (work_phase_id, appointment_status) VALUES ($1,'no_show')`, [W]);

  // PRE-059: trying to re-book (new active appt, NULL status) on W must FAIL (the bug)
  let blockedPre059 = false;
  try {
    await c.query(`INSERT INTO appointments (work_phase_id, appointment_status) VALUES ($1, NULL)`, [W]);
  } catch (e: any) {
    blockedPre059 = e?.code === '23505'; // unique_violation
  }
  check('PRE-059: no_show blocks re-booking the phase (bug reproduced -> 23505)', blockedPre059);

  // apply the REAL migration 059
  await c.query(read('database/migrations/059_no_show_releases_work_phase.sql'));
  console.log('  [migration 059] applied');

  // POST-059: re-booking the no_show'd phase must now SUCCEED
  let allowedPost059 = false;
  try {
    await c.query(`INSERT INTO appointments (work_phase_id, appointment_status) VALUES ($1, NULL)`, [W]);
    allowedPost059 = true;
  } catch (e: any) {
    allowedPost059 = false;
  }
  check('POST-059: no_show phase can be re-booked (fix #6 works)', allowedPost059);

  // and the index still blocks a genuine double active booking
  let stillBlocksDouble = false;
  try {
    await c.query(`INSERT INTO appointments (work_phase_id, appointment_status) VALUES ($1, NULL)`, [W]);
  } catch (e: any) { stillBlocksDouble = e?.code === '23505'; }
  check('POST-059: a second ACTIVE booking on the phase is still blocked (no double-booking)', stillBlocksDouble);

  // idempotency
  await c.query(read('database/migrations/059_no_show_releases_work_phase.sql'));
  check('migration 059 idempotent (second run ok)', true);

  // ---------- migration 058: widen step_code 50 -> 80 ----------
  await c.query(`
    CREATE TABLE slot_intents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), step_code varchar(50));
    CREATE TABLE episode_next_step_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), step_code varchar(50));
  `);
  const longCode = 'Kapocselhorgonyzású részleges fémlemezes fogpótlás'; // 49 chars; pad to 54
  const code54 = (longCode + ' XXXXX').slice(0, 54);
  check('test code is >50 chars', code54.length > 50, `len=${code54.length}`);

  // PRE-058: inserting a >50-char code into appointments.step_code must FAIL
  let pre058Fail = false;
  try {
    await c.query(`INSERT INTO appointments (step_code) VALUES ($1)`, [code54]);
  } catch (e: any) { pre058Fail = e?.code === '22001'; } // string_data_right_truncation
  check('PRE-058: 54-char step_code overflows varchar(50) (bug reproduced -> 22001)', pre058Fail);

  // apply REAL migration 058
  await c.query(read('database/migrations/058_widen_step_code_to_80.sql'));
  console.log('  [migration 058] applied');

  // POST-058: now it fits
  let post058Ok = false;
  try {
    await c.query(`INSERT INTO appointments (step_code) VALUES ($1)`, [code54]);
    await c.query(`INSERT INTO slot_intents (step_code) VALUES ($1)`, [code54]);
    await c.query(`INSERT INTO episode_next_step_cache (step_code) VALUES ($1)`, [code54]);
    post058Ok = true;
  } catch { post058Ok = false; }
  check('POST-058: 54-char step_code now books across all widened columns', post058Ok);

  await c.end();
  console.log(`\n==== PR #33 migration sim: ${pass} passed, ${fail} failed ====`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
