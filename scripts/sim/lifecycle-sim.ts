/**
 * Failure-injection LIFECYCLE simulation.
 *
 * Unlike the happy-path booking simulation, this drives long multi-phase plans
 * through realistic failures injected via the REAL route handlers:
 *   • unsuccessful  → PATCH /api/appointments/:id/attempt-outcome (mark_unsuccessful)
 *   • no_show       → PATCH /api/appointments/:id/status
 *   • cancelled     → PATCH /api/appointments/:id/status
 * then re-books (retries) until each phase completes, and asserts the whole plan
 * heals correctly at scale.
 *
 * Deterministic failure schedule (per phase index) so attempt_number is exactly
 * predictable — including that a CANCEL does NOT count as an attempt.
 *
 * Run: npx tsx scripts/sim/lifecycle-sim.ts   (exit 0 = all invariants hold)
 */
import './load-env'; // first: env before auth-server captures JWT_SECRET

import { getDbPool } from '../../lib/db';
import { createAppointment } from '../../lib/appointment-service';
import { generateEpisodeWorkPhases } from '../../lib/generate-episode-work-phases';
import { createOpenEpisodeWithInitialStageZero } from '../../lib/patient-episode-create';
import { probeAppointmentsWorkPhaseIdColumn } from '../../lib/active-appointment';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { PATCH as patchStatus } from '../../app/api/appointments/[id]/status/route';
import { PATCH as patchAttemptOutcome } from '../../app/api/appointments/[id]/attempt-outcome/route';

const pool = getDbPool();
const q = async <T = any>(s: string, p: unknown[] = []): Promise<T[]> => (await pool.query(s, p)).rows as T[];
let passN = 0, failN = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passN++; console.log(`  ✓ ${name}`); }
  else { failN++; console.log(`  ✗ ${name}  ${detail}`); }
}
const rnd = () => Math.floor(Math.random() * 1e9);

// 12-phase plan: consult + 11 work phases.
type Phase = { pool: 'consult' | 'work'; label: string; work_phase_code: string; duration_minutes: number; default_days_offset: number };
const PHASES: Phase[] = [
  { pool: 'consult', label: 'Konzultáció', work_phase_code: 'consult_1', duration_minutes: 30, default_days_offset: 0 },
  ...Array.from({ length: 11 }, (_, i) => ({
    pool: 'work' as const, label: `Munkafázis ${i + 1}`,
    work_phase_code: `w_${String(i + 1).padStart(2, '0')}`,
    duration_minutes: 30, default_days_offset: (i + 1) * 14,
  })),
];

// Injected failures BEFORE the successful attempt, by phase index. The expected
// final attempt_number is 1 + (#unsuccessful + #no_show); a cancel does NOT count.
const FAILURE_SCHEDULE: Record<number, Array<'unsuccessful' | 'no_show' | 'cancelled'>> = {
  2: ['unsuccessful'],
  4: ['no_show'],
  6: ['cancelled'],
  8: ['no_show', 'no_show'],
  10: ['unsuccessful', 'no_show'],
};
const expectedAttempt = (idx: number) =>
  1 + (FAILURE_SCHEDULE[idx] ?? []).filter((f) => f !== 'cancelled').length;

async function ensureProvider() {
  const r = await q<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny)
     VALUES ('lifecycle.provider@sim.local', 'x', 'fogpótlástanász', true, 'Dr. Lifecycle', 'Sim')
     ON CONFLICT (email) DO UPDATE SET active = true RETURNING id`);
  return { id: r[0].id, email: 'lifecycle.provider@sim.local' };
}
async function mkPatient(tag: string) {
  return (await q<{ id: string }>(`INSERT INTO patients (nev, taj, created_by) VALUES ($1, $2, 'lc@local') RETURNING id`,
    [`LC ${tag}`, String(rnd()).padStart(10, '0').slice(0, 10)]))[0].id;
}
async function mkPathway() {
  const code = `lc_${Date.now()}_${rnd()}`.slice(0, 40);
  const tt = (await q<{ id: string }>(`INSERT INTO treatment_types (code, label_hu) VALUES ($1, $1) RETURNING id`, [code]))[0].id;
  const json = JSON.stringify(PHASES);
  return (await q<{ id: string }>(
    `INSERT INTO care_pathways (name, treatment_type_id, work_phases_json, steps_json, version, priority)
     VALUES ($1, $2, $3::jsonb, $3::jsonb, 1, 100) RETURNING id`, [code, tt, json]))[0].id;
}
async function mkEpisode(patientId: string, pathwayId: string, providerId: string) {
  const ep = await createOpenEpisodeWithInitialStageZero(pool, {
    patientId, reason: 'onkológiai kezelés utáni állapot', chiefComplaint: 'LC', caseTitle: 'LC',
    parentEpisodeId: null, triggerType: null, treatmentTypeId: null, createdBy: 'lc@local' });
  await q(`UPDATE patient_episodes SET care_pathway_id = $2, assigned_provider_id = $3, opened_at = now(), plan_start_date = now() WHERE id = $1`,
    [ep.id, pathwayId, providerId]);
  await generateEpisodeWorkPhases(pool, ep.id);
  return ep.id;
}
let dayCursor = 1;
async function mkSlot(providerId: string) {
  const d = new Date(); d.setDate(d.getDate() + dayCursor); d.setHours(9, 0, 0, 0); dayCursor += 1;
  return (await q<{ id: string }>(
    `INSERT INTO available_time_slots (user_id, start_time, status, state, slot_purpose, duration_minutes, source)
     VALUES ($1, $2, 'available', 'free', 'flexible', 90, 'manual') RETURNING id`,
    [providerId, d.toISOString()]))[0].id;
}

async function main() {
  console.log('=== FAILURE-INJECTION LIFECYCLE SIMULATION ===');
  await probeAppointmentsWorkPhaseIdColumn(pool);
  const prov = await ensureProvider();
  const auth = { email: prov.email, userId: prov.id, role: 'admin' };
  const token = await new SignJWT({ userId: prov.id, email: prov.email, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('2h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production'));

  const callStatus = (apptId: string, appointmentStatus: string, completionNotes?: string) =>
    patchStatus(new NextRequest(`http://localhost/api/appointments/${apptId}/status`, {
      method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ appointmentStatus, completionNotes }),
    }), { params: { id: apptId } });
  const callAttemptOutcome = (apptId: string, action: string, reason: string) =>
    patchAttemptOutcome(new NextRequest(`http://localhost/api/appointments/${apptId}/attempt-outcome`, {
      method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    }), { params: { id: apptId } });

  const N_EPISODES = 3;
  const episodeIds: string[] = [];
  const counters = { booked: 0, unsuccessful: 0, no_show: 0, cancelled: 0, completed: 0, retries: 0 };

  for (let e = 0; e < N_EPISODES; e++) {
    const pid = await mkPatient(`ep${e}`);
    const pw = await mkPathway();
    const ep = await mkEpisode(pid, pw, prov.id);
    episodeIds.push(ep);

    for (let idx = 0; idx < PHASES.length; idx++) {
      const phase = PHASES[idx];
      const wp = (await q<{ id: string }>(
        `SELECT id FROM episode_work_phases WHERE episode_id = $1 AND work_phase_code = $2`, [ep, phase.work_phase_code]))[0].id;
      const poolVal = phase.pool;
      const apptType = poolVal === 'consult' ? 'elso_konzultacio' : 'munkafazis';

      const bookOnce = async (): Promise<string> => {
        const slot = await mkSlot(prov.id);
        const r = await createAppointment(pool, {
          patientId: pid, timeSlotId: slot, episodeId: ep, appointmentType: apptType,
          pool: poolVal, createdVia: 'admin_override', stepCode: phase.work_phase_code,
          requiresPrecommit: false, workPhaseId: wp,
        } as any, auth as any);
        if (!r.ok) throw new Error(`booking failed for ${phase.work_phase_code}: ${JSON.stringify((r as any).validationError)}`);
        counters.booked++;
        return (await q<{ id: string }>(`SELECT id FROM appointments WHERE time_slot_id = $1`, [slot]))[0].id;
      };

      let apptId = await bookOnce();
      // Inject the scheduled failures, each followed by a retry.
      for (const failure of FAILURE_SCHEDULE[idx] ?? []) {
        if (failure === 'unsuccessful') {
          const res = await callAttemptOutcome(apptId, 'mark_unsuccessful', 'rossz lenyomat, ismétlés szükséges');
          if (res.status !== 200) throw new Error(`mark_unsuccessful ${res.status} on ${phase.work_phase_code}`);
          counters.unsuccessful++;
        } else {
          // FAILURE_SCHEDULE uses the label 'cancelled'; the canonical wire
          // status is 'cancelled_by_patient'.
          const wireStatus = failure === 'cancelled' ? 'cancelled_by_patient' : failure;
          const res = await callStatus(apptId, wireStatus);
          if (res.status !== 200) throw new Error(`status ${wireStatus} ${res.status} on ${phase.work_phase_code}`);
          if (failure === 'no_show') counters.no_show++; else counters.cancelled++;
        }
        apptId = await bookOnce(); // retry
        counters.retries++;
      }
      // Success: close the visit and the work phase.
      await q(`UPDATE appointments SET appointment_status = 'completed' WHERE id = $1`, [apptId]);
      await q(`UPDATE episode_work_phases SET status = 'completed', appointment_id = $2 WHERE id = $1`, [wp, apptId]);
      counters.completed++;
    }
  }

  console.log(`\nDriven: ${N_EPISODES} episodes × ${PHASES.length} phases.`);
  console.log(`Bookings=${counters.booked} retries=${counters.retries} | unsuccessful=${counters.unsuccessful} no_show=${counters.no_show} cancelled=${counters.cancelled} completed=${counters.completed}`);

  // ── Global invariants (scoped to this run's episodes) ──────────────────────
  console.log('\n--- Invariants ---');
  const epList = episodeIds;

  // 1) No slot double-booked (no time_slot with >1 active appointment).
  const dupSlots = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM (
       SELECT time_slot_id FROM appointments
        WHERE episode_id = ANY($1) AND (appointment_status IS NULL OR appointment_status = 'completed')
        GROUP BY time_slot_id HAVING count(*) > 1) x`, [epList]);
  check('no slot holds >1 active appointment', Number(dupSlots[0].c) === 0, `dups=${dupSlots[0].c}`);

  // 2) No work_phase double-booked (no work_phase_id with >1 active appointment).
  const dupWp = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM (
       SELECT work_phase_id FROM appointments
        WHERE episode_id = ANY($1) AND work_phase_id IS NOT NULL
          AND (appointment_status IS NULL OR appointment_status = 'completed')
        GROUP BY work_phase_id HAVING count(*) > 1) x`, [epList]);
  check('no work phase holds >1 active appointment', Number(dupWp[0].c) === 0, `dups=${dupWp[0].c}`);

  // 3) Every work phase resolved (completed or skipped) — none stuck.
  const unresolved = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM episode_work_phases
      WHERE episode_id = ANY($1) AND status NOT IN ('completed', 'skipped')`, [epList]);
  check('every work phase resolved (no stuck pending/scheduled)', Number(unresolved[0].c) === 0, `unresolved=${unresolved[0].c}`);

  // 4) No dangling EWP link: appointment_id must point to an ACTIVE appointment.
  const dangling = await q<{ c: string }>(
    `SELECT count(*)::int AS c FROM episode_work_phases ewp
       JOIN appointments a ON a.id = ewp.appointment_id
      WHERE ewp.episode_id = ANY($1)
        AND a.appointment_status IN ('cancelled_by_doctor','cancelled_by_patient','no_show','unsuccessful')`, [epList]);
  check('no EWP links to a dead (cancelled/no_show/unsuccessful) appointment', Number(dangling[0].c) === 0, `dangling=${dangling[0].c}`);

  // 5) attempt_number on each completed appointment matches the injected schedule.
  let attemptMismatches = 0;
  for (const ep of epList) {
    for (let idx = 0; idx < PHASES.length; idx++) {
      const code = PHASES[idx].work_phase_code;
      const row = (await q<{ attempt_number: number }>(
        `SELECT attempt_number FROM appointments
          WHERE episode_id = $1 AND step_code = $2 AND appointment_status = 'completed'`, [ep, code]))[0];
      if (!row || Number(row.attempt_number) !== expectedAttempt(idx)) {
        attemptMismatches++;
        if (attemptMismatches <= 3) console.log(`     ↳ ${code}: got ${row?.attempt_number}, expected ${expectedAttempt(idx)} (cancel must not count)`);
      }
    }
  }
  check('attempt_number matches the failure schedule (cancel excluded)', attemptMismatches === 0, `mismatches=${attemptMismatches}`);

  console.log(`\n=== RESULT: ${passN} passed, ${failN} failed ===`);
  await pool.end();
  process.exit(failN > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
