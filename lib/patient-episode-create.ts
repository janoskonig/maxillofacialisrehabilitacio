import type { Pool } from 'pg';
import type { PatientEpisode } from '@/lib/types';
import { logger } from '@/lib/logger';
import { recomputeKezeleoorvosSilent } from '@/lib/recompute-kezeleoorvos';

export const EPISODE_REASON_VALUES = [
  'traumás sérülés',
  'veleszületett rendellenesség',
  'onkológiai kezelés utáni állapot',
] as const;

function rowToEpisode(row: Record<string, unknown>): PatientEpisode {
  return {
    id: row.id as string,
    patientId: row.patientId as string,
    reason: row.reason as PatientEpisode['reason'],
    pathwayCode: (row.pathwayCode as string) || null,
    chiefComplaint: row.chiefComplaint as string,
    caseTitle: (row.caseTitle as string) || null,
    status: row.status as PatientEpisode['status'],
    openedAt: (row.openedAt as Date)?.toISOString?.() ?? String(row.openedAt),
    closedAt: (row.closedAt as Date)?.toISOString?.() ?? (row.closedAt as string) ?? null,
    parentEpisodeId: (row.parentEpisodeId as string) || null,
    triggerType: (row.triggerType as PatientEpisode['triggerType']) || null,
    createdAt: (row.createdAt as Date)?.toISOString?.() ?? null,
    createdBy: (row.createdBy as string) || null,
    carePathwayId: (row.carePathwayId as string) || null,
    assignedProviderId: (row.assignedProviderId as string) || null,
    carePathwayName: (row.carePathwayName as string) || null,
    assignedProviderName: (row.assignedProviderName as string) || null,
    treatmentTypeId: (row.treatmentTypeId as string) || null,
    treatmentTypeCode: (row.treatmentTypeCode as string) || null,
    treatmentTypeLabel: (row.treatmentTypeLabel as string) || null,
  };
}

export type CreateOpenEpisodeInput = {
  patientId: string;
  reason: string;
  chiefComplaint: string;
  caseTitle: string | null;
  parentEpisodeId: string | null;
  triggerType: string | null;
  treatmentTypeId: string | null;
  createdBy: string;
};

/**
 * Egy nyitott epizód létrehozása: meglévő nyitottak lezárása, INSERT patient_episodes, opcionálisan STAGE_0 stage_events.
 */
export async function createOpenEpisodeWithInitialStageZero(
  pool: Pool,
  input: CreateOpenEpisodeInput,
): Promise<PatientEpisode> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM patients WHERE id = $1 FOR UPDATE`, [input.patientId]);

    const closingResult = await client.query(
      `SELECT id FROM patient_episodes WHERE patient_id = $1 AND status = 'open'`,
      [input.patientId],
    );
    const closingIds = closingResult.rows.map((r: { id: string }) => r.id);
    if (closingIds.length > 0) {
      try {
        const { invalidateIntentsForEpisodes } = await import('@/lib/intent-invalidation');
        await invalidateIntentsForEpisodes(closingIds, 'episode_closed');
      } catch (e) {
        logger.error('Failed to invalidate intents for closed episodes:', e);
      }
    }
    await client.query(
      `UPDATE patient_episodes SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE patient_id = $1 AND status = 'open'`,
      [input.patientId],
    );

    const insertResult = await client.query(
      `INSERT INTO patient_episodes (
        patient_id, reason, chief_complaint, case_title, status, opened_at, parent_episode_id, trigger_type, treatment_type_id, created_by
      ) VALUES ($1, $2, $3, $4, 'open', CURRENT_TIMESTAMP, $5, $6, $7, $8)
      RETURNING id`,
      [
        input.patientId,
        input.reason,
        input.chiefComplaint,
        input.caseTitle,
        input.parentEpisodeId,
        input.triggerType,
        input.treatmentTypeId || null,
        input.createdBy,
      ],
    );

    const newId = insertResult.rows[0]?.id as string | undefined;
    if (!newId) {
      await client.query('ROLLBACK');
      throw new Error('Epizód létrehozása sikertelen');
    }

    const fetchResult = await client.query(
      `SELECT pe.id, pe.patient_id as "patientId", pe.reason, pe.pathway_code as "pathwayCode",
        pe.chief_complaint as "chiefComplaint", pe.case_title as "caseTitle", pe.status,
        pe.opened_at as "openedAt", pe.closed_at as "closedAt", pe.parent_episode_id as "parentEpisodeId",
        pe.trigger_type as "triggerType", pe.created_at as "createdAt", pe.created_by as "createdBy",
        pe.care_pathway_id as "carePathwayId", pe.assigned_provider_id as "assignedProviderId",
        pe.treatment_type_id as "treatmentTypeId", cp.name as "carePathwayName",
        COALESCE(u.doktor_neve, u.email) as "assignedProviderName",
        tt.code as "treatmentTypeCode", tt.label_hu as "treatmentTypeLabel"
       FROM patient_episodes pe
       LEFT JOIN care_pathways cp ON pe.care_pathway_id = cp.id
       LEFT JOIN users u ON pe.assigned_provider_id = u.id
       LEFT JOIN treatment_types tt ON pe.treatment_type_id = tt.id
       WHERE pe.id = $1`,
      [newId],
    );
    const row = fetchResult.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      throw new Error('Epizód létrehozása sikertelen');
    }
    const episode = rowToEpisode(row);

    const stageEventsExists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`,
    );
    if (stageEventsExists.rows.length > 0) {
      await client.query(
        `INSERT INTO stage_events (patient_id, episode_id, stage_code, at, created_by) VALUES ($1, $2, 'STAGE_0', CURRENT_TIMESTAMP, $3)`,
        [input.patientId, episode.id, input.createdBy],
      );
    }

    await client.query('COMMIT');

    // Új epizód létrehozása lezárja a korábbi nyitottakat → a `kezeleoorvos`
    // korábban érvényes B-eset jelölése elavulhatott. Az új epizódhoz
    // még nincs `assigned_provider_id` (PATCH /api/episodes/:id-vel állítható
    // be később), úgyhogy a recompute jó eséllyel A-esetre vagy „ne vonja
    // vissza" no-opra fut. Fire-and-forget — a hiba ne ölje meg a fő flow-t.
    recomputeKezeleoorvosSilent(input.patientId);

    return episode;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
