/**
 * Read-only consistency probe for the work-phase ↔ appointment ↔ slot-intent
 * graph. Surfaces the inconsistencies the work-phase-booking-stabilization plan
 * (Phase 2) calls out, before we touch the data model.
 *
 * No mutations — safe to run in production. Each check is bounded with LIMIT
 * so the endpoint stays cheap; the `total` field reports the unbounded count
 * via a separate `COUNT(*)` query.
 *
 * Backward-compatible: tolerates missing optional columns/tables — emits
 * `available: false` and skips the check rather than throwing.
 */

import type { Pool } from 'pg';
import {
  SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT,
  SQL_APPOINTMENT_CANCELLED_STATUS_FRAGMENT,
} from './active-appointment';
import { APPOINTMENT_STATUS_VALUES } from './appointment-status';

export type BookingConsistencyCheckId =
  | 'phase_pending_with_active_appointment'
  | 'phase_appointment_id_dangling'
  | 'appointment_for_step_but_phase_not_booked'
  | 'open_intent_with_active_appointment'
  | 'duplicate_step_code_in_episode'
  | 'step_seq_drift'
  | 'unknown_appointment_status_value'
  | 'slot_state_appointment_drift_free_with_active'
  | 'slot_state_appointment_drift_booked_without_active';

export interface BookingConsistencyCheckResult {
  id: BookingConsistencyCheckId;
  description: string;
  available: boolean;
  total: number;
  sample: Array<Record<string, unknown>>;
  notes?: string;
}

export interface BookingConsistencyReport {
  generatedAt: string;
  sampleLimit: number;
  checks: BookingConsistencyCheckResult[];
}

const DEFAULT_SAMPLE_LIMIT = 25;

interface Queryable {
  query: <T extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
}

async function tableExists(db: Queryable, table: string): Promise<boolean> {
  const r = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table]
  );
  return r.rows[0]?.exists === true;
}

async function safeProbe<T>(
  description: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<{ value: T; error?: string }> {
  try {
    return { value: await fn() };
  } catch (e) {
    const err = e as { message?: string };
    return { value: fallback, error: `${description}: ${err.message ?? 'unknown error'}` };
  }
}

/**
 * 1) episode_work_phases pending/scheduled, miközben az adott step-re már van
 *    aktív appointment. Ezekre a worklist hibásan READY/BOOKED felé billent.
 */
async function checkPhasePendingWithActiveAppointment(
  db: Queryable,
  limit: number
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM (
       SELECT 1
       FROM episode_work_phases ewp
       JOIN appointments a
         ON a.episode_id = ewp.episode_id AND a.step_code = ewp.work_phase_code
       WHERE ewp.status IN ('pending', 'scheduled')
         AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
     ) sub`
  );
  const sample = await db.query(
    `SELECT ewp.id AS work_phase_id, ewp.episode_id, ewp.work_phase_code, ewp.status,
            a.id AS appointment_id, a.appointment_status, a.start_time
     FROM episode_work_phases ewp
     JOIN appointments a
       ON a.episode_id = ewp.episode_id AND a.step_code = ewp.work_phase_code
     WHERE ewp.status IN ('pending', 'scheduled')
       AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
     ORDER BY ewp.episode_id, ewp.pathway_order_index
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

/**
 * 2) episode_work_phases.appointment_id egy nem létező, vagy egy cancelled
 *    appointmentre mutat. Ilyenkor a phase status hazudik, mert nincs élő
 *    appointment.
 */
async function checkPhaseAppointmentIdDangling(
  db: Queryable,
  limit: number
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM episode_work_phases ewp
     LEFT JOIN appointments a ON a.id = ewp.appointment_id
     WHERE ewp.appointment_id IS NOT NULL
       AND (a.id IS NULL OR ${SQL_APPOINTMENT_CANCELLED_STATUS_FRAGMENT})`
  );
  const sample = await db.query(
    `SELECT ewp.id AS work_phase_id, ewp.episode_id, ewp.work_phase_code, ewp.status,
            ewp.appointment_id,
            a.appointment_status,
            (a.id IS NULL) AS appointment_missing
     FROM episode_work_phases ewp
     LEFT JOIN appointments a ON a.id = ewp.appointment_id
     WHERE ewp.appointment_id IS NOT NULL
       AND (a.id IS NULL OR ${SQL_APPOINTMENT_CANCELLED_STATUS_FRAGMENT})
     ORDER BY ewp.episode_id, ewp.pathway_order_index
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

/**
 * 3) Van aktív appointment egy lépéshez, de a megfelelő work phase NEM
 *    BOOKED/scheduled. Status sync drift, a worklist itt is hazudhat.
 */
async function checkAppointmentExistsButPhaseNotBooked(
  db: Queryable,
  limit: number
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM (
       SELECT 1
       FROM appointments a
       JOIN episode_work_phases ewp
         ON ewp.episode_id = a.episode_id AND ewp.work_phase_code = a.step_code
       WHERE ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
         AND a.episode_id IS NOT NULL
         AND a.step_code IS NOT NULL
         AND ewp.status NOT IN ('scheduled', 'completed')
     ) sub`
  );
  const sample = await db.query(
    `SELECT a.id AS appointment_id, a.episode_id, a.step_code, a.appointment_status, a.start_time,
            ewp.id AS work_phase_id, ewp.status AS work_phase_status
     FROM appointments a
     JOIN episode_work_phases ewp
       ON ewp.episode_id = a.episode_id AND ewp.work_phase_code = a.step_code
     WHERE ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
       AND a.episode_id IS NOT NULL
       AND a.step_code IS NOT NULL
       AND ewp.status NOT IN ('scheduled', 'completed')
     ORDER BY a.episode_id, ewp.pathway_order_index
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

/**
 * 4) slot_intents open, miközben már létezik aktív appointment ugyanarra a
 *    lépésre. A projector vagy az expiry worker nem ürítette ki az intentet.
 */
async function checkOpenIntentWithActiveAppointment(
  db: Queryable,
  limit: number
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM (
       SELECT DISTINCT si.id
       FROM slot_intents si
       JOIN appointments a
         ON a.episode_id = si.episode_id AND a.step_code = si.step_code
       WHERE si.state = 'open'
         AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
     ) sub`
  );
  const sample = await db.query(
    `SELECT DISTINCT si.id AS intent_id, si.episode_id, si.step_code, si.state,
            a.id AS appointment_id, a.appointment_status
     FROM slot_intents si
     JOIN appointments a
       ON a.episode_id = si.episode_id AND a.step_code = si.step_code
     WHERE si.state = 'open'
       AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
     ORDER BY si.episode_id, si.step_code
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

/**
 * 5a) ugyanaz a (episode_id, work_phase_code) többször szerepel a phase
 *     táblában (merged_into kivételével). Pathway materialize hibát jelezhet.
 */
async function checkDuplicateStepCodeInEpisode(
  db: Queryable,
  limit: number,
  hasMergedColumn: boolean
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  const mergedFilter = hasMergedColumn ? 'AND ewp.merged_into_episode_work_phase_id IS NULL' : '';
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM (
       SELECT ewp.episode_id, ewp.work_phase_code
       FROM episode_work_phases ewp
       WHERE ewp.status IN ('pending', 'scheduled', 'completed')
         ${mergedFilter}
       GROUP BY ewp.episode_id, ewp.work_phase_code
       HAVING COUNT(*) > 1
     ) sub`
  );
  const sample = await db.query(
    `SELECT ewp.episode_id, ewp.work_phase_code, COUNT(*)::int AS occurrences,
            array_agg(ewp.id ORDER BY ewp.pathway_order_index) AS work_phase_ids,
            array_agg(ewp.status ORDER BY ewp.pathway_order_index) AS statuses
     FROM episode_work_phases ewp
     WHERE ewp.status IN ('pending', 'scheduled', 'completed')
       ${mergedFilter}
     GROUP BY ewp.episode_id, ewp.work_phase_code
     HAVING COUNT(*) > 1
     ORDER BY ewp.episode_id
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

/**
 * 5b) step_seq drift egy epizódon belül: nem 0..N-1, vagy gap van benne.
 *     Ez a chain-booking sorrendet törheti.
 */
/**
 * 6) Taxonomy drift detector: any `appointment_status` value outside the
 *    canonical set (lib/appointment-status.ts) is an anomaly. NULL is fine
 *    (= pending). Migration 026 adds a CHECK constraint that prevents this
 *    going forward, but the report keeps running it so legacy rows from
 *    before the constraint was applied are surfaced.
 */
async function checkUnknownAppointmentStatusValue(
  db: Queryable,
  limit: number
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  // Build the literal list from the canonical TS array — keeps the SQL
  // in sync with `lib/appointment-status.ts` automatically.
  const allowed = APPOINTMENT_STATUS_VALUES.map((v) => `'${v}'`).join(', ');
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM appointments
     WHERE appointment_status IS NOT NULL
       AND appointment_status NOT IN (${allowed})`
  );
  const sample = await db.query(
    `SELECT id AS appointment_id, episode_id, appointment_status, created_at
     FROM appointments
     WHERE appointment_status IS NOT NULL
       AND appointment_status NOT IN (${allowed})
     ORDER BY created_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

/**
 * 7) Slot-state ↔ appointment row drift, két iránya:
 *
 *   A) `available_time_slots.state = 'free'` DE \u00e9l akt\u00edv `appointments` row a
 *      slottra. Ez okozza a bulk-convert flow-ban a `SLOT_ALREADY_BOOKED` hib\u00e1t:
 *      a slot picker visszaadja a slotot szabadk\u00e9nt, de az UPSERT (helyesen)
 *      nem \u00edrja fel\u00fcl az \u00e9l\u0151 foglal\u00e1st, \u00e9s minden ut\u00e1na j\u00f6v\u0151 intent ugyanezt
 *      a slotot pickeli \u00e9s elbukik. F\u0151 forr\u00e1sa az `appointments[id]/status` PATCH
 *      cancellation \u00e1ga volt (st\u00e1tuszt cancelled-re \u00e1ll\u00edtott, de a slot.state-t
 *      nem; a t\u00f6bbi cancellation \u00fatvonalr\u00f3l valami \u00fajra `state='free'`-re
 *      friss\u00edthette a slotot). Mostm\u00e1r a status PATCH is szinkronban tartja.
 *
 *   B) `available_time_slots.state = 'booked'` DE NINCS akt\u00edv `appointments` row.
 *      "Frozen slot": senki sem tudja \u00fajra lefoglalni, mert a picker `state='free'`
 *      sz\u0171r\u0151je sz\u00e1m\u0171zi. F\u0151 forr\u00e1sa: r\u00e9gi cancellation \u00fatvonalak, amelyek a
 *      slot st\u00e1tuszt nem reszetelt\u00e9k.
 *
 * Mindk\u00e9t ir\u00e1nyt LIMIT-tel mintav\u00e9telezz\u00fck, total a teljes drift sz\u00e1mot adja.
 */
async function checkSlotStateAppointmentDriftFreeWithActive(
  db: Queryable,
  limit: number
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM available_time_slots ats
     WHERE ats.state = 'free'
       AND EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.time_slot_id = ats.id
            AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
       )`
  );
  const sample = await db.query(
    `SELECT ats.id AS slot_id, ats.start_time, ats.user_id,
            a.id AS appointment_id, a.appointment_status, a.episode_id, a.step_code
     FROM available_time_slots ats
     JOIN appointments a ON a.time_slot_id = ats.id
     WHERE ats.state = 'free'
       AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
     ORDER BY ats.start_time ASC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

async function checkSlotStateAppointmentDriftBookedWithoutActive(
  db: Queryable,
  limit: number
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM available_time_slots ats
     WHERE ats.state = 'booked'
       AND NOT EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.time_slot_id = ats.id
            AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
       )`
  );
  const sample = await db.query(
    `SELECT ats.id AS slot_id, ats.start_time, ats.user_id, ats.status, ats.state
     FROM available_time_slots ats
     WHERE ats.state = 'booked'
       AND NOT EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.time_slot_id = ats.id
            AND ${SQL_APPOINTMENT_ACTIVE_STATUS_FRAGMENT}
       )
     ORDER BY ats.start_time ASC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

async function checkStepSeqDrift(
  db: Queryable,
  limit: number,
  hasSeqColumn: boolean,
  hasMergedColumn: boolean
): Promise<Pick<BookingConsistencyCheckResult, 'total' | 'sample'>> {
  if (!hasSeqColumn) {
    return { total: 0, sample: [] };
  }
  const mergedFilter = hasMergedColumn ? 'AND ewp.merged_into_episode_work_phase_id IS NULL' : '';
  const totalRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM (
       SELECT ewp.episode_id
       FROM episode_work_phases ewp
       WHERE ewp.seq IS NOT NULL ${mergedFilter}
       GROUP BY ewp.episode_id
       HAVING MIN(ewp.seq) <> 0
          OR MAX(ewp.seq) <> COUNT(*) - 1
          OR COUNT(DISTINCT ewp.seq) <> COUNT(*)
     ) sub`
  );
  const sample = await db.query(
    `SELECT ewp.episode_id,
            MIN(ewp.seq) AS min_seq, MAX(ewp.seq) AS max_seq,
            COUNT(*)::int AS rows_count, COUNT(DISTINCT ewp.seq)::int AS distinct_seqs
     FROM episode_work_phases ewp
     WHERE ewp.seq IS NOT NULL ${mergedFilter}
     GROUP BY ewp.episode_id
     HAVING MIN(ewp.seq) <> 0
        OR MAX(ewp.seq) <> COUNT(*) - 1
        OR COUNT(DISTINCT ewp.seq) <> COUNT(*)
     ORDER BY ewp.episode_id
     LIMIT $1`,
    [limit]
  );
  return { total: Number(totalRes.rows[0]?.cnt ?? 0), sample: sample.rows };
}

export async function buildBookingConsistencyReport(
  pool: Pool,
  options: { sampleLimit?: number; statementTimeoutMs?: number } = {}
): Promise<BookingConsistencyReport> {
  const sampleLimit = Math.min(Math.max(options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT, 1), 200);
  // Hard cap so a slow probe can never hold a connection in production.
  // The default of 5s is comfortably above the local p95 for these queries
  // but small enough to fail fast if an index is missing.
  const statementTimeoutMs = Math.max(options.statementTimeoutMs ?? 5000, 100);
  const db = pool as unknown as Queryable;
  await db.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`).catch(() => {
    // SET LOCAL only works inside a tx; outside a tx pg silently sets the
    // session-level timeout instead. Either way we tried.
  });

  // Optional column probes (legacy DBs might miss them).
  const ewpHasMerged = await db
    .query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'episode_work_phases'
           AND column_name = 'merged_into_episode_work_phase_id'
       ) AS exists`
    )
    .then((r) => r.rows[0]?.exists === true)
    .catch(() => false);

  const ewpHasSeq = await db
    .query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'episode_work_phases'
           AND column_name = 'seq'
       ) AS exists`
    )
    .then((r) => r.rows[0]?.exists === true)
    .catch(() => false);

  const slotIntentsAvailable = await tableExists(db, 'slot_intents');

  const checks: BookingConsistencyCheckResult[] = [];

  const probe1 = await safeProbe(
    'phase_pending_with_active_appointment',
    () => checkPhasePendingWithActiveAppointment(db, sampleLimit),
    { total: 0, sample: [] }
  );
  checks.push({
    id: 'phase_pending_with_active_appointment',
    description: 'Munkafázis pending/scheduled, de már aktív appointment van rá.',
    available: !probe1.error,
    total: probe1.value.total,
    sample: probe1.value.sample,
    notes: probe1.error,
  });

  const probe2 = await safeProbe(
    'phase_appointment_id_dangling',
    () => checkPhaseAppointmentIdDangling(db, sampleLimit),
    { total: 0, sample: [] }
  );
  checks.push({
    id: 'phase_appointment_id_dangling',
    description: 'episode_work_phases.appointment_id eltűnt vagy cancelled appointmentre mutat.',
    available: !probe2.error,
    total: probe2.value.total,
    sample: probe2.value.sample,
    notes: probe2.error,
  });

  const probe3 = await safeProbe(
    'appointment_for_step_but_phase_not_booked',
    () => checkAppointmentExistsButPhaseNotBooked(db, sampleLimit),
    { total: 0, sample: [] }
  );
  checks.push({
    id: 'appointment_for_step_but_phase_not_booked',
    description: 'Aktív appointment van a lépéshez, de a work phase nincs scheduled/completed státuszban.',
    available: !probe3.error,
    total: probe3.value.total,
    sample: probe3.value.sample,
    notes: probe3.error,
  });

  if (slotIntentsAvailable) {
    const probe4 = await safeProbe(
      'open_intent_with_active_appointment',
      () => checkOpenIntentWithActiveAppointment(db, sampleLimit),
      { total: 0, sample: [] }
    );
    checks.push({
      id: 'open_intent_with_active_appointment',
      description: 'Open slot_intent maradt, miközben már van aktív appointment a step-re.',
      available: !probe4.error,
      total: probe4.value.total,
      sample: probe4.value.sample,
      notes: probe4.error,
    });
  } else {
    checks.push({
      id: 'open_intent_with_active_appointment',
      description: 'Open slot_intent maradt, miközben már van aktív appointment a step-re.',
      available: false,
      total: 0,
      sample: [],
      notes: 'slot_intents tábla nem található',
    });
  }

  const probe5 = await safeProbe(
    'duplicate_step_code_in_episode',
    () => checkDuplicateStepCodeInEpisode(db, sampleLimit, ewpHasMerged),
    { total: 0, sample: [] }
  );
  checks.push({
    id: 'duplicate_step_code_in_episode',
    description: 'Ugyanaz a (episode_id, work_phase_code) többször a phase táblában.',
    available: !probe5.error,
    total: probe5.value.total,
    sample: probe5.value.sample,
    notes: probe5.error,
  });

  const probe6 = await safeProbe(
    'step_seq_drift',
    () => checkStepSeqDrift(db, sampleLimit, ewpHasSeq, ewpHasMerged),
    { total: 0, sample: [] }
  );
  checks.push({
    id: 'step_seq_drift',
    description: 'episode_work_phases.seq nem összefüggő 0..N-1 (gap vagy duplikált seq).',
    available: !probe6.error && ewpHasSeq,
    total: probe6.value.total,
    sample: probe6.value.sample,
    notes: !ewpHasSeq ? 'episode_work_phases.seq oszlop hiányzik' : probe6.error,
  });

  const probe7 = await safeProbe(
    'unknown_appointment_status_value',
    () => checkUnknownAppointmentStatusValue(db, sampleLimit),
    { total: 0, sample: [] }
  );
  checks.push({
    id: 'unknown_appointment_status_value',
    description:
      `appointments.appointment_status érték a kanonikus taxonómián kívül (engedélyezett: NULL, ${APPOINTMENT_STATUS_VALUES.join(', ')}).`,
    available: !probe7.error,
    total: probe7.value.total,
    sample: probe7.value.sample,
    notes: probe7.error,
  });

  const probe8a = await safeProbe(
    'slot_state_appointment_drift_free_with_active',
    () => checkSlotStateAppointmentDriftFreeWithActive(db, sampleLimit),
    { total: 0, sample: [] }
  );
  checks.push({
    id: 'slot_state_appointment_drift_free_with_active',
    description:
      'available_time_slots.state = "free" DE aktív appointment row van rá. Ez okozza a bulk-convert SLOT_ALREADY_BOOKED hibát: a picker visszaadja a slotot, az UPSERT (helyesen) nem írja felül az élő foglalást.',
    available: !probe8a.error,
    total: probe8a.value.total,
    sample: probe8a.value.sample,
    notes: probe8a.error,
  });

  const probe8b = await safeProbe(
    'slot_state_appointment_drift_booked_without_active',
    () => checkSlotStateAppointmentDriftBookedWithoutActive(db, sampleLimit),
    { total: 0, sample: [] }
  );
  checks.push({
    id: 'slot_state_appointment_drift_booked_without_active',
    description:
      'available_time_slots.state = "booked" DE NINCS aktív appointment row a sloton (frozen slot: senki sem tudja újra lefoglalni, mert a picker state="free" szűrője kihagyja).',
    available: !probe8b.error,
    total: probe8b.value.total,
    sample: probe8b.value.sample,
    notes: probe8b.error,
  });

  return {
    generatedAt: new Date().toISOString(),
    sampleLimit,
    checks,
  };
}
