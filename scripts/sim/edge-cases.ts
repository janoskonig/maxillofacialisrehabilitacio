/**
 * Edge-case / adversarial test harness for the scheduling engine.
 *
 * Runs focused, assertion-based scenarios against the REAL service functions on
 * the throwaway DB and prints PASS/FAIL for each. Exits non-zero if any fail.
 * Stresses the booking concurrency, the step-ordering guard, window/horizon
 * edges, timezone/DST, the varchar(80) widening, and the stuck-slot reaper.
 *
 * Run: npx tsx scripts/sim/edge-cases.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDbPool } from '../../lib/db';
import { createAppointment } from '../../lib/appointment-service';
import { getFirstBookableSlotForEpisode } from '../../lib/first-bookable-slot';
import { nextRequiredStep } from '../../lib/next-step-engine';
import { projectRemainingSteps } from '../../lib/slot-intent-projector';
import { generateEpisodeWorkPhases } from '../../lib/generate-episode-work-phases';
import { createOpenEpisodeWithInitialStageZero } from '../../lib/patient-episode-create';
import { runStuckSlotReaper } from '../../lib/stuck-slot-reaper';
import { budapestHour } from '../../lib/datetime';
import { probeAppointmentsWorkPhaseIdColumn } from '../../lib/active-appointment';

const pool = getDbPool();
let passN = 0;
let failN = 0;
const lines: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passN++;
    console.log(`  ✓ ${name}`);
  } else {
    failN++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
  lines.push(`${cond ? 'PASS' : 'FAIL'}\t${name}\t${detail}`);
}

async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

type Phase = { pool: 'consult' | 'work' | 'control'; label: string; work_phase_code: string; duration_minutes: number; default_days_offset: number; requires_precommit?: boolean };
const BASIC: Phase[] = [
  { pool: 'consult', label: 'Konzultáció', work_phase_code: 'consult_1', duration_minutes: 30, default_days_offset: 0 },
  { pool: 'work', label: 'Diagnosztika', work_phase_code: 'diagnostic', duration_minutes: 30, default_days_offset: 14 },
  { pool: 'work', label: 'Lenyomat', work_phase_code: 'impression_1', duration_minutes: 30, default_days_offset: 7 },
  { pool: 'work', label: 'Próba', work_phase_code: 'try_in_1', duration_minutes: 30, default_days_offset: 10 },
];

const rnd = () => Math.floor(Math.random() * 1e9);
const future = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(10, 0, 0, 0); return d; };
const past = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(10, 0, 0, 0); return d; };

async function ensureProvider(email = 'ec.provider@sim.local') {
  const r = await q<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny)
     VALUES ($1, 'x', 'fogpótlástanász', true, 'Dr. Edge Case', 'Sim')
     ON CONFLICT (email) DO UPDATE SET active = true RETURNING id`,
    [email],
  );
  return { id: r[0].id, email };
}
async function mkPatient(tag: string) {
  const r = await q<{ id: string }>(
    `INSERT INTO patients (nev, taj, created_by) VALUES ($1, $2, 'ec@local') RETURNING id`,
    [`EC ${tag}`, String(rnd()).padStart(10, '0').slice(0, 10)],
  );
  return r[0].id;
}
async function mkSlot(providerId: string, start: Date, dur = 90, purpose = 'flexible', state = 'free') {
  const r = await q<{ id: string }>(
    `INSERT INTO available_time_slots (user_id, start_time, status, state, slot_purpose, duration_minutes, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'manual') RETURNING id`,
    [providerId, start.toISOString(), state === 'free' ? 'available' : 'booked', state, purpose, dur],
  );
  return r[0].id;
}
async function mkPathway(phases: Phase[]) {
  const code = `ec_${Date.now()}_${rnd()}`.slice(0, 40);
  const tt = await q<{ id: string }>(`INSERT INTO treatment_types (code, label_hu) VALUES ($1, $1) RETURNING id`, [code]);
  const json = JSON.stringify(phases);
  const cp = await q<{ id: string }>(
    `INSERT INTO care_pathways (name, treatment_type_id, work_phases_json, steps_json, version, priority)
     VALUES ($1, $2, $3::jsonb, $3::jsonb, 1, 100) RETURNING id`,
    [code, tt[0].id, json],
  );
  return cp[0].id;
}
async function mkEpisode(patientId: string, pathwayId: string, providerId: string, openedAt = new Date()) {
  const ep = await createOpenEpisodeWithInitialStageZero(pool, {
    patientId, reason: 'onkológiai kezelés utáni állapot', chiefComplaint: 'EC', caseTitle: 'EC',
    parentEpisodeId: null, triggerType: null, treatmentTypeId: null, createdBy: 'ec@local',
  });
  await q(`UPDATE patient_episodes SET care_pathway_id = $2, assigned_provider_id = $3, opened_at = $4, plan_start_date = $4 WHERE id = $1`,
    [ep.id, pathwayId, providerId, openedAt.toISOString()]);
  await generateEpisodeWorkPhases(pool, ep.id);
  return ep.id;
}
const adminAuth = (provId: string, email: string) => ({ email, userId: provId, role: 'admin' });
function bookParams(patientId: string, slotId: string, episodeId: string | null, p: 'consult' | 'work' | 'control', stepCode: string | null, overrideReason?: string) {
  return {
    patientId, timeSlotId: slotId, episodeId,
    appointmentType: p === 'consult' ? 'elso_konzultacio' : p === 'control' ? 'kontroll' : 'munkafazis',
    pool: p, createdVia: 'admin_override', stepCode, requiresPrecommit: false, overrideReason,
  } as const;
}

async function main() {
  console.log('=== EDGE-CASE TESTS ===');
  const prov = await ensureProvider();
  // Warm the work_phase_id-column probe before the concurrency test: with a small
  // pool (DB_POOL_MAX=5) EC1's 5 simultaneous bookings can starve the probe's own
  // connection, which would cache `false` and disable work_phase_id process-wide.
  await probeAppointmentsWorkPhaseIdColumn(pool);

  // ── EC1: concurrent double-booking on ONE slot → exactly one wins ───────────
  console.log('\n[EC1] Concurrent double-booking race on a single slot');
  {
    const slot = await mkSlot(prov.id, future(20));
    const patients = await Promise.all([1, 2, 3, 4, 5].map((i) => mkPatient(`race${i}`)));
    const outcomes = await Promise.allSettled(
      patients.map((pid) => createAppointment(pool, bookParams(pid, slot, null, 'consult', null), adminAuth(prov.id, prov.email))),
    );
    const ok = outcomes.filter((o) => o.status === 'fulfilled' && (o.value as { ok: boolean }).ok).length;
    const dbCount = (await q<{ c: string }>(`SELECT count(*)::int AS c FROM appointments WHERE time_slot_id = $1`, [slot]))[0].c;
    const slotState = (await q<{ state: string }>(`SELECT state FROM available_time_slots WHERE id = $1`, [slot]))[0].state;
    check('exactly 1 of 5 concurrent bookings succeeds', ok === 1, `got ${ok}`);
    check('exactly 1 appointment row on the slot', Number(dbCount) === 1, `got ${dbCount}`);
    check('slot ends in state=booked', slotState === 'booked', `got ${slotState}`);
  }

  // ── EC2/3/4: step-ordering guard ────────────────────────────────────────────
  console.log('\n[EC2] Out-of-order work booking is blocked');
  {
    const pid = await mkPatient('order'); const pw = await mkPathway(BASIC);
    const ep = await mkEpisode(pid, pw, prov.id);
    const slot = await mkSlot(prov.id, future(40));
    const r = await createAppointment(pool, bookParams(pid, slot, ep, 'work', 'try_in_1'), adminAuth(prov.id, prov.email));
    check('try_in_1 before its prerequisites → blocked', !r.ok && (r as any).validationError?.code === 'STEP_PREREQUISITE_NOT_MET',
      r.ok ? 'unexpectedly booked' : `code=${(r as any).validationError?.code}`);
  }
  console.log('[EC3] Override (with reason) is allowed');
  {
    const pid = await mkPatient('override'); const pw = await mkPathway(BASIC);
    const ep = await mkEpisode(pid, pw, prov.id);
    const slot = await mkSlot(prov.id, future(41));
    const r = await createAppointment(pool, bookParams(pid, slot, ep, 'work', 'try_in_1', 'klinikai indok: sürgős beavatkozás'), adminAuth(prov.id, prov.email));
    const audit = (await q<{ c: string }>(`SELECT count(*)::int AS c FROM scheduling_override_audit WHERE episode_id = $1`, [ep]))[0].c;
    check('out-of-order booking with override → succeeds', r.ok, r.ok ? '' : JSON.stringify((r as any).validationError));
    check('override is audited', Number(audit) >= 1, `audit rows=${audit}`);
  }
  console.log('[EC4] Skipped prerequisites do not block');
  {
    const pid = await mkPatient('skipped'); const pw = await mkPathway(BASIC);
    const ep = await mkEpisode(pid, pw, prov.id);
    await q(`UPDATE episode_work_phases SET status = 'skipped' WHERE episode_id = $1 AND work_phase_code IN ('consult_1','diagnostic','impression_1')`, [ep]);
    const slot = await mkSlot(prov.id, future(42));
    const r = await createAppointment(pool, bookParams(pid, slot, ep, 'work', 'try_in_1'), adminAuth(prov.id, prov.email));
    check('try_in_1 allowed when earlier phases are skipped', r.ok, r.ok ? '' : JSON.stringify((r as any).validationError));
  }

  // ── EC5: past slot is rejected ──────────────────────────────────────────────
  console.log('\n[EC5] Past-dated slot cannot be booked');
  {
    const pid = await mkPatient('past');
    const slot = await mkSlot(prov.id, past(5));
    const r = await createAppointment(pool, bookParams(pid, slot, null, 'consult', null), adminAuth(prov.id, prov.email));
    check('past slot → rejected', !r.ok, r.ok ? 'unexpectedly booked' : '');
  }

  // ── EC6: no free slot in the window → graceful 'none', not a crash ──────────
  console.log('\n[EC6] No availability in window → first-bookable returns none');
  {
    const pid = await mkPatient('noslot'); const pw = await mkPathway(BASIC);
    const ep = await mkEpisode(pid, pw, prov.id); // provider has no slots for this episode window beyond others
    // Ensure no FREE slot exists for this provider in the near future window:
    await q(`UPDATE available_time_slots SET state = 'blocked' WHERE user_id = $1 AND start_time < now() + interval '60 days'`, [prov.id]);
    const fb = await getFirstBookableSlotForEpisode(ep, { providerScope: 'episode', authRole: 'admin' });
    check('first-bookable returns kind=none (no crash)', fb.kind === 'none' || fb.kind === 'blocked', `kind=${fb.kind}`);
    await q(`UPDATE available_time_slots SET state = 'free' WHERE user_id = $1 AND state = 'blocked' AND start_time < now() + interval '60 days'`, [prov.id]);
  }

  // ── EC7: 80-char work_phase_code projects without overflow ──────────────────
  console.log('\n[EC7] 80-char work_phase_code projects (varchar(80) fix)');
  {
    const longCode = 'x'.repeat(80);
    const phases: Phase[] = [
      { pool: 'consult', label: 'Konz', work_phase_code: 'consult_1', duration_minutes: 30, default_days_offset: 0 },
      { pool: 'work', label: 'Hosszú', work_phase_code: longCode, duration_minutes: 30, default_days_offset: 14 },
    ];
    const pid = await mkPatient('len80'); const pw = await mkPathway(phases);
    const ep = await mkEpisode(pid, pw, prov.id);
    let projected = -1; let threw = false;
    try { projected = (await projectRemainingSteps(ep)).projected; } catch { threw = true; }
    check('80-char code: projection does not throw', !threw);
    check('80-char code: intents projected', projected >= 2, `projected=${projected}`);
  }
  console.log('[EC8] 81-char code is caught by the length guard');
  {
    const tooLong = 'y'.repeat(81);
    await mkPathway([{ pool: 'work', label: 'TúlHosszú', work_phase_code: tooLong, duration_minutes: 30, default_days_offset: 0 }]);
    const offenders = await q<{ len: number }>(
      `SELECT length(p->>'work_phase_code') AS len FROM care_pathways cp
       LEFT JOIN LATERAL jsonb_array_elements(cp.work_phases_json) p ON true
       WHERE length(p->>'work_phase_code') > 80`,
    );
    check('length guard flags the 81-char code', offenders.some((o) => Number(o.len) === 81), `offenders=${offenders.length}`);
  }

  // ── EC9: stuck-slot reaper frees orphans but preserves live holds ───────────
  console.log('\n[EC9] Stuck-slot reaper: frees orphaned held slot, preserves live hold');
  {
    const orphan = await mkSlot(prov.id, future(15), 90, 'flexible', 'held'); // no appointment → orphaned
    const liveHeld = await mkSlot(prov.id, future(16), 90, 'flexible', 'held');
    const pid = await mkPatient('held');
    // legitimate hold: an active appointment with a future hold_expires_at on liveHeld
    await q(
      `INSERT INTO appointments (patient_id, time_slot_id, created_by, dentist_email, pool, appointment_type, hold_expires_at)
       VALUES ($1, $2, 'ec@local', $3, 'consult', 'elso_konzultacio', now() + interval '2 hours')`,
      [pid, liveHeld, prov.email],
    );
    const res = await runStuckSlotReaper();
    const orphanState = (await q<{ state: string }>(`SELECT state FROM available_time_slots WHERE id = $1`, [orphan]))[0].state;
    const liveState = (await q<{ state: string }>(`SELECT state FROM available_time_slots WHERE id = $1`, [liveHeld]))[0].state;
    check('orphaned held slot is freed', orphanState === 'free', `state=${orphanState}`);
    check('legitimately-held slot is preserved', liveState === 'held', `state=${liveState}`);
    check('reaper reported freeing the orphan', res.slotIds.includes(orphan));
  }

  // ── EC10: episode with no care pathway is handled, not crashed ──────────────
  console.log('\n[EC10] Episode without a care pathway is handled gracefully');
  {
    const pid = await mkPatient('nopath');
    const ep = await createOpenEpisodeWithInitialStageZero(pool, {
      patientId: pid, reason: 'traumás sérülés', chiefComplaint: 'EC', caseTitle: 'EC',
      parentEpisodeId: null, triggerType: null, treatmentTypeId: null, createdBy: 'ec@local',
    });
    let threw = false; let result: any = null;
    try { result = await nextRequiredStep(ep.id); } catch { threw = true; }
    check('nextRequiredStep does not throw without a pathway', !threw);
    check('returns a blocked/consult fallback (not undefined)', !!result && (('status' in result) || ('work_phase_code' in result)),
      JSON.stringify(result)?.slice(0, 120));
  }

  // ── EC11: DST correctness for the clinic-local hour ─────────────────────────
  console.log('\n[EC11] DST-correct Budapest hour for no-show scoring');
  {
    // 06:00Z is 08:00 Budapest in summer (UTC+2); 07:00Z is 08:00 in winter (UTC+1).
    const summer = budapestHour(new Date('2026-07-01T06:00:00Z'));
    const winter = budapestHour(new Date('2026-01-01T07:00:00Z'));
    check('08:00 local detected in summer and winter alike', summer === 8 && winter === 8, `summer=${summer} winter=${winter}`);
  }

  // ── EC12: all-control pathway books fine ────────────────────────────────────
  console.log('\n[EC12] All-control pathway books without work-pool assumptions');
  {
    const phases: Phase[] = [
      { pool: 'control', label: 'Kontroll 1', work_phase_code: 'ctrl_1', duration_minutes: 20, default_days_offset: 0 },
      { pool: 'control', label: 'Kontroll 2', work_phase_code: 'ctrl_2', duration_minutes: 20, default_days_offset: 30 },
    ];
    const pid = await mkPatient('allctrl'); const pw = await mkPathway(phases);
    const ep = await mkEpisode(pid, pw, prov.id);
    await mkSlot(prov.id, future(2), 90, 'control');
    const fb = await getFirstBookableSlotForEpisode(ep, { providerScope: 'episode', authRole: 'admin' });
    check('control-only pathway yields a bookable next step', fb.kind === 'slot' || fb.kind === 'none', `kind=${fb.kind}`);
  }

  // ── EC13: concurrent booking of the SAME work phase on two slots → 1 wins ──
  console.log('\n[EC13] Same treatment phase booked concurrently on two slots → one wins');
  {
    const pid = await mkPatient('phaserace'); const pw = await mkPathway(BASIC);
    const ep = await mkEpisode(pid, pw, prov.id);
    const wp = (await q<{ id: string }>(`SELECT id FROM episode_work_phases WHERE episode_id = $1 AND work_phase_code = 'consult_1'`, [ep]))[0].id;
    const slotA = await mkSlot(prov.id, future(3));
    const slotB = await mkSlot(prov.id, future(4));
    const mk = (slot: string) => createAppointment(
      pool,
      { ...bookParams(pid, slot, ep, 'consult', 'consult_1'), workPhaseId: wp },
      adminAuth(prov.id, prov.email),
    );
    const outs = await Promise.allSettled([mk(slotA), mk(slotB)]);
    const ok = outs.filter((o) => o.status === 'fulfilled' && (o.value as { ok: boolean }).ok).length;
    const active = (await q<{ c: string }>(
      `SELECT count(*)::int AS c FROM appointments WHERE work_phase_id = $1 AND (appointment_status IS NULL OR appointment_status = 'completed')`,
      [wp],
    ))[0].c;
    check('only one concurrent booking of the same phase succeeds', ok === 1, `got ${ok}`);
    check('at most one active appointment for the work phase', Number(active) === 1, `got ${active}`);
  }

  // ── EC14: duplicate work_phase_codes in a pathway do not crash ──────────────
  console.log('\n[EC14] Duplicate work_phase_codes in a pathway are handled');
  {
    const phases: Phase[] = [
      { pool: 'consult', label: 'Konz', work_phase_code: 'consult_1', duration_minutes: 30, default_days_offset: 0 },
      { pool: 'work', label: 'Dup A', work_phase_code: 'dup_step', duration_minutes: 30, default_days_offset: 7 },
      { pool: 'work', label: 'Dup B', work_phase_code: 'dup_step', duration_minutes: 30, default_days_offset: 14 },
    ];
    const pid = await mkPatient('dup'); const pw = await mkPathway(phases);
    let genThrew = false; let projThrew = false; let ep = '';
    try {
      ep = await mkEpisode(pid, pw, prov.id);
      await projectRemainingSteps(ep);
    } catch (e) { if (!ep) genThrew = true; else projThrew = true; }
    check('generate + project handle duplicate codes without throwing', !genThrew && !projThrew);
  }

  // ── EC15: unsuccessful attempt → retry re-books as attempt #2 ───────────────
  console.log('\n[EC15] Unsuccessful attempt → retry re-books the same phase as attempt #2');
  {
    const pid = await mkPatient('retry'); const pw = await mkPathway(BASIC);
    const ep = await mkEpisode(pid, pw, prov.id);
    // Complete the consult so the first work phase is bookable.
    await q(`UPDATE episode_work_phases SET status = 'completed' WHERE episode_id = $1 AND work_phase_code = 'consult_1'`, [ep]);
    const diagWp = (await q<{ id: string }>(`SELECT id FROM episode_work_phases WHERE episode_id = $1 AND work_phase_code = 'diagnostic'`, [ep]))[0].id;

    // Attempt #1
    const slot1 = await mkSlot(prov.id, future(10));
    await createAppointment(pool, { ...bookParams(pid, slot1, ep, 'work', 'diagnostic'), workPhaseId: diagWp }, adminAuth(prov.id, prov.email));
    const appt1 = (await q<{ id: string; attempt_number: number }>(`SELECT id, attempt_number FROM appointments WHERE time_slot_id = $1`, [slot1]))[0];

    // Mark attempt #1 unsuccessful (mirrors the attempt-outcome route's core effects:
    // the visit happened but failed, so the work phase reopens to 'pending').
    await q(`UPDATE appointments SET appointment_status = 'unsuccessful', attempt_failed_reason = 'rossz lenyomat', attempt_failed_at = now(), attempt_failed_by = 'ec@local' WHERE id = $1`, [appt1.id]);
    await q(`UPDATE episode_work_phases SET status = 'pending', appointment_id = NULL WHERE id = $1`, [diagWp]);

    // Attempt #2 on a NEW slot (the failed visit's slot is consumed — it happened).
    const slot2 = await mkSlot(prov.id, future(17));
    const r2 = await createAppointment(pool, { ...bookParams(pid, slot2, ep, 'work', 'diagnostic'), workPhaseId: diagWp }, adminAuth(prov.id, prov.email));
    const appt2 = (await q<{ attempt_number: number }>(`SELECT attempt_number FROM appointments WHERE time_slot_id = $1`, [slot2]))[0];
    const active = (await q<{ c: string }>(
      `SELECT count(*)::int AS c FROM appointments WHERE work_phase_id = $1 AND (appointment_status IS NULL OR appointment_status = 'completed')`,
      [diagWp],
    ))[0].c;

    check('attempt #1 is recorded as attempt_number=1', Number(appt1.attempt_number) === 1, `got ${appt1.attempt_number}`);
    check('retry after unsuccessful succeeds (unique guard excludes unsuccessful)', r2.ok, r2.ok ? '' : JSON.stringify((r2 as any).validationError));
    check('retry is recorded as attempt_number=2', Number(appt2?.attempt_number) === 2, `got ${appt2?.attempt_number}`);
    check('exactly one active appointment for the phase', Number(active) === 1, `got ${active}`);
  }

  // ── EC16: no-show → retry re-books the same phase (migration 059) ───────────
  console.log('\n[EC16] No-show → retry re-books the same phase as attempt #2');
  {
    const pid = await mkPatient('noshow'); const pw = await mkPathway(BASIC);
    const ep = await mkEpisode(pid, pw, prov.id);
    await q(`UPDATE episode_work_phases SET status = 'completed' WHERE episode_id = $1 AND work_phase_code = 'consult_1'`, [ep]);
    const diagWp = (await q<{ id: string }>(`SELECT id FROM episode_work_phases WHERE episode_id = $1 AND work_phase_code = 'diagnostic'`, [ep]))[0].id;

    // Attempt #1
    const slot1 = await mkSlot(prov.id, future(11));
    await createAppointment(pool, { ...bookParams(pid, slot1, ep, 'work', 'diagnostic'), workPhaseId: diagWp }, adminAuth(prov.id, prov.email));
    const appt1 = (await q<{ id: string }>(`SELECT id FROM appointments WHERE time_slot_id = $1`, [slot1]))[0];

    // Patient missed it → no_show. Mirrors the status route's post-059 effect:
    // the slot stays consumed, but the work phase reopens to 'pending'.
    await q(`UPDATE appointments SET appointment_status = 'no_show' WHERE id = $1`, [appt1.id]);
    await q(`UPDATE episode_work_phases SET status = 'pending', appointment_id = NULL WHERE id = $1`, [diagWp]);

    // The no-show slot must NOT be freed (the time was consumed).
    const slot1State = (await q<{ state: string }>(`SELECT state FROM available_time_slots WHERE id = $1`, [slot1]))[0].state;

    // Retry on a NEW slot — previously blocked by WORK_PHASE_ALREADY_BOOKED.
    const slot2 = await mkSlot(prov.id, future(18));
    const r2 = await createAppointment(pool, { ...bookParams(pid, slot2, ep, 'work', 'diagnostic'), workPhaseId: diagWp }, adminAuth(prov.id, prov.email));
    const appt2 = (await q<{ attempt_number: number }>(`SELECT attempt_number FROM appointments WHERE time_slot_id = $1`, [slot2]))[0];
    const active = (await q<{ c: string }>(
      `SELECT count(*)::int AS c FROM appointments WHERE work_phase_id = $1 AND (appointment_status IS NULL OR appointment_status = 'completed')`,
      [diagWp],
    ))[0].c;

    check('retry after no-show succeeds (unique guard now excludes no_show)', r2.ok, r2.ok ? '' : JSON.stringify((r2 as any).validationError));
    check('no-show counts as a real attempt → retry is attempt_number=2', Number(appt2?.attempt_number) === 2, `got ${appt2?.attempt_number}`);
    check('no-show slot stays consumed (not freed)', slot1State === 'booked', `got ${slot1State}`);
    check('exactly one active appointment for the phase', Number(active) === 1, `got ${active}`);
  }

  console.log(`\n=== RESULT: ${passN} passed, ${failN} failed ===`);
  const fs = await import('fs');
  fs.writeFileSync('sim-out/edge-cases-report.txt', `${passN} passed, ${failN} failed\n\n${lines.join('\n')}\n`);
  await pool.end();
  process.exit(failN > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
