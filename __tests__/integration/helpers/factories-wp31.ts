import { getDbPool } from '@/lib/db';
import type { Queryable } from './db';

/**
 * WP-3.1/3.2 (gondozás/recall) factory-k: stádium-esemény (STAGE_6 az
 * auto-generálás kapuja) és közvetlen recall-sor beszúrás.
 *
 * Külön fájl, hogy a párhuzamos WP-branchek ne ütközzenek a közös
 * factories.ts-en. Izolációs minta ugyanaz: client-tel hívva a withRollback
 * takarít, pool-lal hívva a cleanupCreatedWp31()-et kell afterEach-be tenni.
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
export async function cleanupCreatedWp31(): Promise<void> {
  const pool = getDbPool();
  for (const row of [...created].reverse()) {
    await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
  }
  created.length = 0;
}

export async function createTestStageEvent(
  db: Queryable | undefined,
  args: {
    patientId: string;
    episodeId: string;
    stageCode?: string;
    at?: Date;
  }
): Promise<{ id: string; stage_code: string; at: Date }> {
  const { rows } = await q(db).query(
    `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, created_by)
     VALUES ($1, $2, $3, $4, 'integration-teszt@integration.local')
     RETURNING id, stage_code, at`,
    [
      args.patientId,
      args.episodeId,
      args.stageCode ?? 'STAGE_6',
      args.at ?? new Date(),
    ]
  );
  track('stage_events', rows[0].id, db);
  return rows[0];
}

/** Közvetlen recall-sor beszúrás (pl. kézi sor előkészítése route nélkül). */
export async function createTestRecallTask(
  db: Queryable | undefined,
  args: {
    episodeId: string;
    intervalDays: number;
    dueAt?: Date;
    source?: 'auto' | 'manual';
    label?: string | null;
    createdBy?: string | null;
    completedAt?: Date | null;
    appointmentId?: string | null;
  }
): Promise<{ id: string; recall_interval_days: number; source: string }> {
  const { rows } = await q(db).query(
    `INSERT INTO episode_tasks
       (episode_id, task_type, due_at, recall_interval_days, source, label, created_by, completed_at, appointment_id)
     VALUES ($1, 'recall_due', $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, recall_interval_days, source`,
    [
      args.episodeId,
      args.dueAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      args.intervalDays,
      args.source ?? 'manual',
      args.label ?? null,
      args.createdBy ?? null,
      args.completedAt ?? null,
      args.appointmentId ?? null,
    ]
  );
  track('episode_tasks', rows[0].id, db);
  return rows[0];
}

/**
 * Az ensure/route által létrehozott (nem factory-s) recall-sorok begyűjtése a
 * cleanup-listába, hogy az afterEach őket is törölje.
 */
export async function trackEpisodeRecallTasksForCleanup(episodeId: string): Promise<void> {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `SELECT id FROM episode_tasks WHERE episode_id = $1 AND task_type = 'recall_due'`,
    [episodeId]
  );
  for (const row of rows) {
    if (!created.some((c) => c.table === 'episode_tasks' && c.id === row.id)) {
      created.push({ table: 'episode_tasks', id: row.id });
    }
  }
}
