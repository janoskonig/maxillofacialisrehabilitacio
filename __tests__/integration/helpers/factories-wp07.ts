import { randomUUID } from 'crypto';
import { getDbPool } from '@/lib/db';
import type { Queryable } from './db';

/**
 * WP-0.7 (olvasás/írás szétválasztása + törlés-tombstone) factory-k:
 * valódi sablon-JSON-nal bíró care_pathway, fogkezelés-katalógus bejegyzés és
 * fogkezelési igény (tooth_treatments) létrehozása.
 *
 * Külön fájl, hogy a párhuzamos WP-branchek ne ütközzenek a közös
 * factories.ts-en. Izolációs minta ugyanaz: client-tel hívva a withRollback
 * takarít, pool-lal hívva a cleanupCreatedWp07()-et kell afterEach-be tenni.
 */

type CreatedRow = { table: string; keyColumn: string; key: string };
const created: CreatedRow[] = [];

function track(table: string, key: string, db?: Queryable, keyColumn = 'id'): void {
  if (db) return;
  created.push({ table, keyColumn, key });
}

function q(db?: Queryable): Queryable {
  return db ?? getDbPool();
}

/**
 * Commitolt teszt-adatok törlése fordított sorrendben (afterEach-be).
 * A care_pathways-re RESTRICT FK mutat az episode_pathways-ből (és a generate
 * bootstrap útja trackeletlen episode_pathways sort szúr be), ezért a sablon
 * törlése előtt az arra hivatkozó episode_pathways sorokat is töröljük.
 */
export async function cleanupCreatedWp07(): Promise<void> {
  const pool = getDbPool();
  for (const row of [...created].reverse()) {
    if (row.table === 'care_pathways') {
      await pool.query(`DELETE FROM episode_pathways WHERE care_pathway_id = $1`, [row.key]);
      // patient_episodes.care_pathway_id FK-ja NO ACTION — a hivatkozást el
      // kell engedni, mielőtt a sablon törölhető (az epizódot a közös
      // cleanupCreated() takarítja, később).
      await pool.query(`UPDATE patient_episodes SET care_pathway_id = NULL WHERE care_pathway_id = $1`, [row.key]);
    }
    await pool.query(`DELETE FROM ${row.table} WHERE ${row.keyColumn} = $1`, [row.key]);
  }
  created.length = 0;
}

export interface Wp07TemplatePhase {
  work_phase_code: string;
  pool?: 'consult' | 'work' | 'control';
  duration_minutes?: number;
  default_days_offset?: number;
}

export async function createWp07TreatmentType(db?: Queryable): Promise<{ id: string; code: string }> {
  const code = `integ-wp07-${randomUUID().slice(0, 8)}`;
  const { rows } = await q(db).query(
    `INSERT INTO treatment_types (code, label_hu) VALUES ($1, 'WP-0.7 integrációs kezeléstípus')
     RETURNING id, code`,
    [code]
  );
  track('treatment_types', rows[0].id, db);
  return rows[0];
}

/** Sablon valódi work_phases_json tartalommal. */
export async function createWp07CarePathway(
  db: Queryable | undefined,
  treatmentTypeId: string,
  overrides: { name?: string; workPhases?: Wp07TemplatePhase[] } = {}
): Promise<{ id: string }> {
  const workPhases: Wp07TemplatePhase[] = overrides.workPhases ?? [
    { work_phase_code: 'konzultacio', pool: 'consult', duration_minutes: 20, default_days_offset: 0 },
    { work_phase_code: 'lenyomat', pool: 'work', duration_minutes: 45, default_days_offset: 7 },
    { work_phase_code: 'atadas', pool: 'work', duration_minutes: 30, default_days_offset: 14 },
  ];
  const { rows } = await q(db).query(
    `INSERT INTO care_pathways (name, treatment_type_id, work_phases_json)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [overrides.name ?? 'WP-0.7 integrációs sablon', treatmentTypeId, JSON.stringify(workPhases)]
  );
  track('care_pathways', rows[0].id, db);
  return rows[0];
}

/** Fogkezelés-katalógus bejegyzés (a pillanatkép séma-only, seed nélkül). */
export async function createWp07ToothTreatmentCatalogEntry(
  db?: Queryable,
  overrides: { code?: string; labelHu?: string } = {}
): Promise<{ code: string; labelHu: string }> {
  const code = overrides.code ?? `wp07_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
  const labelHu = overrides.labelHu ?? 'WP-0.7 teszt fogkezelés';
  await q(db).query(
    `INSERT INTO tooth_treatment_catalog (code, label_hu, sort_order) VALUES ($1, $2, 999)`,
    [code, labelHu]
  );
  track('tooth_treatment_catalog', code, db, 'code');
  return { code, labelHu };
}

/** Epizódhoz kötött fogkezelési igény. */
export async function createWp07ToothTreatment(
  db: Queryable | undefined,
  patientId: string,
  episodeId: string,
  treatmentCode: string,
  overrides: {
    toothNumber?: number;
    status?: 'pending' | 'episode_linked' | 'completed';
  } = {}
): Promise<{ id: string; status: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO tooth_treatments (patient_id, episode_id, tooth_number, treatment_code, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, status`,
    [
      patientId,
      episodeId,
      overrides.toothNumber ?? 11,
      treatmentCode,
      overrides.status ?? 'episode_linked',
    ]
  );
  track('tooth_treatments', rows[0].id, db);
  return rows[0];
}
