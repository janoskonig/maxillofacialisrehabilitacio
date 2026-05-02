/**
 * SQL integration test — partial unique index ↔ booking guard PARITY.
 *
 * Verifies that the things the application booking-guard rejects/accepts and
 * the things the partial unique index `idx_appointments_unique_work_phase_active`
 * rejects/accepts are the SAME set. The whole point of the work-phase
 * stabilization plan was to remove the gap where the worklist could advertise
 * "READY" for a row the index would later reject.
 *
 * SAFETY:
 *   - Skipped unless `TEST_DATABASE_URL` is set (deliberately a different env
 *     var from `DATABASE_URL` so the suite never surprise-runs against prod).
 *   - The whole test runs in ONE transaction that is ROLLBACKed in afterAll,
 *     and every individual case uses SAVEPOINT + ROLLBACK TO SAVEPOINT, so
 *     not a single row should persist even if vitest crashes mid-run.
 *   - All synthetic data uses the `INTEGRATION_TEST_PARITY_` name prefix and
 *     the obviously fake TAJ `IT99999999`, so a manual cleanup is trivial if
 *     a transaction ever leaks.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgresql://... npx vitest run \
 *     __tests__/lib/work-phase-index-parity.integration.test.ts
 *
 * Recommended target: a clone of production. Migrations 016 and 025 must be
 * applied (the test probes for the canonical objects and skips otherwise).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import {
  SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT,
  isAppointmentActive,
} from '@/lib/active-appointment';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const SHOULD_RUN = Boolean(TEST_DATABASE_URL);

const ALL_STATUSES: Array<string | null> = [
  null,
  'completed',
  'no_show',
  'cancelled_by_doctor',
  'cancelled_by_patient',
];

let pool: Pool | null = null;
let client: PoolClient | null = null;

// IDs we'll use throughout the test — generated, not borrowed from the DB.
let testEpisodeId: string;
let testPatientId: string;
let testProviderId: string;
let testWorkPhaseId: string;

async function tableExists(c: PoolClient, name: string): Promise<boolean> {
  const r = await c.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name=$1
     ) AS exists`,
    [name]
  );
  return r.rows[0]?.exists === true;
}

async function columnExists(c: PoolClient, table: string, column: string): Promise<boolean> {
  const r = await c.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2
     ) AS exists`,
    [table, column]
  );
  return r.rows[0]?.exists === true;
}

async function indexExists(c: PoolClient, name: string): Promise<boolean> {
  const r = await c.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname='public' AND indexname=$1
     ) AS exists`,
    [name]
  );
  return r.rows[0]?.exists === true;
}

/**
 * Setup: open a transaction, create one episode + one work phase + one slot
 * to share across cases. The whole transaction is rolled back in `afterAll`,
 * so even if the run crashes the DB is left untouched.
 */
beforeAll(async () => {
  if (!SHOULD_RUN) return;
  pool = new Pool({
    connectionString: TEST_DATABASE_URL!,
    ssl: TEST_DATABASE_URL!.includes('sslmode=') ? { rejectUnauthorized: false } : undefined,
  });
  client = await pool.connect();
  await client.query('BEGIN');

  const required = [
    await columnExists(client, 'appointments', 'work_phase_id'),
    await indexExists(client, 'idx_appointments_unique_work_phase_active'),
    await tableExists(client, 'episode_work_phases'),
    await tableExists(client, 'patient_episodes'),
    await tableExists(client, 'patients'),
    await tableExists(client, 'available_time_slots'),
    await tableExists(client, 'users'),
  ];
  if (required.some((x) => !x)) {
    // Migration 016/025 missing — abort cleanly so the test is skipped.
    await client.query('ROLLBACK');
    client.release();
    client = null;
    return;
  }

  // Pick (or create) a real provider — we need a valid users.id for FK.
  const providerRes = await client.query(
    `SELECT id FROM users WHERE role IN ('admin','beutalo_orvos','fogpótlástanász') LIMIT 1`
  );
  if (providerRes.rows.length === 0) {
    await client.query('ROLLBACK');
    client.release();
    client = null;
    return;
  }
  testProviderId = providerRes.rows[0].id;

  // Patient — minimal columns; insert a synthetic record. Obviously-fake
  // name + TAJ so it's trivial to clean up if a transaction ever leaks.
  const patientRes = await client.query(
    `INSERT INTO patients (nev, taj) VALUES ('INTEGRATION_TEST_PARITY_PATIENT', 'IT99999999')
     RETURNING id`
  );
  testPatientId = patientRes.rows[0].id;

  const episodeRes = await client.query(
    `INSERT INTO patient_episodes (patient_id, status) VALUES ($1, 'open')
     RETURNING id`,
    [testPatientId]
  );
  testEpisodeId = episodeRes.rows[0].id;

  const ewpRes = await client.query(
    `INSERT INTO episode_work_phases (id, episode_id, work_phase_code, pathway_order_index, pool, duration_minutes, status)
     VALUES (gen_random_uuid(), $1, 'parity_test_phase', 0, 'work', 30, 'pending')
     RETURNING id`,
    [testEpisodeId]
  );
  testWorkPhaseId = ewpRes.rows[0].id;
});

afterAll(async () => {
  if (client) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be aborted */ }
    client.release();
  }
  if (pool) await pool.end();
});

/**
 * Insert one appointment for our test work phase with the given status, and
 * return whether the partial unique index lets a SECOND insert (NULL status,
 * different time slot, same work_phase_id) succeed.
 */
async function indexAllowsSecondInsertAfterFirstWith(
  status: string | null,
  savepoint: string
): Promise<boolean> {
  if (!client) throw new Error('client not initialised');
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    // Two distinct, isolated time slots so the time_slot_id unique index
    // doesn't muddle the result.
    const slot1 = await client.query(
      `INSERT INTO available_time_slots (user_id, start_time, end_time, duration_minutes, state)
       VALUES ($1, now() + interval '1 day', now() + interval '1 day' + interval '30 minutes', 30, 'free')
       RETURNING id`,
      [testProviderId]
    );
    const slot2 = await client.query(
      `INSERT INTO available_time_slots (user_id, start_time, end_time, duration_minutes, state)
       VALUES ($1, now() + interval '2 day', now() + interval '2 day' + interval '30 minutes', 30, 'free')
       RETURNING id`,
      [testProviderId]
    );

    await client.query(
      `INSERT INTO appointments
         (patient_id, episode_id, time_slot_id, created_by, dentist_email,
          appointment_type, pool, duration_minutes, requires_precommit,
          appointment_status, work_phase_id, step_code, step_seq)
       VALUES ($1, $2, $3, 'parity_test', 'parity_test', 'munkafazis',
               'work', 30, false, $4, $5, 'parity_test_phase', 0)`,
      [testPatientId, testEpisodeId, slot1.rows[0].id, status, testWorkPhaseId]
    );

    let secondAccepted = true;
    try {
      await client.query(
        `INSERT INTO appointments
           (patient_id, episode_id, time_slot_id, created_by, dentist_email,
            appointment_type, pool, duration_minutes, requires_precommit,
            appointment_status, work_phase_id, step_code, step_seq)
         VALUES ($1, $2, $3, 'parity_test', 'parity_test', 'munkafazis',
                 'work', 30, false, NULL, $4, 'parity_test_phase', 0)`,
        [testPatientId, testEpisodeId, slot2.rows[0].id, testWorkPhaseId]
      );
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === '23505' && err.constraint === 'idx_appointments_unique_work_phase_active') {
        secondAccepted = false;
      } else {
        throw e;
      }
    }

    return secondAccepted;
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
}

/**
 * Application-side guard: the canonical SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT
 * predicate run with a FROM (VALUES) so we don't even touch the appointments
 * table — pure predicate truth-table.
 */
async function guardWouldAcceptSecondAfterFirstWith(
  status: string | null
): Promise<boolean> {
  if (!client) throw new Error('client not initialised');
  // The guard rejects when the existing row IS active; accepts when the
  // existing row is NOT active.
  const r = await client.query(
    `SELECT NOT (${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT.replace(
      /a\.appointment_status/g,
      '$1::text'
    )}) AS guard_accepts`,
    [status]
  );
  return r.rows[0].guard_accepts === true;
}

describe('Partial unique index ↔ booking guard parity (W4 plan §4)', () => {
  if (!SHOULD_RUN) {
    it.skip('TEST_DATABASE_URL not set — skipping integration test', () => {});
    return;
  }

  it.each(ALL_STATUSES)(
    'index and guard agree about whether status=%j blocks a second active insert',
    async (status) => {
      if (!client) {
        // Setup decided to skip (missing migrations / no provider users).
        return;
      }
      const indexAllows = await indexAllowsSecondInsertAfterFirstWith(
        status,
        `s_${(status ?? 'null').replace(/\W/g, '_')}`
      );
      const guardAllows = await guardWouldAcceptSecondAfterFirstWith(status);
      const tsAllows = !isAppointmentActive(status);

      expect(
        { indexAllows, guardAllows, tsAllows },
        `Parity broken for status=${status ?? 'NULL'}: SQL guard, TS guard and partial unique index disagree`
      ).toEqual({ indexAllows: guardAllows, guardAllows, tsAllows: guardAllows });
    }
  );

  it('cancelled appointment frees the work phase (canonical behaviour)', async () => {
    if (!client) return;
    const allowed = await indexAllowsSecondInsertAfterFirstWith(
      'cancelled_by_doctor',
      's_cancel_demo'
    );
    expect(allowed).toBe(true);
  });

  it('NULL/pending appointment blocks a second NULL insert', async () => {
    if (!client) return;
    const allowed = await indexAllowsSecondInsertAfterFirstWith(null, 's_null_demo');
    expect(allowed).toBe(false);
  });
});
