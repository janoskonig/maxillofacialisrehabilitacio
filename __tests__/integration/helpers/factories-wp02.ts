import { randomUUID } from 'crypto';
import { getDbPool } from '@/lib/db';
import type { Queryable } from './db';

/**
 * WP-0.2 factory-k — a közös factories.ts-től KÜLÖN fájlban, hogy a
 * párhuzamos WP-branchek ne ütközzenek rajta (docs/INTEGRATION_TESTS.md).
 *
 * Ugyanaz a két izolációs minta érvényes, mint a közös factory-knál:
 *  - withRollback-en belül: add át a clientet db-ként — a rollback takarít;
 *  - route-handleres tesztben: hívd db nélkül (pool), és afterEach-ben hívd
 *    a cleanupCreatedWp02()-t — a közös cleanupCreated() UTÁN, mert a
 *    care_pathways-ra a patient_episodes.care_pathway_id FK mutat.
 */

type CreatedRow = { table: string; id: string };
const created: CreatedRow[] = [];

function track(table: string, id: string, db?: Queryable): void {
  if (db) return;
  created.push({ table, id });
}

function q(db?: Queryable): Queryable {
  return db ?? getDbPool();
}

/** A WP-0.2 factory-k által commitolt sorok törlése fordított sorrendben. */
export async function cleanupCreatedWp02(): Promise<void> {
  const pool = getDbPool();
  for (const row of [...created].reverse()) {
    await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
  }
  created.length = 0;
}

export interface TestPathwayWorkPhase {
  work_phase_code: string;
  pool: 'consult' | 'work' | 'control';
  duration_minutes: number;
  default_days_offset: number;
}

/**
 * Kezelési útvonal sablon a projektorhoz (work_phases_json).
 * A care_pathways CHECK-je miatt `reason`-t adunk (XOR treatment_type_id).
 */
export async function createTestCarePathway(
  db: Queryable | undefined,
  workPhases: TestPathwayWorkPhase[],
  overrides: { name?: string } = {}
): Promise<{ id: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO care_pathways (name, reason, work_phases_json)
     VALUES ($1, 'traumás sérülés', $2::jsonb)
     RETURNING id`,
    [
      overrides.name ?? `WP02 teszt-sablon ${randomUUID().slice(0, 8)}`,
      JSON.stringify(workPhases),
    ]
  );
  track('care_pathways', rows[0].id, db);
  return rows[0];
}
