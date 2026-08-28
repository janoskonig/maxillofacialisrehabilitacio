import { getDbPool } from '@/lib/db';
import type { Queryable } from './db';

/**
 * WP-4.1a factory-k (vizit-séma) — külön fájlban, hogy a párhuzamos
 * WP-branchek ne ütközzenek a közös factories.ts-en.
 */

type CreatedRow = { table: string; id: string };
const created: CreatedRow[] = [];

function track(table: string, id: string, db?: Queryable): void {
  if (db) return; // withRollback-en belül a ROLLBACK takarít
  created.push({ table, id });
}

function q(db?: Queryable): Queryable {
  return db ?? getDbPool();
}

/** Commitolt WP-4.1a teszt-adatok törlése (afterEach-be, a közös cleanup elé). */
export async function cleanupCreatedWp41a(): Promise<void> {
  const pool = getDbPool();
  for (const row of [...created].reverse()) {
    await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
  }
  created.length = 0;
}

/**
 * EWP sor vizit-releváns mezőkkel: merged_into, default_days_offset, visit_id.
 * A visit_id alapból NULL — a backfill-tesztek pont a vizit nélküli (történelmi)
 * sorokat modellezik vele.
 */
export async function createWp41aWorkPhase(
  db: Queryable | undefined,
  episodeId: string,
  overrides: {
    workPhaseCode?: string;
    seq?: number | null;
    pathwayOrderIndex?: number;
    pool?: 'consult' | 'work' | 'control';
    durationMinutes?: number;
    defaultDaysOffset?: number;
    status?: 'pending' | 'scheduled' | 'completed' | 'skipped';
    mergedInto?: string | null;
    visitId?: string | null;
    customLabel?: string | null;
  } = {}
): Promise<{ id: string; work_phase_code: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO episode_work_phases
       (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes,
        default_days_offset, status, seq, merged_into_episode_work_phase_id,
        visit_id, custom_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, work_phase_code`,
    [
      episodeId,
      overrides.workPhaseCode ?? 'lenyomat',
      overrides.pathwayOrderIndex ?? overrides.seq ?? 0,
      overrides.pool ?? 'work',
      overrides.durationMinutes ?? 30,
      overrides.defaultDaysOffset ?? 7,
      overrides.status ?? 'pending',
      overrides.seq ?? null,
      overrides.mergedInto ?? null,
      overrides.visitId ?? null,
      overrides.customLabel ?? null,
    ]
  );
  track('episode_work_phases', rows[0].id, db);
  return rows[0];
}

export type Wp41aVisitRow = {
  id: string;
  seq: number;
  label: string | null;
  days_offset: number | null;
  planned_duration_minutes: number | null;
};

/** Az epizód vizitjei seq-sorrendben (assertekhez). */
export async function listWp41aVisits(
  db: Queryable | undefined,
  episodeId: string
): Promise<Wp41aVisitRow[]> {
  const { rows } = await q(db).query(
    `SELECT id, seq, label, days_offset, planned_duration_minutes
     FROM episode_visits WHERE episode_id = $1 ORDER BY seq`,
    [episodeId]
  );
  return rows as Wp41aVisitRow[];
}

/** Egy EWP sor vizit-releváns mezői (assertekhez). */
export async function getWp41aPhaseRow(
  db: Queryable | undefined,
  workPhaseId: string
): Promise<{ id: string; visit_id: string | null; jaw: string | null } | null> {
  const { rows } = await q(db).query(
    `SELECT id, visit_id, jaw FROM episode_work_phases WHERE id = $1`,
    [workPhaseId]
  );
  return (rows[0] as { id: string; visit_id: string | null; jaw: string | null }) ?? null;
}
