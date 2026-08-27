import { randomUUID } from 'crypto';
import { getDbPool } from '@/lib/db';
import type { Queryable } from './db';

/**
 * Minimál-factory-k az integrációs tesztekhez. Csak a kötelező (NOT NULL,
 * default nélküli) oszlopokat és a tesztekben tipikusan kellő mezőket töltik.
 *
 * Használat kétféle izolációval:
 *  - withRollback-en belül: add át a clientet db-ként — a rollback mindent visz.
 *  - route-handlert hívó tesztben (a route maga COMMIT-ol): hívd a factory-kat
 *    db nélkül (pool), és afterEach-ben hívd meg a cleanupCreated()-et.
 *
 * Ha egy WP-hez új factory kell, lehetőleg KÜLÖN fájlba tedd
 * (factories-<wp>.ts), hogy a párhuzamos ágak ne ütközzenek ezen a fájlon.
 */

type CreatedRow = { table: string; id: string };
const created: CreatedRow[] = [];

function track(table: string, id: string, db?: Queryable): void {
  // Tranzakción belüli (client-es) hívásnál nem trackelünk — a ROLLBACK takarít.
  if (db) return;
  created.push({ table, id });
}

function q(db?: Queryable): Queryable {
  return db ?? getDbPool();
}

/** Commitolt teszt-adatok törlése fordított sorrendben (afterEach-be). */
export async function cleanupCreated(): Promise<void> {
  const pool = getDbPool();
  for (const row of [...created].reverse()) {
    await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
  }
  created.length = 0;
}

export async function createTestUser(
  db?: Queryable,
  overrides: {
    role?: 'admin' | 'fogpótlástanász' | 'technikus' | 'beutalo_orvos';
    email?: string;
    doktorNeve?: string;
  } = {}
): Promise<{ id: string; email: string; role: string }> {
  const email = overrides.email ?? `teszt-${randomUUID()}@integration.local`;
  const role = overrides.role ?? 'fogpótlástanász';
  const { rows } = await q(db).query(
    `INSERT INTO users (email, password_hash, role, doktor_neve, active)
     VALUES ($1, 'integration-test-not-a-real-hash', $2, $3, true)
     RETURNING id, email, role`,
    [email, role, overrides.doktorNeve ?? 'Dr. Integrációs Teszt']
  );
  track('users', rows[0].id, db);
  return rows[0];
}

export async function createTestPatient(
  db?: Queryable,
  overrides: { nev?: string } = {}
): Promise<{ id: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO patients (nev, email) VALUES ($1, $2) RETURNING id`,
    [overrides.nev ?? 'Integrációs Tesztbeteg', `beteg-${randomUUID()}@integration.local`]
  );
  track('patients', rows[0].id, db);
  return rows[0];
}

export async function createTestEpisode(
  db: Queryable | undefined,
  patientId: string,
  overrides: { status?: 'open' | 'closed' | 'paused'; reason?: string } = {}
): Promise<{ id: string; status: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO patient_episodes (patient_id, reason, chief_complaint, status)
     VALUES ($1, $2, 'integrációs teszt panasz', $3)
     RETURNING id, status`,
    [patientId, overrides.reason ?? 'traumás sérülés', overrides.status ?? 'open']
  );
  track('patient_episodes', rows[0].id, db);
  return rows[0];
}

export async function createTestWorkPhase(
  db: Queryable | undefined,
  episodeId: string,
  overrides: {
    workPhaseCode?: string;
    seq?: number | null;
    pathwayOrderIndex?: number;
    pool?: 'consult' | 'work' | 'control';
    durationMinutes?: number;
    status?: 'pending' | 'scheduled' | 'completed' | 'skipped';
    appointmentId?: string | null;
    customLabel?: string | null;
    completedAt?: Date | null;
  } = {}
): Promise<{ id: string; work_phase_code: string; status: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO episode_work_phases
       (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes,
        status, appointment_id, seq, custom_label, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, work_phase_code, status`,
    [
      episodeId,
      overrides.workPhaseCode ?? 'lenyomat',
      overrides.pathwayOrderIndex ?? overrides.seq ?? 0,
      overrides.pool ?? 'work',
      overrides.durationMinutes ?? 30,
      overrides.status ?? 'pending',
      overrides.appointmentId ?? null,
      overrides.seq ?? null,
      overrides.customLabel ?? null,
      overrides.completedAt ?? null,
    ]
  );
  track('episode_work_phases', rows[0].id, db);
  return rows[0];
}

export async function createTestSlot(
  db: Queryable | undefined,
  userId: string,
  overrides: {
    startTime?: Date;
    durationMinutes?: number;
    state?: 'free' | 'offered' | 'held' | 'booked' | 'blocked';
    status?: 'available' | 'booked';
    slotPurpose?: 'consult' | 'work' | 'control' | 'flexible';
  } = {}
): Promise<{ id: string; state: string; status: string }> {
  const start =
    overrides.startTime ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +1 hét
  const { rows } = await q(db).query(
    `INSERT INTO available_time_slots
       (user_id, start_time, status, state, slot_purpose, duration_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, state, status`,
    [
      userId,
      start,
      overrides.status ?? 'available',
      overrides.state ?? 'free',
      overrides.slotPurpose ?? 'work',
      overrides.durationMinutes ?? 30,
    ]
  );
  track('available_time_slots', rows[0].id, db);
  return rows[0];
}

export async function createTestSlotIntent(
  db: Queryable | undefined,
  episodeId: string,
  overrides: {
    stepCode?: string;
    stepSeq?: number;
    state?: 'open' | 'converted' | 'cancelled' | 'expired';
    pool?: 'consult' | 'work' | 'control';
    durationMinutes?: number;
    workPhaseId?: string | null;
  } = {}
): Promise<{ id: string; state: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO slot_intents
       (episode_id, step_code, step_seq, state, pool, duration_minutes, work_phase_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, state`,
    [
      episodeId,
      overrides.stepCode ?? 'lenyomat',
      overrides.stepSeq ?? 0,
      overrides.state ?? 'open',
      overrides.pool ?? 'work',
      overrides.durationMinutes ?? 30,
      overrides.workPhaseId ?? null,
    ]
  );
  track('slot_intents', rows[0].id, db);
  return rows[0];
}

export async function createTestAppointment(
  db: Queryable | undefined,
  args: {
    patientId: string;
    timeSlotId: string;
    episodeId?: string | null;
    workPhaseId?: string | null;
    slotIntentId?: string | null;
    stepCode?: string | null;
    stepSeq?: number | null;
    startTime?: Date | null;
    endTime?: Date | null;
    appointmentStatus?:
      | 'cancelled_by_doctor'
      | 'cancelled_by_patient'
      | 'completed'
      | 'no_show'
      | 'unsuccessful'
      | null;
    createdBy?: string;
    attemptNumber?: number;
  }
): Promise<{ id: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO appointments
       (patient_id, time_slot_id, created_by, episode_id, work_phase_id,
        slot_intent_id, step_code, step_seq, start_time, end_time,
        appointment_status, created_via, attempt_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'migration', $12)
     RETURNING id`,
    [
      args.patientId,
      args.timeSlotId,
      args.createdBy ?? 'integration-teszt@integration.local',
      args.episodeId ?? null,
      args.workPhaseId ?? null,
      args.slotIntentId ?? null,
      args.stepCode ?? null,
      args.stepSeq ?? null,
      args.startTime ?? null,
      args.endTime ?? null,
      args.appointmentStatus ?? null,
      args.attemptNumber ?? 1,
    ]
  );
  track('appointments', rows[0].id, db);
  return rows[0];
}
