import { getDbPool } from './db';

let _hasCustomLabel: boolean | null = null;
let _hasToothTreatmentId: boolean | null = null;
let _hasMergedInto: boolean | null = null;

async function checkColumn(pool: ReturnType<typeof getDbPool>, col: string): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'episode_steps' AND column_name = $1 LIMIT 1`,
      [col]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

export async function getStepSelectColumns(pool: ReturnType<typeof getDbPool>): Promise<string> {
  if (_hasCustomLabel === null) _hasCustomLabel = await checkColumn(pool, 'custom_label');
  if (_hasToothTreatmentId === null) _hasToothTreatmentId = await checkColumn(pool, 'tooth_treatment_id');
  if (_hasMergedInto === null) _hasMergedInto = await checkColumn(pool, 'merged_into_episode_step_id');

  let cols = `es.id, es.episode_id as "episodeId", es.step_code as "stepCode",
    es.pathway_order_index as "pathwayOrderIndex", es.pool,
    es.duration_minutes as "durationMinutes",
    es.default_days_offset as "defaultDaysOffset", es.status,
    es.appointment_id as "appointmentId", es.created_at as "createdAt",
    es.completed_at as "completedAt",
    es.source_episode_pathway_id as "sourceEpisodePathwayId", es.seq`;

  if (_hasCustomLabel) cols += `, es.custom_label as "customLabel"`;
  if (_hasToothTreatmentId) cols += `, es.tooth_treatment_id as "toothTreatmentId"`;
  if (_hasMergedInto) cols += `, es.merged_into_episode_step_id as "mergedIntoStepId"`;

  return cols;
}

export function getToothTreatmentJoin(): string {
  if (!_hasToothTreatmentId) return '';
  return `LEFT JOIN tooth_treatments tt ON es.tooth_treatment_id = tt.id
    LEFT JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code`;
}

export function getToothTreatmentSelectCols(): string {
  if (!_hasToothTreatmentId) return '';
  return `, tt.tooth_number as "toothNumber", ttc.label_hu as "treatmentLabel"`;
}

export async function getFullStepQuery(pool: ReturnType<typeof getDbPool>, episodeId: string) {
  const cols = await getStepSelectColumns(pool);
  const ttJoin = getToothTreatmentJoin();
  const ttCols = getToothTreatmentSelectCols();

  return pool.query(
    `SELECT ${cols}${ttCols}
     FROM episode_steps es
     ${ttJoin}
     WHERE es.episode_id = $1
     ORDER BY COALESCE(es.seq, es.pathway_order_index)`,
    [episodeId]
  );
}

export function resetColumnCache() {
  _hasCustomLabel = null;
  _hasToothTreatmentId = null;
  _hasMergedInto = null;
}
