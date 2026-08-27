import { randomUUID } from 'crypto';
import { getDbPool } from '@/lib/db';
import type { Queryable } from './db';

/**
 * WP-0.3 (audit tombstone) factory-k: sablon (care_pathway) és epizódra
 * alkalmazott sablon (episode_pathway) létrehozása, valamint sablonból
 * származó (source_episode_pathway_id-s) munkafázis.
 *
 * Külön fájl, hogy a párhuzamos WP-branchek ne ütközzenek a közös
 * factories.ts-en. Izolációs minta ugyanaz: client-tel hívva a withRollback
 * takarít, pool-lal hívva a cleanupCreatedWp03()-at kell afterEach-be tenni.
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

/** Commitolt teszt-adatok törlése fordított sorrendben (afterEach-be). */
export async function cleanupCreatedWp03(): Promise<void> {
  const pool = getDbPool();
  for (const row of [...created].reverse()) {
    await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
  }
  created.length = 0;
}

export async function createTestTreatmentType(
  db?: Queryable
): Promise<{ id: string; code: string }> {
  const code = `integ-wp03-${randomUUID().slice(0, 8)}`;
  const { rows } = await q(db).query(
    `INSERT INTO treatment_types (code, label_hu) VALUES ($1, 'WP-0.3 integrációs kezeléstípus')
     RETURNING id, code`,
    [code]
  );
  track('treatment_types', rows[0].id, db);
  return rows[0];
}

export async function createTestCarePathway(
  db: Queryable | undefined,
  treatmentTypeId: string,
  overrides: { name?: string } = {}
): Promise<{ id: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO care_pathways (name, treatment_type_id, work_phases_json)
     VALUES ($1, $2, '[]'::jsonb)
     RETURNING id`,
    [overrides.name ?? 'WP-0.3 integrációs sablon', treatmentTypeId]
  );
  track('care_pathways', rows[0].id, db);
  return rows[0];
}

export async function createTestEpisodePathway(
  db: Queryable | undefined,
  episodeId: string,
  carePathwayId: string,
  overrides: { ordinal?: number } = {}
): Promise<{ id: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO episode_pathways (episode_id, care_pathway_id, ordinal)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [episodeId, carePathwayId, overrides.ordinal ?? 0]
  );
  track('episode_pathways', rows[0].id, db);
  return rows[0];
}

/** Sablonból származó munkafázis (source_episode_pathway_id kitöltve). */
export async function createTestWorkPhaseFromPathway(
  db: Queryable | undefined,
  episodeId: string,
  episodePathwayId: string,
  overrides: {
    workPhaseCode?: string;
    seq?: number;
    pool?: 'consult' | 'work' | 'control';
    durationMinutes?: number;
    status?: 'pending' | 'scheduled' | 'completed' | 'skipped';
    customLabel?: string | null;
  } = {}
): Promise<{ id: string; work_phase_code: string; status: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO episode_work_phases
       (episode_id, work_phase_code, pathway_order_index, pool, duration_minutes,
        status, seq, custom_label, source_episode_pathway_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, work_phase_code, status`,
    [
      episodeId,
      overrides.workPhaseCode ?? 'lenyomat',
      overrides.seq ?? 0,
      overrides.pool ?? 'work',
      overrides.durationMinutes ?? 30,
      overrides.status ?? 'pending',
      overrides.seq ?? 0,
      overrides.customLabel ?? null,
      episodePathwayId,
    ]
  );
  track('episode_work_phases', rows[0].id, db);
  return rows[0];
}
