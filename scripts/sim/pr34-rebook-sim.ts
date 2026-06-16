/**
 * Focused PR #34 simulation (dummy data, throwaway pr34_sim DB).
 *
 * Validates the *novel* server logic introduced by the "today's appointments +
 * outcomes" feature, against the SAME data states the production routes produce:
 *   1. migration 060 applies on a legacy-shaped appointments table (3-value
 *      CHECK -> 5-value CHECK + type_label column).
 *   2. The extended appointment_type CHECK accepts recall/egyeb and rejects junk.
 *   3. The EXACT /api/dashboard nextAppointments query (copied verbatim) runs and
 *      computes `rebookNeeded` correctly across every outcome the widget drives.
 *
 * Run: tsx scripts/sim/pr34-rebook-sim.ts   (needs DATABASE_URL -> pr34_sim)
 */
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ FAIL: ${name} ${detail}`); }
}

// --- The EXACT rebookNeeded expression + query shape from app/api/dashboard/route.ts ---
// (kept verbatim so this sim exercises the real SQL, not a paraphrase)
const NEXT_APPOINTMENTS_SQL = `SELECT
  a.id,
  a.appointment_status as "appointmentStatus",
  a.appointment_type as "appointmentType",
  a.type_label as "typeLabel",
  a.episode_id as "episodeId",
  a.step_code as "stepCode",
  COALESCE(ewp.custom_label, ewp.work_phase_code, a.step_code) as "stepLabel",
  (
    a.episode_id IS NOT NULL
    AND a.appointment_status IN ('no_show','cancelled_by_doctor','cancelled_by_patient','unsuccessful')
    AND EXISTS (
      SELECT 1 FROM episode_work_phases ewp2
      WHERE ewp2.episode_id = a.episode_id
        AND (ewp2.id = a.work_phase_id OR (a.work_phase_id IS NULL AND ewp2.work_phase_code = a.step_code))
        AND ewp2.status = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1 FROM appointments a2
      WHERE a2.episode_id = a.episode_id
        AND a2.step_code = a.step_code
        AND a2.id <> a.id
        AND (a2.appointment_status IS NULL
             OR a2.appointment_status NOT IN ('cancelled_by_doctor','cancelled_by_patient','no_show','unsuccessful'))
    )
  ) as "rebookNeeded"
FROM appointments a
JOIN available_time_slots ats ON a.time_slot_id = ats.id
JOIN patients p ON a.patient_id = p.id
LEFT JOIN users u ON a.dentist_email = u.email
LEFT JOIN LATERAL (
  SELECT ewp.custom_label, ewp.work_phase_code
  FROM episode_work_phases ewp
  WHERE ewp.episode_id = a.episode_id
    AND (ewp.id = a.work_phase_id OR (a.work_phase_id IS NULL AND ewp.work_phase_code = a.step_code))
  ORDER BY (ewp.id = a.work_phase_id) DESC
  LIMIT 1
) ewp ON true
WHERE ats.start_time >= $1 AND ats.start_time <= $2
ORDER BY ats.start_time ASC`;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // ---- minimal legacy-shaped schema (only the columns the feature touches) ----
  await c.query(`
    CREATE TABLE patients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nev text, taj text);
    CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, doktor_neve text);
    CREATE TABLE patient_episodes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid);
    CREATE TABLE episode_work_phases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      episode_id uuid, work_phase_code varchar(80), custom_label text,
      status text, appointment_id uuid, seq int, pathway_order_index int);
    CREATE TABLE available_time_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      start_time timestamptz, cim text, teremszam text,
      state text, status text, user_id uuid, updated_at timestamptz DEFAULT now());
    -- legacy-shaped appointments: 3-value CHECK, NO type_label (pre migration 060)
    CREATE TABLE appointments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id uuid, time_slot_id uuid, episode_id uuid,
      step_code varchar(80), work_phase_id uuid,
      appointment_status text, completion_notes text, is_late boolean,
      dentist_email text, attempt_number int DEFAULT 1,
      appointment_type varchar(30)
        CHECK (appointment_type IN ('elso_konzultacio','munkafazis','kontroll')));
  `);
  console.log('\n[schema] legacy-shaped minimal schema created (appointments has 3-value type CHECK, no type_label)');

  // ---- 1. apply the REAL migration 060 file ----
  const mig060 = readFileSync(join(process.cwd(), 'database/migrations/060_appointment_type_extend_and_label.sql'), 'utf8');
  await c.query(mig060);
  console.log('\n[migration 060] applied');
  const colExists = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='type_label'`);
  check('migration 060: type_label column added', colExists.rowCount === 1);
  // idempotency: run again
  await c.query(mig060);
  check('migration 060: idempotent (second run ok)', true);

  // ---- seed dummy data ----
  const { rows: [pat] } = await c.query(`INSERT INTO patients (nev, taj) VALUES ('Teszt Beteg','111') RETURNING id`);
  const { rows: [doc] } = await c.query(`INSERT INTO users (email, doktor_neve) VALUES ('dr@x.hu','Dr. Teszt') RETURNING id`);
  const { rows: [epi] } = await c.query(`INSERT INTO patient_episodes (patient_id) VALUES ($1) RETURNING id`, [pat.id]);
  const epId = epi.id;
  const today = new Date(); today.setHours(10, 0, 0, 0);

  // helper: create a slot + work phase + appointment in a given outcome state
  async function scenario(opts: {
    stepCode: string; ewpStatus: string; apptStatus: string | null;
    type?: string | null; typeLabel?: string | null; episodeId?: string | null;
    linkEwp?: boolean; extraActiveSameStep?: boolean; customLabel?: string;
  }) {
    const { rows: [slot] } = await c.query(
      `INSERT INTO available_time_slots (start_time, state, status, user_id) VALUES ($1,'booked','booked',$2) RETURNING id`,
      [today.toISOString(), doc.id]);
    const epForAppt = opts.episodeId === null ? null : epId;
    let ewpId: string | null = null;
    if (epForAppt) {
      const { rows: [ewp] } = await c.query(
        `INSERT INTO episode_work_phases (episode_id, work_phase_code, custom_label, status, seq, pathway_order_index)
         VALUES ($1,$2,$3,$4,1,1) RETURNING id`,
        [epForAppt, opts.stepCode, opts.customLabel ?? null, opts.ewpStatus]);
      ewpId = ewp.id;
    }
    const { rows: [appt] } = await c.query(
      `INSERT INTO appointments (patient_id, time_slot_id, episode_id, step_code, work_phase_id, appointment_status, appointment_type, type_label, dentist_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'dr@x.hu') RETURNING id`,
      [pat.id, slot.id, epForAppt, opts.stepCode, opts.linkEwp ? ewpId : null, opts.apptStatus, opts.type ?? null, opts.typeLabel ?? null]);
    if (ewpId && opts.linkEwp) {
      await c.query(`UPDATE episode_work_phases SET appointment_id=$1 WHERE id=$2`, [appt.id, ewpId]);
    }
    if (opts.extraActiveSameStep && epForAppt) {
      const { rows: [slot2] } = await c.query(
        `INSERT INTO available_time_slots (start_time, state, status, user_id) VALUES ($1,'booked','booked',$2) RETURNING id`,
        [today.toISOString(), doc.id]);
      await c.query(
        `INSERT INTO appointments (patient_id, time_slot_id, episode_id, step_code, appointment_status, dentist_email)
         VALUES ($1,$2,$3,$4,NULL,'dr@x.hu')`, [pat.id, slot2.id, epForAppt, opts.stepCode]);
    }
    return appt.id as string;
  }

  // 2. CHECK constraint accepts new types, rejects junk
  try {
    await scenario({ stepCode: 'RECALL_X', ewpStatus: 'scheduled', apptStatus: null, type: 'recall', typeLabel: 'implantátum kontroll 6h' });
    check('type CHECK accepts recall + free-text type_label', true);
  } catch (e) { check('type CHECK accepts recall + free-text type_label', false, String(e)); }
  try {
    await scenario({ stepCode: 'JUNK', ewpStatus: 'scheduled', apptStatus: null, type: 'totally_invalid' });
    check('type CHECK rejects invalid type', false);
  } catch { check('type CHECK rejects invalid type', true); }

  // 3. rebookNeeded across outcomes (states mirror what status/attempt-outcome routes produce)
  const start = new Date(today); start.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setHours(23, 59, 59, 999);
  async function rebookOf(id: string): Promise<boolean> {
    const { rows } = await c.query(NEXT_APPOINTMENTS_SQL, [start.toISOString(), end.toISOString()]);
    const r = rows.find((x: any) => x.id === id);
    if (!r) throw new Error('appointment not returned by dashboard query: ' + id);
    return r.rebookNeeded === true;
  }

  const completed = await scenario({ stepCode: 'IMPRINT', ewpStatus: 'completed', apptStatus: 'completed', type: 'munkafazis', linkEwp: true });
  check('completed plan step -> rebookNeeded FALSE', !(await rebookOf(completed)));

  const noShow = await scenario({ stepCode: 'IMPRINT2', ewpStatus: 'pending', apptStatus: 'no_show', type: 'munkafazis' });
  check('no_show + reopened phase -> rebookNeeded TRUE', await rebookOf(noShow));

  const cancelled = await scenario({ stepCode: 'TRYIN', ewpStatus: 'pending', apptStatus: 'cancelled_by_patient', type: 'munkafazis' });
  check('cancelled + reopened phase -> rebookNeeded TRUE', await rebookOf(cancelled));

  const unsucc = await scenario({ stepCode: 'FINAL', ewpStatus: 'pending', apptStatus: 'unsuccessful', type: 'munkafazis' });
  check('unsuccessful + reopened phase -> rebookNeeded TRUE', await rebookOf(unsucc));

  const noShowButRebooked = await scenario({ stepCode: 'IMPRINT3', ewpStatus: 'pending', apptStatus: 'no_show', type: 'munkafazis', extraActiveSameStep: true });
  check('no_show but another active appt on step -> rebookNeeded FALSE', !(await rebookOf(noShowButRebooked)));

  const consult = await scenario({ stepCode: 'KONZ', ewpStatus: 'scheduled', apptStatus: 'no_show', type: 'elso_konzultacio', episodeId: null });
  check('non-plan (no episode) no_show -> rebookNeeded FALSE', !(await rebookOf(consult)));

  // 4. dashboard query surfaces type + label + step label
  const { rows } = await c.query(NEXT_APPOINTMENTS_SQL, [start.toISOString(), end.toISOString()]);
  const recallRow = rows.find((x: any) => x.appointmentType === 'recall');
  check('dashboard query returns appointmentType', !!recallRow);
  check('dashboard query returns free-text typeLabel', recallRow?.typeLabel === 'implantátum kontroll 6h');

  await c.end();
  console.log(`\n==== PR #34 focused sim: ${pass} passed, ${fail} failed ====`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
