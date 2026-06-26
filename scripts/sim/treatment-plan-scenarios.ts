/**
 * Treatment-plan MECHANISM simulation — scenario seeding + statistical integrity
 * verification, against the THROWAWAY `maxfac_sim` database, driving the app's
 * REAL service functions and route handlers (no raw-SQL shortcuts for the
 * mechanisms under test).
 *
 * Seeds fake patients + treatment plans + appointments owned by the real user
 * account `jancheeta876@gmail.com` (so they appear in that user's views), then
 * exercises every relevant mechanism end-to-end:
 *   A. Clean multi-phase chain with past completed history + upcoming scheduled.
 *   B. Failed attempt (mark_unsuccessful) → repeat → attempt #2 / #3.
 *   C. No-show → repeat → attempt #2 (slot stays consumed).
 *   D. "Másik fázisra" on a FUTURE scheduled appointment (reassign-step).
 *   E. "Másik fázisra" on a PAST completed appointment (snapshot correction).
 *   F. Step-ordering guard: out-of-order blocked; override (with reason) audited.
 *
 * Then runs a statistical-integrity pass (PASS/FAIL) over the seeded data and
 * writes sim-out/treatment-plan-integrity-report.{txt,json}.
 *
 * REAL code paths used:
 *   createAppointment ...................... booking
 *   PATCH /appointments/:id/status ......... completed / no_show
 *   PATCH /appointments/:id/attempt-outcome  unsuccessful
 *   PATCH /episodes/:id/work-phases/:wpId .. phase completion (backdatable)
 *   PATCH /appointments/:id/reassign-step .. "Másik fázisra"
 *   generateEpisodeWorkPhases / projectRemainingSteps / nextRequiredStep
 *
 * Run:  npx tsx scripts/sim/treatment-plan-scenarios.ts
 */
import './load-sim-env'; // 1) populate env (JWT_SECRET) + force DATABASE_URL -> maxfac_sim
import './assert-sim-db'; // 2) HARD GUARD: abort unless target DB is the throwaway sim DB

import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { getDbPool } from '../../lib/db';
import { createOpenEpisodeWithInitialStageZero } from '../../lib/patient-episode-create';
import { generateEpisodeWorkPhases } from '../../lib/generate-episode-work-phases';
import { projectRemainingSteps } from '../../lib/slot-intent-projector';
import { nextRequiredStep } from '../../lib/next-step-engine';
import { createAppointment } from '../../lib/appointment-service';
import { alignStagesToWorkPhases } from './align-stages';
import { PATCH as patchStatus } from '../../app/api/appointments/[id]/status/route';
import { PATCH as patchAttempt } from '../../app/api/appointments/[id]/attempt-outcome/route';
import { PATCH as patchReassign } from '../../app/api/appointments/[id]/reassign-step/route';
import { PATCH as patchWorkPhase } from '../../app/api/episodes/[id]/work-phases/[workPhaseId]/route';

const pool = getDbPool();

// ── The real account these appointments belong to ("hozzám") ───────────────────
const ME = { email: 'jancheeta876@gmail.com', name: 'teszt doktor dr.', role: 'fogpótlástanász' };
// A sim-belépési jelszavak env-ből jönnek (.env.sim, gitignore-olt) — nincs
// hardcode-olt jelszó a verziókövetésben. A throwaway maxfac_sim DB-hez
// tartoznak, nem éles titkok.
const ME_PASSWORD = process.env.SIM_ME_PASSWORD || 'changeme';
const ADMIN = { email: 'admin@example.com', password: process.env.SIM_ADMIN_PASSWORD || 'changeme' };

const FIRST = ['Anna', 'Béla', 'Cecília', 'Dénes', 'Erzsébet', 'Ferenc', 'Gábor', 'Hanna', 'István', 'Júlia', 'Károly', 'László'];
const LAST = ['Tóth', 'Horváth', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp', 'Takács', 'Juhász', 'Lakatos', 'Mészáros'];
const REASONS = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'] as const;

const UNSUCC_REASONS = [
  'Lenyomat torzult / nem értékelhető',
  'Beteg nem tűrte (öklendezés / fájdalom)',
  'Anyagprobléma (keverés / kötés / előcsomag)',
  'Labor szerint hibás',
];

type Pool = 'consult' | 'work' | 'control';
type Phase = { pool: Pool; label: string; work_phase_code: string; duration_minutes: number; default_days_offset: number };

// Long pathway → rich past history + upcoming tail.
const LONG: Phase[] = [
  { pool: 'consult', label: 'Első konzultáció', work_phase_code: 'consult_1', duration_minutes: 30, default_days_offset: 0 },
  { pool: 'work', label: 'Diagnosztika és képalkotás', work_phase_code: 'diagnostic_imaging', duration_minutes: 60, default_days_offset: 14 },
  { pool: 'work', label: 'Elsődleges lenyomat', work_phase_code: 'impression_primary', duration_minutes: 30, default_days_offset: 14 },
  { pool: 'work', label: 'Vázpróba', work_phase_code: 'framework_try_in', duration_minutes: 30, default_days_offset: 14 },
  { pool: 'work', label: 'Harapásvétel', work_phase_code: 'bite_registration', duration_minutes: 30, default_days_offset: 10 },
  { pool: 'work', label: 'Esztétikai próba', work_phase_code: 'aesthetic_try_in', duration_minutes: 30, default_days_offset: 10 },
  { pool: 'work', label: 'Átadás', work_phase_code: 'delivery', duration_minutes: 45, default_days_offset: 10 },
  { pool: 'control', label: '1 hónapos kontroll', work_phase_code: 'control_1m', duration_minutes: 20, default_days_offset: 30 },
  { pool: 'control', label: '6 hónapos kontroll', work_phase_code: 'control_6m', duration_minutes: 20, default_days_offset: 180 },
];

// Short work pathway → isolates the edge-case mechanisms.
const SHORT: Phase[] = [
  { pool: 'consult', label: 'Konzultáció', work_phase_code: 'consult_1', duration_minutes: 30, default_days_offset: 0 },
  { pool: 'work', label: 'Diagnosztika', work_phase_code: 'diagnostic', duration_minutes: 30, default_days_offset: 14 },
  { pool: 'work', label: 'Lenyomat', work_phase_code: 'impression_1', duration_minutes: 30, default_days_offset: 10 },
  { pool: 'work', label: 'Próba', work_phase_code: 'try_in_1', duration_minutes: 30, default_days_offset: 10 },
];

// ── tiny helpers ───────────────────────────────────────────────────────────────
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}
function pad(n: number) { return String(Math.abs(Math.floor(n))).padStart(2, '0'); }
const rnd = () => Math.floor(Math.random() * 1e9);
let meToken = '';
async function mintMeToken(meId: string) {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'change-this-to-a-random-secret-in-production');
  // role 'admin' so the seeding operator can hit every route + override the
  // step-ordering guard where a scenario requires it. The appointments still
  // BELONG to ME (assigned_provider + slot owner + dentist_email).
  return new SignJWT({ userId: meId, email: ME.email, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('2h').sign(secret);
}
function reqFor(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${meToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function routeJson(res: Response): Promise<{ status: number; body: any }> {
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: (res as any).status ?? 200, body };
}

// ── seed: providers, pathways, slots ───────────────────────────────────────────
async function resetData() {
  await q(`TRUNCATE appointments, available_time_slots, slot_intents, episode_work_phases,
           episode_work_phase_audit, appointment_status_events, episode_steps, stage_events,
           scheduling_override_audit, scheduling_events, patient_episodes, patients
           RESTART IDENTITY CASCADE`);
  // users / care_pathways / treatment_types are upserted, not truncated.
}
async function relaxFlags() {
  await q(
    `INSERT INTO scheduling_feature_flags (key, enabled)
     VALUES ('enforce_one_hard_next', false), ('strict_one_hard_next', false)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`
  ).catch(() => {/* table may not exist on some schemas */});
}
async function ensureUsers(): Promise<{ id: string }> {
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await q(
    `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny)
     VALUES ($1,$2,'admin',true,'Adminisztrátor','Sim Klinika')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
    [ADMIN.email, adminHash]
  );
  const meHash = await bcrypt.hash(ME_PASSWORD, 10);
  const rows = await q<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny)
     VALUES ($1,$2,$3,true,$4,'Szimulált rendelő')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, doktor_neve = EXCLUDED.doktor_neve, role = EXCLUDED.role, active = true
     RETURNING id`,
    [ME.email, meHash, ME.role, ME.name]
  );
  return { id: rows[0].id };
}
async function mkPathway(name: string, phases: Phase[]): Promise<string> {
  const code = `sim_${name}_${rnd()}`.slice(0, 40);
  const tt = await q<{ id: string }>(`INSERT INTO treatment_types (code, label_hu) VALUES ($1,$2) RETURNING id`, [code, name]);
  const json = JSON.stringify(phases);
  const cp = await q<{ id: string }>(
    `INSERT INTO care_pathways (name, treatment_type_id, work_phases_json, steps_json, version, priority)
     VALUES ($1,$2,$3::jsonb,$3::jsonb,1,100) RETURNING id`,
    [name, tt[0].id, json]
  );
  return cp[0].id;
}
async function generateSlots(ownerId: string) {
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + 1);
  const DAYS = 420; const hours = [9, 10, 11, 13, 14, 15];
  const purposes = ['consult', 'work', 'work', 'control', 'work', 'flexible'];
  let count = 0; const values: string[] = []; const params: unknown[] = []; let pi = 1;
  for (let d = 0; d < DAYS; d++) {
    const day = new Date(start); day.setDate(start.getDate() + d);
    const dow = day.getDay(); if (dow === 0 || dow === 6) continue;
    for (let h = 0; h < hours.length; h++) {
      const slot = new Date(day); slot.setHours(hours[h], 0, 0, 0);
      values.push(`($${pi++},$${pi++},$${pi++},'free',$${pi++},90,'manual')`);
      params.push(ownerId, slot.toISOString(), 'available', purposes[h]); count++;
    }
    if (params.length > 4000) {
      await q(`INSERT INTO available_time_slots (user_id, start_time, status, state, slot_purpose, duration_minutes, source) VALUES ${values.join(',')}`, params);
      values.length = 0; params.length = 0; pi = 1;
    }
  }
  if (values.length) await q(`INSERT INTO available_time_slots (user_id, start_time, status, state, slot_purpose, duration_minutes, source) VALUES ${values.join(',')}`, params);
  return count;
}

let patientCounter = 0;
async function mkPatient(): Promise<{ id: string; nev: string }> {
  const i = patientCounter++;
  const nev = `SIM ${LAST[i % LAST.length]} ${FIRST[(i * 5) % FIRST.length]}`;
  const taj = `${pad(i * 7 + 11)}${pad(i * 3 + 5)}${pad(i * 9 + 1)}${pad(i)}`;
  const rows = await q<{ id: string }>(
    `INSERT INTO patients (nev, taj, telefonszam, email, nem, felvetel_datuma, created_by)
     VALUES ($1,$2,$3,$4,$5, now(), 'sim@local') RETURNING id`,
    [nev, taj, `+3630${pad(i)}${pad(i * 3)}${pad(i * 7)}`, `sim.patient${i}@sim.local`, i % 2 === 0 ? 'ferfi' : 'no']
  );
  return { id: rows[0].id, nev };
}
async function mkEpisode(patientId: string, pathwayId: string, meId: string, openedDaysAgo: number): Promise<{ id: string }> {
  const reason = REASONS[patientCounter % REASONS.length];
  const ep = await createOpenEpisodeWithInitialStageZero(pool, {
    patientId, reason, chiefComplaint: `Szimulált eset`, caseTitle: `Sim eset`,
    parentEpisodeId: null, triggerType: null, treatmentTypeId: null, createdBy: 'sim@local',
  });
  const opened = new Date(); opened.setDate(opened.getDate() - openedDaysAgo);
  await q(
    `UPDATE patient_episodes SET care_pathway_id = $2, assigned_provider_id = $3, opened_at = $4, plan_start_date = $4 WHERE id = $1`,
    [ep.id, pathwayId, meId, opened.toISOString()]
  );
  await generateEpisodeWorkPhases(pool, ep.id);
  return { id: ep.id };
}
async function ewpId(episodeId: string, code: string): Promise<string> {
  const r = await q<{ id: string }>(
    `SELECT id FROM episode_work_phases WHERE episode_id = $1 AND work_phase_code = $2 AND merged_into_episode_work_phase_id IS NULL ORDER BY seq LIMIT 1`, [episodeId, code]
  );
  if (!r[0]) {
    const all = await q<{ work_phase_code: string; status: string }>(`SELECT work_phase_code, status FROM episode_work_phases WHERE episode_id = $1 ORDER BY seq`, [episodeId]);
    throw new Error(`ewpId: no phase "${code}" in episode ${episodeId}. Existing: ${all.map((x) => `${x.work_phase_code}:${x.status}`).join(', ') || '(none)'}`);
  }
  return r[0].id;
}
function apptType(pool: Pool) { return pool === 'consult' ? 'elso_konzultacio' : pool === 'control' ? 'kontroll' : 'munkafazis'; }

// Book the next-required step on a real free slot via the REAL createAppointment.
async function book(episodeId: string, patientId: string, meId: string, opts?: { overrideReason?: string }): Promise<
  { ok: true; apptId: string; code: string; pool: Pool; wpId: string; startTime: string } | { ok: false; code: string | null; error: string }
> {
  const ns = await nextRequiredStep(episodeId);
  if ('status' in ns && ns.status === 'blocked') return { ok: false, code: 'BLOCKED', error: (ns as any).reason };
  const next = ns as Extract<typeof ns, { work_phase_code: string }>;
  const wpId = await ewpId(episodeId, next.work_phase_code);
  // first free future slot of any purpose for ME
  const slot = (await q<{ id: string; start_time: string }>(
    `SELECT id, start_time FROM available_time_slots WHERE user_id = $1 AND state = 'free' AND start_time > now() ORDER BY start_time LIMIT 1`, [meId]
  ))[0];
  if (!slot) return { ok: false, code: 'NO_SLOT', error: 'no free slot' };
  const outcome = await createAppointment(
    pool,
    { patientId, timeSlotId: slot.id, episodeId, appointmentType: apptType(next.pool), pool: next.pool, createdVia: 'worklist', stepCode: next.work_phase_code, workPhaseId: wpId, requiresPrecommit: false, overrideReason: opts?.overrideReason },
    { email: ME.email, userId: meId, role: 'admin' }
  );
  if (!outcome.ok) return { ok: false, code: (outcome.validationError as any)?.code ?? null, error: JSON.stringify(outcome.validationError) };
  return { ok: true, apptId: outcome.result.appointment.id, code: next.work_phase_code, pool: next.pool, wpId, startTime: slot.start_time };
}

// Book a SPECIFIC phase code (bypassing nextRequiredStep) — needs overrideReason if out of order.
// NB: param is `poolType` (not `pool`) so it does not shadow the module-level DB pool.
async function bookCode(episodeId: string, patientId: string, meId: string, code: string, poolType: Pool, overrideReason?: string) {
  const wpId = await ewpId(episodeId, code);
  const slot = (await q<{ id: string; start_time: string }>(
    `SELECT id, start_time FROM available_time_slots WHERE user_id = $1 AND state = 'free' AND start_time > now() ORDER BY start_time LIMIT 1`, [meId]
  ))[0];
  const outcome = await createAppointment(
    pool,
    { patientId, timeSlotId: slot.id, episodeId, appointmentType: apptType(poolType), pool: poolType, createdVia: 'admin_override', stepCode: code, workPhaseId: wpId, requiresPrecommit: false, overrideReason },
    { email: ME.email, userId: meId, role: 'admin' }
  );
  return { outcome, wpId, apptId: outcome.ok ? outcome.result.appointment.id : null, slotStart: slot.start_time };
}

// Mark the appointment completed via REAL status route, then complete its phase via REAL work-phase route.
async function completeStep(episodeId: string, apptId: string, wpId: string, completedAtIso?: string) {
  const s = await routeJson(await patchStatus(reqFor(`/api/appointments/${apptId}/status`, { appointmentStatus: 'completed', completionNotes: 'Sikeresen elvégezve (szimuláció).' }), { params: { id: apptId } }) as any);
  if (s.status !== 200) throw new Error(`status->completed failed (${s.status}): ${JSON.stringify(s.body)}`);
  const w = await routeJson(await patchWorkPhase(reqFor(`/api/episodes/${episodeId}/work-phases/${wpId}`, { status: 'completed', reason: 'Fázis lezárva (szimuláció).', appointmentId: apptId, completedAt: completedAtIso }), { params: { id: episodeId, workPhaseId: wpId } }) as any);
  if (w.status !== 200) throw new Error(`workphase->completed failed (${w.status}): ${JSON.stringify(w.body)}`);
}

// Backdate an appointment + its slot to the past (createAppointment forbids past
// slots at booking; this makes a completed visit genuinely historical).
async function backdate(apptId: string, daysAgo: number) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(10, 0, 0, 0);
  await q(`UPDATE available_time_slots ats SET start_time = $2 FROM appointments a WHERE a.id = $1 AND a.time_slot_id = ats.id`, [apptId, d.toISOString()]);
  await q(`UPDATE appointments SET start_time = $2 WHERE id = $1`, [apptId, d.toISOString()]);
  await q(`UPDATE episode_work_phases SET completed_at = $2 WHERE appointment_id = $1 AND status = 'completed'`, [apptId, d.toISOString()]);
}

// ── integrity check harness ─────────────────────────────────────────────────────
let passN = 0, failN = 0; const lines: string[] = []; const findings: string[] = [];
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passN++; console.log(`  ✓ ${name}`); } else { failN++; console.log(`  ✗ ${name}  ${detail}`); findings.push(`${name} — ${detail}`); }
  lines.push(`${cond ? 'PASS' : 'FAIL'}\t${name}\t${detail}`);
}

async function main() {
  console.log('\n=== TREATMENT-PLAN SCENARIO SIMULATION ===');
  await resetData();
  await relaxFlags();
  const me = await ensureUsers();
  meToken = await mintMeToken(me.id);
  console.log(`Account ("hozzám"): ${ME.email} (${me.id})`);
  const longPw = await mkPathway('Hosszú protetikai terv (szim)', LONG);
  const shortPw = await mkPathway('Rövid munkafázis terv (szim)', SHORT);
  const slots = await generateSlots(me.id);
  console.log(`Seeded ${slots} free slots owned by the account.\n`);

  const summary: any[] = [];

  // ── Scenario A: clean historical chains ──────────────────────────────────────
  console.log('[A] Clean multi-phase chains with past history + upcoming tail');
  for (let k = 0; k < 3; k++) {
    const p = await mkPatient();
    const ep = await mkEpisode(p.id, longPw, me.id, 120 + k * 30);
    // Complete the first 5 phases, leave the rest as upcoming.
    const completeN = 5; const booked: { apptId: string; wpId: string }[] = [];
    for (let i = 0; i < completeN; i++) {
      const b = await book(ep.id, p.id, me.id);
      if (!b.ok) { console.log(`    A#${k} stop at phase ${i}: ${b.error}`); break; }
      await completeStep(ep.id, b.apptId, b.wpId);
      booked.push({ apptId: b.apptId, wpId: b.wpId });
    }
    // One upcoming scheduled (future) appointment.
    const up = await book(ep.id, p.id, me.id);
    // Backdate completed visits to spread across the past months.
    for (let i = 0; i < booked.length; i++) await backdate(booked[i].apptId, (completeN - i) * 25 + k * 20);
    summary.push({ scenario: 'A', patient: p.nev, patientId: p.id, episode: ep.id, completed: booked.length, upcoming: up.ok ? 1 : 0 });
    console.log(`    A#${k} ${p.nev}: ${booked.length} completed (past), ${up.ok ? 1 : 0} upcoming`);
  }

  // ── Scenario B: unsuccessful → retry (attempt #2, and one #3) ─────────────────
  console.log('\n[B] Failed attempt (unsuccessful) → repeat');
  {
    const p = await mkPatient();
    const ep = await mkEpisode(p.id, shortPw, me.id, 60);
    const c = await book(ep.id, p.id, me.id); await completeStep(ep.id, c.ok ? c.apptId : '', c.ok ? c.wpId : ''); // consult
    // diagnostic attempt #1 → unsuccessful
    const a1 = await book(ep.id, p.id, me.id);
    const r1 = await routeJson(await patchAttempt(reqFor(`/api/appointments/${a1.ok ? a1.apptId : ''}/attempt-outcome`, { action: 'mark_unsuccessful', reason: UNSUCC_REASONS[0] }), { params: { id: a1.ok ? a1.apptId : '' } }) as any);
    // attempt #2 → unsuccessful again
    const a2 = await book(ep.id, p.id, me.id);
    const r2 = await routeJson(await patchAttempt(reqFor(`/api/appointments/${a2.ok ? a2.apptId : ''}/attempt-outcome`, { action: 'mark_unsuccessful', reason: UNSUCC_REASONS[3] }), { params: { id: a2.ok ? a2.apptId : '' } }) as any);
    // attempt #3 → success
    const a3 = await book(ep.id, p.id, me.id); if (a3.ok) await completeStep(ep.id, a3.apptId, a3.wpId);
    const a1n = (await q<{ n: number }>(`SELECT attempt_number n FROM appointments WHERE id = $1`, [a1.ok ? a1.apptId : '']))[0]?.n;
    const a3n = (await q<{ n: number }>(`SELECT attempt_number n FROM appointments WHERE id = $1`, [a3.ok ? a3.apptId : '']))[0]?.n;
    await backdate(a1.ok ? a1.apptId : '', 50); await backdate(a2.ok ? a2.apptId : '', 40); if (a3.ok) await backdate(a3.apptId, 30);
    check('B: unsuccessful #1 recorded attempt_number=1', Number(a1n) === 1, `got ${a1n}`);
    check('B: retry after 2 failures lands attempt_number=3', Number(a3n) === 3, `got ${a3n}`);
    check('B: attempt-outcome route returned 200', r1.status === 200 && r2.status === 200, `r1=${r1.status} r2=${r2.status}`);
    summary.push({ scenario: 'B', patient: p.nev, episode: ep.id, attempts: a3n });
    console.log(`    B ${p.nev}: diagnostic attempts → #${a3n} succeeded`);
  }

  // ── Scenario C: no-show → retry ──────────────────────────────────────────────
  console.log('\n[C] No-show → repeat (slot stays consumed)');
  {
    const p = await mkPatient();
    const ep = await mkEpisode(p.id, shortPw, me.id, 45);
    const c = await book(ep.id, p.id, me.id); await completeStep(ep.id, c.ok ? c.apptId : '', c.ok ? c.wpId : '');
    const a1 = await book(ep.id, p.id, me.id);
    const ns = await routeJson(await patchStatus(reqFor(`/api/appointments/${a1.ok ? a1.apptId : ''}/status`, { appointmentStatus: 'no_show' }), { params: { id: a1.ok ? a1.apptId : '' } }) as any);
    const slotState = (await q<{ state: string }>(`SELECT ats.state FROM available_time_slots ats JOIN appointments a ON a.time_slot_id = ats.id WHERE a.id = $1`, [a1.ok ? a1.apptId : '']))[0]?.state;
    const a2 = await book(ep.id, p.id, me.id);
    const a2n = (await q<{ n: number }>(`SELECT attempt_number n FROM appointments WHERE id = $1`, [a2.ok ? a2.apptId : '']))[0]?.n;
    if (a2.ok) await completeStep(ep.id, a2.apptId, a2.wpId);
    await backdate(a1.ok ? a1.apptId : '', 38); if (a2.ok) await backdate(a2.apptId, 28);
    check('C: status route 200 for no_show', ns.status === 200, `got ${ns.status}`);
    check('C: no-show slot stays consumed (booked)', slotState === 'booked', `got ${slotState}`);
    check('C: retry after no-show is attempt_number=2', Number(a2n) === 2, `got ${a2n}`);
    summary.push({ scenario: 'C', patient: p.nev, episode: ep.id, retry: a2n });
    console.log(`    C ${p.nev}: no-show → retry attempt #${a2n}`);
  }

  // ── Scenario D: "Másik fázisra" on a FUTURE scheduled appointment ─────────────
  console.log('\n[D] "Másik fázisra" — future scheduled reassignment');
  {
    const p = await mkPatient();
    const ep = await mkEpisode(p.id, shortPw, me.id, 20);
    const c = await book(ep.id, p.id, me.id); await completeStep(ep.id, c.ok ? c.apptId : '', c.ok ? c.wpId : '');
    const a = await book(ep.id, p.id, me.id); // diagnostic, scheduled (future)
    const target = await ewpId(ep.id, 'impression_1');
    const res = await routeJson(await patchReassign(reqFor(`/api/appointments/${a.ok ? a.apptId : ''}/reassign-step`, { targetWorkPhaseId: target, reason: 'Tévesen a diagnosztikára foglalva — valójában lenyomat.' }), { params: { id: a.ok ? a.apptId : '' } }) as any);
    const link = (await q<{ wp: string; code: string }>(`SELECT work_phase_id wp, step_code code FROM appointments WHERE id = $1`, [a.ok ? a.apptId : '']))[0];
    const targetStatus = (await q<{ s: string }>(`SELECT status s FROM episode_work_phases WHERE id = $1`, [target]))[0]?.s;
    const sourceStatus = (await q<{ s: string }>(`SELECT status s FROM episode_work_phases WHERE id = $1`, [a.ok ? a.wpId : '']))[0]?.s;
    const audit = (await q<{ c: string }>(`SELECT count(*)::int c FROM episode_work_phase_audit WHERE episode_id = $1 AND (reason ILIKE '%rendelve%' OR reason ILIKE '%átrendezve%')`, [ep.id]))[0]?.c;
    check('D: reassign route returned 200', res.status === 200, `got ${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`);
    check('D: appointment now linked to target phase (impression_1)', link?.code === 'impression_1' && link?.wp === target, JSON.stringify(link));
    check('D: target phase became scheduled', targetStatus === 'scheduled', `got ${targetStatus}`);
    check('D: source phase reopened to pending', sourceStatus === 'pending', `got ${sourceStatus}`);
    check('D: reassignment is audited', Number(audit) >= 1, `audit rows=${audit}`);
    summary.push({ scenario: 'D', patient: p.nev, episode: ep.id, movedTo: link?.code });
    console.log(`    D ${p.nev}: scheduled appt moved diagnostic → ${link?.code}`);
  }

  // ── Scenario E: "Másik fázisra" on a PAST completed appointment ───────────────
  console.log('\n[E] "Másik fázisra" — past completed appointment (snapshot correction)');
  {
    const p = await mkPatient();
    const ep = await mkEpisode(p.id, shortPw, me.id, 90);
    const c = await book(ep.id, p.id, me.id); await completeStep(ep.id, c.ok ? c.apptId : '', c.ok ? c.wpId : '');
    // Book + complete "diagnostic", then backdate → a real past completed visit.
    const a = await book(ep.id, p.id, me.id);
    if (a.ok) { await completeStep(ep.id, a.apptId, a.wpId); await backdate(a.apptId, 60); }
    const sourceWp = a.ok ? a.wpId : '';
    const target = await ewpId(ep.id, 'impression_1');
    // The past visit was actually the impression, not the diagnostic → correct it.
    const res = await routeJson(await patchReassign(reqFor(`/api/appointments/${a.ok ? a.apptId : ''}/reassign-step`, { targetWorkPhaseId: target, reason: 'Utólagos rögzítés: a lezajlott időpont valójában a lenyomat fázis volt.' }), { params: { id: a.ok ? a.apptId : '' } }) as any);
    const link = (await q<{ wp: string; code: string; st: string }>(`SELECT work_phase_id wp, step_code code, appointment_status st FROM appointments WHERE id = $1`, [a.ok ? a.apptId : '']))[0];
    const targetStatus = (await q<{ s: string; ap: string | null }>(`SELECT status s, appointment_id ap FROM episode_work_phases WHERE id = $1`, [target]))[0];
    const sourceStatus = (await q<{ s: string; ap: string | null }>(`SELECT status s, appointment_id ap FROM episode_work_phases WHERE id = $1`, [sourceWp]))[0];
    check('E: reassign of past completed appt returned 200', res.status === 200, `got ${res.status} ${JSON.stringify(res.body)?.slice(0, 160)}`);
    check('E: appointment stays completed after reassign', link?.st === 'completed', `got ${link?.st}`);
    check('E: target phase is linked to the (completed) appointment', targetStatus?.ap === (a.ok ? a.apptId : null), JSON.stringify(targetStatus));
    check('E: source phase stays completed but link removed', sourceStatus?.s === 'completed' && sourceStatus?.ap === null, JSON.stringify(sourceStatus));
    // FINDING: reassign-step leaves the target phase 'scheduled' even though its
    // linked appointment is completed → completed-phase stats undercount and a
    // manual "fázis lezárása" is still required.
    if (targetStatus?.s !== 'completed') {
      findings.push(`MEGBÍZHATÓSÁGI ÉSZREVÉTEL (E / "Másik fázisra"): egy MÁR LEZAJLOTT, completed időpont átrendelésekor a cél fázis ("impression_1") állapota "${targetStatus?.s}" marad (NEM "completed"), pedig a hozzá kötött időpont completed. Statisztikai hatás: a befejezett-fázis számláló alulszámol, és kézi "fázis lezárása" lépés kell. Forrás: app/api/appointments/[id]/reassign-step/route.ts — newTargetStatus csak akkor 'completed', ha a cél MÁR completed volt. Alternatíva: a PATCH /episodes/:id/work-phases/:wpId { status:'completed', appointmentId, completedAt } végpont completed-re ÉS linkeltre állítja a fázist.`);
    }
    summary.push({ scenario: 'E', patient: p.nev, episode: ep.id, recordedOn: link?.code, targetPhaseStatus: targetStatus?.s });
    console.log(`    E ${p.nev}: past completed appt re-recorded onto ${link?.code} — target phase status="${targetStatus?.s}" (see finding)`);
  }

  // ── Scenario F: step-ordering guard + audited override ────────────────────────
  console.log('\n[F] Step-ordering guard + audited override');
  {
    const p = await mkPatient();
    const ep = await mkEpisode(p.id, shortPw, me.id, 10);
    // Try try_in_1 before prerequisites, no reason → must be blocked.
    const blocked = await bookCode(ep.id, p.id, me.id, 'try_in_1', 'work');
    check('F: out-of-order booking is blocked', !blocked.outcome.ok && (blocked.outcome as any).validationError?.code === 'STEP_PREREQUISITE_NOT_MET',
      blocked.outcome.ok ? 'unexpectedly booked' : `code=${(blocked.outcome as any).validationError?.code}`);
    // With override reason → allowed + audited.
    const overr = await bookCode(ep.id, p.id, me.id, 'try_in_1', 'work', 'Klinikai indok: sürgős próba szükséges.');
    const audit = (await q<{ c: string }>(`SELECT count(*)::int c FROM scheduling_override_audit WHERE episode_id = $1`, [ep.id]))[0]?.c;
    check('F: override (with reason) succeeds', overr.outcome.ok, overr.outcome.ok ? '' : JSON.stringify((overr.outcome as any).validationError));
    check('F: override is audited', Number(audit) >= 1, `audit rows=${audit}`);
    summary.push({ scenario: 'F', patient: p.nev, episode: ep.id, overrideAudited: Number(audit) >= 1 });
    console.log(`    F ${p.nev}: guard blocked + override audited (${audit})`);
  }

  // ── Pre-protetikai esetek: STAGE_5 ELŐTT csak konzultáció (vagy semmi) ────────
  // A klinikai szabály: munkafázis csak STAGE_5-től. Ezek a betegek még a
  // protetikai fázis előtt vannak — hogy a naptárnézet a valós stádium-tartományt
  // mutassa (Új beteg / Árajánlatra vár, munkafázis nélkül).
  console.log('\n[Pre] Pre-protetikai esetek (csak konzultáció / új beteg)');
  {
    const names: string[] = [];
    for (let k = 0; k < 2; k++) {
      const p = await mkPatient();
      const ep = await mkEpisode(p.id, shortPw, me.id, 28 + k * 16);
      const c = await book(ep.id, p.id, me.id); // consult_1
      if (c.ok) {
        await completeStep(ep.id, c.apptId, c.wpId);
        await backdate(c.apptId, 18 - k * 6);
      }
      summary.push({ scenario: 'Pre', patient: p.nev, episode: ep.id, note: 'konzultáció kész, pre-STAGE_5' });
      names.push(p.nev);
    }
    // egy „vadonatúj" beteg: még időpont sincs (STAGE_0)
    const p0 = await mkPatient();
    const ep0 = await mkEpisode(p0.id, shortPw, me.id, 6);
    summary.push({ scenario: 'Pre', patient: p0.nev, episode: ep0.id, note: 'új beteg, időpont nélkül' });
    names.push(p0.nev);
    console.log(`    Pre-protetikai: ${names.join(', ')}`);
  }

  // ── Stádium-igazítás: STAGE_5 az első munkafázishoz, konzultáció elé; a
  // pre-protetikai esetek STAGE_0/STAGE_2-ben maradnak (klinikai szabály). ──────
  const aligned = await alignStagesToWorkPhases(pool);
  const byStage: Record<string, number> = {};
  for (const a of aligned) byStage[a.current] = (byStage[a.current] ?? 0) + 1;
  console.log(`\nStádium-igazítás kész (${aligned.length} epizód):`, JSON.stringify(byStage));

  // ── Statistical integrity pass over ALL seeded data ──────────────────────────
  console.log('\n=== STATISTICAL INTEGRITY CHECKS ===');

  // 1. At most one ACTIVE (null or completed) appointment per work_phase_id.
  const dupWp = await q<{ wp: string; c: number }>(
    `SELECT work_phase_id wp, count(*)::int c FROM appointments
     WHERE work_phase_id IS NOT NULL AND (appointment_status IS NULL OR appointment_status = 'completed')
     GROUP BY work_phase_id HAVING count(*) > 1`
  );
  check('≤1 active appointment per work phase', dupWp.length === 0, `violations: ${dupWp.length}`);

  // 2. attempt_number is contiguous 1..k over real attempts per (episode, step).
  const attemptBad = await q<{ episode_id: string; step_code: string; arr: number[] }>(
    `SELECT episode_id, step_code, array_agg(attempt_number ORDER BY attempt_number) arr
     FROM appointments
     WHERE episode_id IS NOT NULL AND step_code IS NOT NULL
       AND appointment_status IN ('completed','unsuccessful','no_show')
     GROUP BY episode_id, step_code`
  );
  let attemptViolations = 0;
  for (const row of attemptBad) {
    const arr = row.arr.map(Number);
    for (let i = 0; i < arr.length; i++) if (arr[i] !== i + 1) { attemptViolations++; break; }
  }
  check('attempt_number contiguous 1..k per (episode,step)', attemptViolations === 0, `violations: ${attemptViolations}`);

  // 3. No EWP link to a cancelled appointment.
  const cancelledLinks = await q<{ c: number }>(
    `SELECT count(*)::int c FROM episode_work_phases ewp JOIN appointments a ON a.id = ewp.appointment_id
     WHERE a.appointment_status IN ('cancelled_by_doctor','cancelled_by_patient')`
  );
  check('no work phase linked to a cancelled appointment', Number(cancelledLinks[0].c) === 0, `got ${cancelledLinks[0].c}`);

  // 4. Every completed phase is either linked to a completed appointment OR was
  //    explicitly de-linked by a reassignment (snapshot correction, audited).
  const completedNoAppt = await q<{ id: string; episode_id: string }>(
    `SELECT ewp.id, ewp.episode_id FROM episode_work_phases ewp
     WHERE ewp.status = 'completed'
       AND (ewp.appointment_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM appointments a WHERE a.id = ewp.appointment_id AND a.appointment_status = 'completed'))`
  );
  let trueOrphans = 0; let reassignExplained = 0;
  for (const row of completedNoAppt) {
    // Explained if a reassignment happened ANYWHERE in this episode (the target
    // phase carries the "... ide rendelve" / "átrendezve" audit; the source
    // completed phase is de-linked by the same operation but the route only
    // writes a per-phase audit when the source was 'scheduled', not 'completed').
    const explained = await q<{ c: number }>(
      `SELECT count(*)::int c FROM episode_work_phase_audit
       WHERE episode_id = $1 AND (reason ILIKE '%átrendezve%' OR reason ILIKE '%rendelve%' OR reason ILIKE '%stale%')`,
      [row.episode_id]
    );
    if (Number(explained[0].c) === 0) trueOrphans++; else reassignExplained++;
  }
  check('no unexplained completed-phase without a completed appointment', trueOrphans === 0,
    `${completedNoAppt.length} de-linked completed phases (${reassignExplained} via reassign, ${trueOrphans} unexplained)`);
  if (reassignExplained > 0) {
    findings.push(`MEGBÍZHATÓSÁGI ÉSZREVÉTEL (E / "Másik fázisra" forrásoldal): completed időpont átrendelésekor a FORRÁS fázis "completed" marad, de elveszti az appointment_id linkjét ÉS nem kap saját audit sort (a reassign-step route csak 'scheduled' forrásnál naplóz). Így marad egy completed fázis appointment nélkül, közvetlen audit-nyom nélkül (csak a cél fázis "ide rendelve" sora utal rá). Statisztikai hatás: a completed fázis ↔ completed időpont párosítás megbomlik. ${reassignExplained} ilyen eset a seedben.`);
  }

  // 5. Audit completeness: every reassign produced an audit row; every override audited.
  const reassignAudits = (await q<{ c: number }>(`SELECT count(*)::int c FROM episode_work_phase_audit WHERE reason ILIKE '%rendelve%' OR reason ILIKE '%átrendezve%'`))[0].c;
  check('reassignment audit rows exist', Number(reassignAudits) >= 2, `got ${reassignAudits}`);
  const statusEvents = (await q<{ c: number }>(`SELECT count(*)::int c FROM appointment_status_events`))[0].c;
  check('appointment status-change events recorded', Number(statusEvents) >= 1, `got ${statusEvents}`);

  // 6. rebookNeeded (dashboard SQL): unsuccessful/no_show reopened → TRUE; completed → FALSE.
  const rebookTrue = await q<{ c: number }>(
    `SELECT count(*)::int c FROM appointments a
     WHERE a.episode_id IS NOT NULL
       AND a.appointment_status IN ('no_show','unsuccessful')
       AND EXISTS (SELECT 1 FROM episode_work_phases e WHERE e.episode_id = a.episode_id
                   AND (e.id = a.work_phase_id OR (a.work_phase_id IS NULL AND e.work_phase_code = a.step_code)) AND e.status = 'pending')
       AND NOT EXISTS (SELECT 1 FROM appointments a2 WHERE a2.episode_id = a.episode_id AND a2.step_code = a.step_code AND a2.id <> a.id
                       AND (a2.appointment_status IS NULL OR a2.appointment_status NOT IN ('cancelled_by_doctor','cancelled_by_patient','no_show','unsuccessful')))`
  );
  // After our retries each failed step WAS rebooked+completed, so rebookNeeded should be 0 (all failures superseded).
  check('rebookNeeded resolves to 0 once failures are re-booked & completed', Number(rebookTrue[0].c) === 0, `still-needed: ${rebookTrue[0].c}`);

  // 7. Engine robustness: nextRequiredStep / projectRemainingSteps never throw.
  const openEps = await q<{ id: string }>(`SELECT id FROM patient_episodes WHERE status = 'open'`);
  let engineThrew = 0;
  for (const e of openEps) {
    try { await nextRequiredStep(e.id); await projectRemainingSteps(e.id); } catch { engineThrew++; }
  }
  check('engine (nextRequiredStep + projector) never throws', engineThrew === 0, `threw on ${engineThrew}/${openEps.length} episodes`);

  // ── totals & report ──────────────────────────────────────────────────────────
  const counts = {
    patients: (await q<{ c: number }>(`SELECT count(*)::int c FROM patients`))[0].c,
    episodes: (await q<{ c: number }>(`SELECT count(*)::int c FROM patient_episodes`))[0].c,
    appointments: (await q<{ c: number }>(`SELECT count(*)::int c FROM appointments`))[0].c,
    completedAppts: (await q<{ c: number }>(`SELECT count(*)::int c FROM appointments WHERE appointment_status = 'completed'`))[0].c,
    failedAttempts: (await q<{ c: number }>(`SELECT count(*)::int c FROM appointments WHERE appointment_status IN ('unsuccessful','no_show')`))[0].c,
    workPhases: (await q<{ c: number }>(`SELECT count(*)::int c FROM episode_work_phases`))[0].c,
  };

  console.log(`\n=== RESULT: ${passN} passed, ${failN} failed ===`);
  console.log('Data:', JSON.stringify(counts));

  const fs = await import('fs');
  fs.mkdirSync('sim-out', { recursive: true });
  fs.writeFileSync('sim-out/treatment-plan-integrity-report.txt',
    `${passN} passed, ${failN} failed\n\nDATA: ${JSON.stringify(counts, null, 2)}\n\nCHECKS:\n${lines.join('\n')}\n\n` +
    (findings.length ? `FINDINGS:\n- ${findings.join('\n- ')}\n` : 'No failures.\n'));
  fs.writeFileSync('sim-out/treatment-plan-integrity-report.json', JSON.stringify({
    generatedAt: new Date().toISOString(), account: ME.email, passN, failN, counts, scenarios: summary, findings,
    checks: lines.map((l) => { const [r, n, d] = l.split('\t'); return { result: r, name: n, detail: d }; }),
  }, null, 2));
  // sample target for screenshots: the first historical episode
  const aSample = summary.find((s) => s.scenario === 'A');
  fs.writeFileSync('sim-out/sample-targets.json', JSON.stringify({ patientId: aSample?.patientId ?? null, episodeId: aSample?.episode ?? null }, null, 2));
  console.log('Wrote sim-out/treatment-plan-integrity-report.{txt,json}');
  console.log('=== SIMULATION COMPLETE ===\n');
  await pool.end();
  process.exit(failN > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
