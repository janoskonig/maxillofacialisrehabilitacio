import { getDbPool } from './db';

/** SQL column list for episode_work_phases rows (API camelCase aliases). */
export const EPISODE_WORK_PHASE_SELECT_COLUMNS = `ewp.id, ewp.episode_id as "episodeId", ewp.work_phase_code as "workPhaseCode",
    ewp.pathway_order_index as "pathwayOrderIndex", ewp.pool,
    ewp.duration_minutes as "durationMinutes",
    ewp.default_days_offset as "defaultDaysOffset", ewp.status,
    ewp.appointment_id as "appointmentId", ewp.created_at as "createdAt",
    ewp.completed_at as "completedAt",
    ewp.source_episode_pathway_id as "sourceEpisodePathwayId", ewp.seq,
    ewp.custom_label as "customLabel",
    ewp.tooth_treatment_id as "toothTreatmentId",
    ewp.merged_into_episode_work_phase_id as "mergedIntoWorkPhaseId"`;

export function getToothTreatmentJoin(): string {
  return `LEFT JOIN tooth_treatments tt ON ewp.tooth_treatment_id = tt.id
    LEFT JOIN tooth_treatment_catalog ttc ON tt.treatment_code = ttc.code`;
}

export function getToothTreatmentSelectCols(): string {
  return `, tt.tooth_number as "toothNumber", ttc.label_hu as "treatmentLabel"`;
}

export async function getFullWorkPhaseQuery(pool: ReturnType<typeof getDbPool>, episodeId: string) {
  const ttJoin = getToothTreatmentJoin();
  const ttCols = getToothTreatmentSelectCols();

  return pool.query(
    `SELECT ${EPISODE_WORK_PHASE_SELECT_COLUMNS}${ttCols}
     FROM episode_work_phases ewp
     ${ttJoin}
     WHERE ewp.episode_id = $1
     ORDER BY COALESCE(ewp.seq, ewp.pathway_order_index)`,
    [episodeId]
  );
}
