import type { Pool } from 'pg';
import { LATEST_STAGE_SUBQUERY } from '@/lib/queries/episode-fragments';

export class EpisodeRepository {
  constructor(private pool: Pool) {}

  async findById(id: string) {
    const result = await this.pool.query(
      `SELECT id, patient_id as "patientId", reason, chief_complaint as "chiefComplaint",
              case_title as "caseTitle", status, opened_at as "openedAt",
              closed_at as "closedAt", parent_episode_id as "parentEpisodeId",
              trigger_type as "triggerType", care_pathway_id as "carePathwayId",
              assigned_provider_id as "assignedProviderId",
              stage_version as "stageVersion", snapshot_version as "snapshotVersion",
              created_at as "createdAt", created_by as "createdBy"
       FROM patient_episodes WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async findByPatientId(patientId: string) {
    const result = await this.pool.query(
      `SELECT pe.id, pe.patient_id as "patientId", pe.reason,
              pe.chief_complaint as "chiefComplaint", pe.case_title as "caseTitle",
              pe.status, pe.opened_at as "openedAt", pe.closed_at as "closedAt",
              pe.care_pathway_id as "carePathwayId",
              pe.assigned_provider_id as "assignedProviderId",
              se.stage_code as "currentStageCode",
              pe.created_at as "createdAt"
       FROM patient_episodes pe
       LEFT JOIN (${LATEST_STAGE_SUBQUERY}) se ON pe.id = se.episode_id
       WHERE pe.patient_id = $1
       ORDER BY pe.opened_at DESC`,
      [patientId]
    );
    return result.rows;
  }

  async getLatestStageCode(episodeId: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT stage_code FROM stage_events WHERE episode_id = $1 ORDER BY at DESC LIMIT 1`,
      [episodeId]
    );
    return result.rows[0]?.stage_code ?? null;
  }

  async countOpenWip(wipStageCodes: string[]): Promise<number> {
    const stageList = wipStageCodes.map(c => `'${c}'`).join(',');
    const result = await this.pool.query(
      `SELECT COUNT(*)::int as cnt FROM patient_episodes pe
       LEFT JOIN (${LATEST_STAGE_SUBQUERY}) se ON pe.id = se.episode_id
       WHERE pe.status = 'open' AND (se.stage_code IS NULL OR se.stage_code IN (${stageList}))`
    );
    return result.rows[0].cnt;
  }
}
