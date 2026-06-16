/**
 * Treatment-plan + scheduling SIMULATION harness.
 *
 * Seeds dummy patients/episodes/care-pathway plans/provider availability into a
 * THROWAWAY database, then drives the REAL app scheduling mechanisms end-to-end:
 *   generateEpisodeWorkPhases  → expand a care_pathway's work_phases_json into a plan
 *   projectRemainingSteps      → forward-chained slot-intent projection (months ahead)
 *   nextRequiredStep           → which clinical step comes next + its date window
 *   getFirstBookableSlotForEpisode → find a real free slot in that window
 *   createAppointment          → book it (and flip the slot to 'booked')
 *
 * To walk a full multi-month treatment chain it "fast-forwards" by marking each
 * booked appointment completed, which advances the scheduling anchor to the next
 * step's window. This is a simulation artifact (real life completes over months).
 *
 * Run:  npx tsx scripts/sim/run-simulation.ts
 * Env:  reads .env.local (DATABASE_URL must point at the throwaway DB).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import bcrypt from 'bcryptjs';
import { getDbPool } from '../../lib/db';
import { createOpenEpisodeWithInitialStageZero } from '../../lib/patient-episode-create';
import { generateEpisodeWorkPhases } from '../../lib/generate-episode-work-phases';
import { projectRemainingSteps } from '../../lib/slot-intent-projector';
import { nextRequiredStep } from '../../lib/next-step-engine';
import { getFirstBookableSlotForEpisode } from '../../lib/first-bookable-slot';
import { createAppointment } from '../../lib/appointment-service';

const pool = getDbPool();

// ── Dummy data ────────────────────────────────────────────────────────────────
const PROVIDERS = [
  { email: 'dr.kovacs@sim.local', name: 'Dr. Kovács Anna', role: 'fogpótlástanász' },
  { email: 'dr.nagy@sim.local', name: 'Dr. Nagy Béla', role: 'fogpótlástanász' },
  { email: 'dr.szabo@sim.local', name: 'Dr. Szabó Csaba', role: 'fogpótlástanász' },
];

const FIRST = ['Anna', 'Béla', 'Cecília', 'Dénes', 'Erzsébet', 'Ferenc', 'Gábor', 'Hanna', 'István', 'Júlia', 'Károly', 'László'];
const LAST = ['Tóth', 'Horváth', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp', 'Takács', 'Juhász', 'Lakatos', 'Mészáros'];

const REASONS = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'] as const;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

// ── Step -1: reset sim data so re-runs are idempotent (throwaway DB) ───────────
async function resetData() {
  await q(`TRUNCATE appointments, available_time_slots, slot_intents, episode_work_phases,
           episode_steps, patient_episodes, patients RESTART IDENTITY CASCADE`);
}

// ── Step 0: feature flags — disable one-hard-next so we can book a full chain ──
async function relaxFlags() {
  await q(
    `INSERT INTO scheduling_feature_flags (key, enabled)
     VALUES ('enforce_one_hard_next', false), ('strict_one_hard_next', false)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`
  );
}

// ── Step 1: providers (+ admin login) ──────────────────────────────────────────
async function ensureUsers() {
  const hash = await bcrypt.hash('changeme', 10);
  await q(
    `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny)
     VALUES ($1,$2,'admin',true,'Adminisztrátor','Sim Klinika')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
    ['admin@example.com', hash]
  );
  const providers: { id: string; email: string; name: string; role: string }[] = [];
  for (const p of PROVIDERS) {
    const rows = await q<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, active, doktor_neve, intezmeny)
       VALUES ($1,$2,$3,true,$4,'Sim Klinika')
       ON CONFLICT (email) DO UPDATE SET doktor_neve = EXCLUDED.doktor_neve, active = true
       RETURNING id`,
      [p.email, hash, p.role, p.name]
    );
    providers.push({ id: rows[0].id, ...p });
  }
  return providers;
}

// ── Step 1.5: synthetic LONG, complicated multi-step care pathways ─────────────
// These exercise long chains (18–20 phases spanning ~2.5 years), control tails,
// precommit steps, AND an intentionally long (>50-char) work_phase_code to prove
// the varchar(80) widening (migration 058).
type Phase = { pool: 'consult' | 'work' | 'control'; label: string; work_phase_code: string; duration_minutes: number; default_days_offset: number; requires_precommit?: boolean };

const COMPLEX_PATHWAYS: { name: string; code: string; phases: Phase[] }[] = [
  {
    name: 'Komplex onkológiai rekonstrukció (szimuláció)',
    code: 'sim_komplex_onko',
    phases: [
      { pool: 'consult', label: 'Első konzultáció', work_phase_code: 'consult_1', duration_minutes: 30, default_days_offset: 0 },
      { pool: 'work', label: 'Diagnosztika és képalkotás', work_phase_code: 'diagnostic_imaging', duration_minutes: 60, default_days_offset: 14 },
      { pool: 'work', label: 'Onkológiai team megbeszélés', work_phase_code: 'tumor_board_review', duration_minutes: 30, default_days_offset: 7 },
      { pool: 'work', label: 'Sebészi tervezés', work_phase_code: 'surgical_planning', duration_minutes: 45, default_days_offset: 14 },
      { pool: 'work', label: 'Műtét előtti lenyomat', work_phase_code: 'pre_surgical_impression', duration_minutes: 30, default_days_offset: 7 },
      { pool: 'work', label: 'Sebészi fázis 1', work_phase_code: 'surgical_phase_1', duration_minutes: 90, default_days_offset: 21 },
      { pool: 'control', label: 'Posztoperatív kontroll 1', work_phase_code: 'post_op_check_1', duration_minutes: 20, default_days_offset: 14 },
      { pool: 'control', label: 'Posztoperatív kontroll 2', work_phase_code: 'post_op_check_2', duration_minutes: 20, default_days_offset: 21 },
      { pool: 'work', label: 'Gyógyulás értékelése', work_phase_code: 'healing_assessment', duration_minutes: 30, default_days_offset: 30 },
      // Intentionally long code (>50 chars) — must fit VARCHAR(80) after migration 058.
      { pool: 'work', label: 'Funkcionális protetikai rekonstrukció — részletes próbafázis', work_phase_code: 'komplex_protetikai_rekonstrukcio_funkcionalis_reszletes_probafazis', duration_minutes: 60, default_days_offset: 14 },
      { pool: 'work', label: 'Másodlagos lenyomat', work_phase_code: 'impression_secondary', duration_minutes: 30, default_days_offset: 7 },
      { pool: 'work', label: 'Vázpróba', work_phase_code: 'framework_try_in', duration_minutes: 30, default_days_offset: 14 },
      { pool: 'work', label: 'Harapásvétel', work_phase_code: 'bite_registration', duration_minutes: 30, default_days_offset: 7 },
      { pool: 'work', label: 'Esztétikai próba 1', work_phase_code: 'aesthetic_try_in_1', duration_minutes: 30, default_days_offset: 10 },
      { pool: 'work', label: 'Esztétikai próba 2', work_phase_code: 'aesthetic_try_in_2', duration_minutes: 30, default_days_offset: 7 },
      { pool: 'work', label: 'Funkcionális próba', work_phase_code: 'functional_try_in', duration_minutes: 30, default_days_offset: 7 },
      { pool: 'work', label: 'Átadás', work_phase_code: 'delivery', duration_minutes: 45, default_days_offset: 10, requires_precommit: true },
      { pool: 'control', label: '1 hónapos kontroll', work_phase_code: 'control_1m', duration_minutes: 20, default_days_offset: 30 },
      { pool: 'control', label: '6 hónapos kontroll', work_phase_code: 'control_6m', duration_minutes: 20, default_days_offset: 180 },
      { pool: 'control', label: '12 hónapos kontroll', work_phase_code: 'control_12m', duration_minutes: 20, default_days_offset: 365 },
    ],
  },
  {
    name: 'Komplex full-arch implantációs rehabilitáció (szimuláció)',
    code: 'sim_komplex_fullarch',
    phases: [
      { pool: 'consult', label: 'Első konzultáció', work_phase_code: 'consult_1', duration_minutes: 30, default_days_offset: 0 },
      { pool: 'work', label: 'CBCT és diagnosztika', work_phase_code: 'cbct_diagnostic', duration_minutes: 45, default_days_offset: 10 },
      { pool: 'work', label: 'Sebészi sablon tervezés', work_phase_code: 'surgical_guide_planning', duration_minutes: 45, default_days_offset: 14 },
      { pool: 'work', label: 'Implantáció (felső)', work_phase_code: 'implant_placement_upper', duration_minutes: 90, default_days_offset: 14 },
      { pool: 'work', label: 'Implantáció (alsó)', work_phase_code: 'implant_placement_lower', duration_minutes: 90, default_days_offset: 30 },
      { pool: 'control', label: 'Sebkontroll', work_phase_code: 'suture_check', duration_minutes: 15, default_days_offset: 10 },
      { pool: 'control', label: 'Oszteointegráció kontroll', work_phase_code: 'osseo_check', duration_minutes: 20, default_days_offset: 90 },
      { pool: 'work', label: 'Felépítmény behelyezés', work_phase_code: 'abutment_placement', duration_minutes: 45, default_days_offset: 14 },
      { pool: 'work', label: 'Lenyomat', work_phase_code: 'impression_implant', duration_minutes: 45, default_days_offset: 7 },
      { pool: 'work', label: 'Vázpróba', work_phase_code: 'framework_try_in', duration_minutes: 30, default_days_offset: 14 },
      { pool: 'work', label: 'Fogfelállítás próba', work_phase_code: 'tooth_setup_try_in', duration_minutes: 30, default_days_offset: 10 },
      { pool: 'work', label: 'Végleges próba', work_phase_code: 'final_try_in', duration_minutes: 30, default_days_offset: 7 },
      { pool: 'work', label: 'Átadás', work_phase_code: 'delivery', duration_minutes: 45, default_days_offset: 10, requires_precommit: true },
      { pool: 'control', label: '1 hónapos kontroll', work_phase_code: 'control_1m', duration_minutes: 20, default_days_offset: 30 },
      { pool: 'control', label: '3 hónapos kontroll', work_phase_code: 'control_3m', duration_minutes: 20, default_days_offset: 90 },
      { pool: 'control', label: '6 hónapos kontroll', work_phase_code: 'control_6m', duration_minutes: 20, default_days_offset: 180 },
      { pool: 'control', label: '12 hónapos kontroll', work_phase_code: 'control_12m', duration_minutes: 20, default_days_offset: 365 },
    ],
  },
];

async function ensureComplexPathways() {
  // care_pathways has unique indexes on BOTH reason and treatment_type_id (XOR
  // constraint: exactly one set). The 3 reasons are already taken by seeded
  // pathways, so attach the synthetic pathways via a dedicated treatment_type.
  for (const cp of COMPLEX_PATHWAYS) {
    let tt = (await q<{ id: string }>(`SELECT id FROM treatment_types WHERE code = $1`, [cp.code]))[0];
    if (!tt) {
      tt = (await q<{ id: string }>(`INSERT INTO treatment_types (code, label_hu) VALUES ($1, $2) RETURNING id`, [cp.code, cp.name]))[0];
    }
    const json = JSON.stringify(cp.phases);
    const existing = (await q<{ id: string }>(`SELECT id FROM care_pathways WHERE treatment_type_id = $1`, [tt.id]))[0];
    if (existing) {
      await q(`UPDATE care_pathways SET work_phases_json = $2::jsonb, steps_json = $2::jsonb, name = $3 WHERE id = $1`, [existing.id, json, cp.name]);
    } else {
      await q(
        `INSERT INTO care_pathways (name, treatment_type_id, work_phases_json, steps_json, version, priority)
         VALUES ($1, $2, $3::jsonb, $3::jsonb, 1, 100)`,
        [cp.name, tt.id, json]
      );
    }
  }
}

// ── Step 2: care pathways available to assign ──────────────────────────────────
async function loadPathways() {
  return q<{ id: string; name: string; reason: string | null; wp: number; maxcode: number }>(
    `SELECT cp.id, cp.name, cp.reason,
            jsonb_array_length(coalesce(cp.work_phases_json,'[]'::jsonb)) AS wp,
            COALESCE(MAX(length(p->>'work_phase_code')), 0) AS maxcode
     FROM care_pathways cp
     LEFT JOIN LATERAL jsonb_array_elements(cp.work_phases_json) p ON true
     WHERE jsonb_array_length(coalesce(cp.work_phases_json,'[]'::jsonb)) > 0
     GROUP BY cp.id, cp.name, cp.reason, cp.work_phases_json
     ORDER BY wp DESC`
  );
}

// ── Step 3: a patient ──────────────────────────────────────────────────────────
async function createPatient(i: number): Promise<{ id: string; nev: string }> {
  const nev = `${LAST[i % LAST.length]} ${FIRST[(i * 5) % FIRST.length]}`;
  const taj = `${pad((i * 7 + 11) % 100)}${pad((i * 3 + 5) % 100)}${pad((i * 9 + 1) % 100)}${pad(i % 100)}`;
  const rows = await q<{ id: string }>(
    `INSERT INTO patients (nev, taj, telefonszam, email, nem, felvetel_datuma, created_by)
     VALUES ($1,$2,$3,$4,$5, now(), 'sim@local')
     RETURNING id`,
    [nev, taj, `+3630${pad(i)}${pad(i * 3)}${pad(i * 7)}`, `patient${i}@sim.local`, i % 2 === 0 ? 'ferfi' : 'no']
  );
  return { id: rows[0].id, nev };
}

// ── Step 4: provider availability — dense slots across ~8 months ───────────────
async function generateSlots(providers: { id: string }[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1); // from tomorrow (first-bookable only returns future slots)
  const DAYS = 1120; // ~3 years forward — long enough for 20-phase plans ending in 12-month controls
  const hours = [9, 10, 11, 13, 14, 15];
  const purposes = ['consult', 'work', 'work', 'control', 'work', 'flexible'];
  let count = 0;
  // Batch insert
  const values: string[] = [];
  const params: unknown[] = [];
  let pi = 1;
  for (let d = 0; d < DAYS; d++) {
    const day = new Date(start);
    day.setDate(start.getDate() + d);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // weekdays only
    for (const prov of providers) {
      for (let h = 0; h < hours.length; h++) {
        const slot = new Date(day);
        slot.setHours(hours[h], 0, 0, 0);
        // 90-min slots so even the long surgical/diagnostic phases (60–90 min) fit.
        values.push(`($${pi++},$${pi++},$${pi++},'free',$${pi++},90,'manual')`);
        params.push(prov.id, slot.toISOString(), 'available', purposes[h]);
        count++;
      }
    }
    // flush periodically
    if (params.length > 4000) {
      await q(
        `INSERT INTO available_time_slots (user_id, start_time, status, state, slot_purpose, duration_minutes, source)
         VALUES ${values.join(',')}`,
        params
      );
      values.length = 0;
      params.length = 0;
      pi = 1;
    }
  }
  if (values.length) {
    await q(
      `INSERT INTO available_time_slots (user_id, start_time, status, state, slot_purpose, duration_minutes, source)
       VALUES ${values.join(',')}`,
      params
    );
  }
  return count;
}

// ── helper: mark an appointment + its work phase completed (advance anchor) ────
async function completeAppointment(episodeId: string, apptId: string, startTime: string, workPhaseCode: string) {
  await q(`UPDATE appointments SET appointment_status = 'completed', start_time = $2 WHERE id = $1`, [apptId, startTime]);
  await q(
    `UPDATE episode_work_phases
       SET status = 'completed', completed_at = $3, appointment_id = $2
     WHERE id = (
       SELECT id FROM episode_work_phases
       WHERE episode_id = $1 AND work_phase_code = $4 AND status <> 'completed'
       ORDER BY seq LIMIT 1
     )`,
    [episodeId, apptId, startTime, workPhaseCode]
  );
}

type Booking = { seq: number; step: string; pool: string; date: string; provider: string; completed: boolean };

async function simulateEpisode(
  episodeId: string,
  patientId: string,
  providerById: Map<string, string>,
  maxSteps: number,
  completeThrough: number // mark completed up to this many steps; rest stay pending(future)
): Promise<{ bookings: Booking[]; blocked?: string; projected: number }> {
  const bookings: Booking[] = [];
  const bookedCodes = new Set<string>();

  // The forward-chained plan projection (months ahead) — the core scheduling mechanism.
  let proj: { projected: number } = { projected: -1 };
  try {
    proj = await projectRemainingSteps(episodeId);
  } catch (e) {
    console.warn(`  projectRemainingSteps failed for ${episodeId}: ${(e as Error).message}`);
  }

  for (let step = 0; step < maxSteps; step++) {
    const ns = await nextRequiredStep(episodeId);
    if ('status' in ns && ns.status === 'blocked') {
      return { bookings, blocked: ns.reason, projected: proj.projected };
    }
    const next = ns as Extract<typeof ns, { work_phase_code: string }>;
    // All distinct pathway phases handled — engine is now re-offering (terminal).
    if (bookedCodes.has(next.work_phase_code)) break;
    bookedCodes.add(next.work_phase_code);

    const fb = await getFirstBookableSlotForEpisode(episodeId, { providerScope: 'episode', authRole: 'admin' });
    if (fb.kind === 'blocked') return { bookings, blocked: fb.blockedReason, projected: proj.projected };
    if (fb.kind === 'none') {
      // No free slot fell inside the window — should be rare given dense availability.
      break;
    }

    const apptType = next.pool === 'consult' ? 'elso_konzultacio' : next.pool === 'control' ? 'kontroll' : 'munkafazis';
    const providerName = providerById.get(fb.dentistUserId) ?? fb.dentistUserId;
    const auth = { email: fb.dentistEmail ?? 'sim@local', userId: fb.dentistUserId, role: 'admin' };
    const outcome = await createAppointment(
      pool,
      {
        patientId,
        timeSlotId: fb.slotId,
        episodeId,
        appointmentType: apptType,
        pool: next.pool,
        createdVia: 'worklist',
        stepCode: next.work_phase_code,
        requiresPrecommit: false,
      },
      auth
    );
    if (!outcome.ok) {
      return { bookings, blocked: `createAppointment: ${JSON.stringify(outcome.validationError)}`, projected: proj.projected };
    }
    const appt = outcome.result.appointment;
    const willComplete = step < completeThrough;
    bookings.push({
      seq: step + 1,
      step: next.label ?? next.work_phase_code,
      pool: next.pool,
      date: fb.startTime,
      provider: providerName,
      completed: willComplete,
    });

    if (willComplete) {
      await completeAppointment(episodeId, appt.id, fb.startTime, next.work_phase_code);
    } else {
      // Leave as a pending/scheduled future appointment, but still advance the work
      // phase so the engine offers the following step (keeps the chain marching forward).
      await q(
        `UPDATE episode_work_phases
           SET status = 'scheduled', appointment_id = $2
         WHERE id = (SELECT id FROM episode_work_phases
                     WHERE episode_id = $1 AND work_phase_code = $3 AND status NOT IN ('completed','scheduled')
                     ORDER BY seq LIMIT 1)`,
        [episodeId, appt.id, next.work_phase_code]
      );
      // advance anchor using this future appointment's time so the next window chains forward
      await q(`UPDATE appointments SET start_time = $2 WHERE id = $1`, [appt.id, fb.startTime]);
    }
  }
  return { bookings, projected: proj.projected };
}

// ── Validate the step-ordering guard: booking a LATER work phase before its
// prerequisites are handled must be rejected with STEP_PREREQUISITE_NOT_MET. ──
async function verifyStepOrderingGuard(provider: { id: string; email: string }): Promise<{ blocked: boolean; code: string | null; error?: string }> {
  const patient = await createPatient(999);
  const episode = await createOpenEpisodeWithInitialStageZero(pool, {
    patientId: patient.id,
    reason: 'onkológiai kezelés utáni állapot',
    chiefComplaint: 'Lépés-sorrend őr teszt',
    caseTitle: 'Guard teszt',
    parentEpisodeId: null,
    triggerType: null,
    treatmentTypeId: null,
    createdBy: 'sim@local',
  });
  const cp = (await q<{ id: string }>(`SELECT id FROM care_pathways WHERE name = $1`, [COMPLEX_PATHWAYS[0].name]))[0];
  await q(
    `UPDATE patient_episodes SET care_pathway_id = $2, assigned_provider_id = $3, opened_at = now(), plan_start_date = now() WHERE id = $1`,
    [episode.id, cp.id, provider.id]
  );
  await generateEpisodeWorkPhases(pool, episode.id);
  const slot = (await q<{ id: string }>(
    `SELECT id FROM available_time_slots WHERE user_id = $1 AND state = 'free' AND start_time > now() ORDER BY start_time LIMIT 1`,
    [provider.id]
  ))[0];
  // Try to book a deep work phase ('framework_try_in') while consult/diagnostic/…
  // are still pending. Admin, no override reason → must be blocked.
  const outcome = await createAppointment(
    pool,
    {
      patientId: patient.id,
      timeSlotId: slot.id,
      episodeId: episode.id,
      appointmentType: 'munkafazis',
      pool: 'work',
      createdVia: 'worklist',
      stepCode: 'framework_try_in',
      requiresPrecommit: false,
    },
    { email: provider.email, userId: provider.id, role: 'admin' }
  );
  if (outcome.ok) return { blocked: false, code: null };
  return { blocked: true, code: (outcome.validationError as { code?: string }).code ?? null, error: outcome.validationError.error };
}

async function main() {
  console.log('=== SIMULATION START ===');
  await resetData();
  await relaxFlags();
  const providers = await ensureUsers();
  const providerById = new Map(providers.map((p) => [p.id, p.name]));
  console.log(`Providers: ${providers.map((p) => p.name).join(', ')}`);

  await ensureComplexPathways();
  const allPathways = await loadPathways();
  // step_code columns are now varchar(80) (migration 058), so codes up to 80 chars
  // (incl. the long legacy code and our synthetic 66-char code) are all usable.
  const pathways = allPathways.filter((p) => p.maxcode <= 80);
  const excludedPathways = allPathways.filter((p) => p.maxcode > 80).map((p) => ({ name: p.name, maxcode: p.maxcode }));
  const complexNames = new Set(COMPLEX_PATHWAYS.map((c) => c.name));
  // Prefer LONG/complicated plans: the synthetic complex pathways first, then the
  // longest seeded ones (≥8 phases) — so every patient gets a multi-step plan.
  const complex = pathways.filter((p) => complexNames.has(p.name));
  const longSeeded = pathways.filter((p) => !complexNames.has(p.name) && p.wp >= 8);
  const rotation = [...complex, ...longSeeded];
  console.log(`Care pathways: ${allPathways.length} total, ${pathways.length} usable, ${complex.length} complex (${complex.map((c) => c.wp + 'p').join(',')}), rotation size ${rotation.length}`);
  if (excludedPathways.length) console.log('  Excluded (>80-char codes):', excludedPathways.map((e) => `${e.name} (${e.maxcode})`).join('; '));

  const slots = await generateSlots(providers);
  console.log(`Generated ${slots} available time slots across ~20 months.`);

  const N = 10;
  const report: any[] = [];
  for (let i = 0; i < N; i++) {
    const patient = await createPatient(i);
    const reason = REASONS[i % REASONS.length];

    const episode = await createOpenEpisodeWithInitialStageZero(pool, {
      patientId: patient.id,
      reason,
      chiefComplaint: `Szimulált eset #${i + 1}`,
      caseTitle: `Sim eset ${i + 1}`,
      parentEpisodeId: null,
      triggerType: null,
      treatmentTypeId: null,
      createdBy: 'sim@local',
    });

    // Rotate through the LONG plans (complex first, then longest seeded).
    const match = rotation[i % rotation.length];
    const provider = providers[i % providers.length];

    // Small stagger (0–3 weeks) so episodes don't all start the same day, but keep
    // the first window in the near future (first-bookable only returns future slots).
    const openedAt = new Date();
    openedAt.setDate(openedAt.getDate() + (i % 4) * 5);

    await q(
      `UPDATE patient_episodes
         SET care_pathway_id = $2, assigned_provider_id = $3, opened_at = $4, plan_start_date = $4
       WHERE id = $1`,
      [episode.id, match.id, provider.id, openedAt.toISOString()]
    );

    const gen = await generateEpisodeWorkPhases(pool, episode.id);

    // Complete most of the chain (fast-forward), leaving the final phase as a
    // future "scheduled" appointment — so the timeline shows done + upcoming.
    const completeThrough = Math.max(1, match.wp - 1);
    const sim = await simulateEpisode(episode.id, patient.id, providerById, match.wp + 2, completeThrough);

    const line = {
      patient: patient.nev,
      reason,
      pathway: match.name,
      provider: provider.name,
      plannedPhases: match.wp,
      workPhasesGenerated: gen.status === 'ok' ? gen.totalGenerated : gen.status,
      projectedSlotIntents: sim.projected,
      booked: sim.bookings.length,
      completed: sim.bookings.filter((b) => b.completed).length,
      future: sim.bookings.filter((b) => !b.completed).length,
      firstDate: sim.bookings[0]?.date?.slice(0, 10) ?? '-',
      lastDate: sim.bookings[sim.bookings.length - 1]?.date?.slice(0, 10) ?? '-',
      blocked: sim.blocked ?? null,
      bookings: sim.bookings,
    };
    report.push(line);
    console.log(
      `#${i + 1} ${patient.nev.padEnd(20)} ${match.name.slice(0, 32).padEnd(34)} ` +
        `phases=${line.workPhasesGenerated} intents=${line.projectedSlotIntents} booked=${line.booked} ` +
        `(${line.completed}✓/${line.future}→) ${line.firstDate}…${line.lastDate}` +
        (line.blocked ? `  BLOCKED: ${line.blocked}` : '')
    );
  }

  // Validate the step-ordering guard (out-of-order booking must be blocked).
  const guard = await verifyStepOrderingGuard(providers[0]);
  console.log(`\nStep-ordering guard: out-of-order booking ${guard.blocked ? 'BLOCKED ✓' : 'NOT blocked ✗'}` +
    (guard.code ? ` (${guard.code})` : '') + (guard.error ? ` — "${guard.error}"` : ''));

  // Write JSON report for the markdown summary step.
  const fs = await import('fs');
  const out = {
    generatedAt: new Date().toISOString(),
    providers: providers.map((p) => ({ name: p.name, email: p.email })),
    slotsGenerated: slots,
    pathwaysTotal: allPathways.length,
    excludedPathways,
    stepOrderingGuard: guard,
    episodes: report,
  };
  fs.writeFileSync('sim-out/simulation-report.json', JSON.stringify(out, null, 2));
  console.log('\nWrote sim-out/simulation-report.json');
  console.log('=== SIMULATION COMPLETE ===');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
