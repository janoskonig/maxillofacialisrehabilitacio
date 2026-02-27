import type { Pool } from 'pg';
import type { OHIP14Timepoint } from './types';
import {
  isTimepointAllowedForStage as isTimepointAllowedForStagePure,
  OHIP_TIMEPOINT_STAGE_CODES,
  LEGACY_OHIP_TIMEPOINT_STAGES,
} from './ohip14-timepoint-stage';

export { OHIP_TIMEPOINT_STAGE_CODES, LEGACY_OHIP_TIMEPOINT_STAGES };

/** Régi patient_stages.stage → univerzális stage_code (mindhárom etiológiánál) */
const LEGACY_STAGE_TO_CODE: Record<string, string> = {
  uj_beteg: 'STAGE_0',
  onkologiai_kezeles_kesz: 'STAGE_0',
  arajanlatra_var: 'STAGE_2',
  implantacios_sebeszi_tervezesre_var: 'STAGE_2',
  fogpotlasra_var: 'STAGE_5',
  fogpotlas_keszul: 'STAGE_5',
  fogpotlas_kesz: 'STAGE_6',
  gondozas_alatt: 'STAGE_7',
};

export interface CurrentEpisodeAndStage {
  episodeId: string | null;
  stageCode: string | null;
  stage: string | null;
  useNewModel: boolean;
  deliveryDate: Date | null;
}

/**
 * Beteg aktuális epizódja és stádiuma (új modell: stage_events, régi: patient_current_stage).
 * OHIP és betegportál egyaránt ezt használja az epizód + engedélyezett timepoint meghatározásához.
 */
export async function getCurrentEpisodeAndStage(
  pool: Pool,
  patientId: string
): Promise<CurrentEpisodeAndStage> {
  const hasStageEvents = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`
  );

  if (hasStageEvents.rows.length > 0) {
    const openEp = await pool.query(
      `SELECT id FROM patient_episodes WHERE patient_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [patientId]
    );
    const episodeId = openEp.rows[0]?.id ?? null;
    if (episodeId) {
      const row = await pool.query(
        `SELECT stage_code FROM stage_events WHERE patient_id = $1 AND episode_id = $2 ORDER BY at DESC LIMIT 1`,
        [patientId, episodeId]
      );
      const stageCode = row.rows[0]?.stage_code ?? null;
      const deliveryDate = await getDeliveryDate(pool, patientId, episodeId);
      if (stageCode) {
        return { episodeId, stageCode, stage: null, useNewModel: true, deliveryDate };
      }
      return { episodeId, stageCode: null, stage: null, useNewModel: true, deliveryDate };
    }
  }

  const legacy = await pool.query(
    `SELECT episode_id, stage FROM patient_current_stage WHERE patient_id = $1`,
    [patientId]
  );
  if (legacy.rows.length === 0) {
    return { episodeId: null, stageCode: null, stage: null, useNewModel: false, deliveryDate: null };
  }
  const stage = legacy.rows[0].stage as string;
  const episodeId = legacy.rows[0].episode_id ?? null;
  const stageCode = LEGACY_STAGE_TO_CODE[stage] ?? 'STAGE_0';
  const deliveryDate = stage === 'fogpotlas_kesz' || stage === 'gondozas_alatt'
    ? await getDeliveryDateLegacy(pool, patientId)
    : null;
  return { episodeId, stageCode, stage, useNewModel: false, deliveryDate };
}

/** Szerver oldali wrapper a tiszta függvényre */
export function isTimepointAllowedForStage(
  timepoint: OHIP14Timepoint,
  stageCodeOrLegacyStage: string | null,
  useNewModel: boolean,
  deliveryDate: Date | null = null,
): boolean {
  return isTimepointAllowedForStagePure(timepoint, stageCodeOrLegacyStage, useNewModel, deliveryDate);
}

/**
 * Visszaadja a beteg aktuális stádium kódját (STAGE_0..STAGE_7).
 */
export async function getCurrentStageCodeForOhip(
  pool: Pool,
  patientId: string,
  episodeId: string | null
): Promise<string | null> {
  const hasStageEvents = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_events'`
  );

  if (hasStageEvents.rows.length > 0) {
    let targetEpisodeId = episodeId;
    if (!targetEpisodeId) {
      const openEp = await pool.query(
        `SELECT id FROM patient_episodes WHERE patient_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
        [patientId]
      );
      targetEpisodeId = openEp.rows[0]?.id ?? null;
    }
    if (!targetEpisodeId) return null;
    const row = await pool.query(
      `SELECT stage_code FROM stage_events WHERE patient_id = $1 AND episode_id = $2 ORDER BY at DESC LIMIT 1`,
      [patientId, targetEpisodeId]
    );
    return row.rows[0]?.stage_code ?? null;
  }

  const legacy = await pool.query(
    `SELECT stage FROM patient_current_stage WHERE patient_id = $1`,
    [patientId]
  );
  const legacyStage = legacy.rows[0]?.stage as string | undefined;
  if (!legacyStage) return null;
  return LEGACY_STAGE_TO_CODE[legacyStage] ?? 'STAGE_0';
}

/**
 * Return the delivery date (STAGE_6 event) for a patient episode.
 * New model: stage_events with stage_code = 'STAGE_6'.
 */
export async function getDeliveryDate(
  pool: Pool,
  patientId: string,
  episodeId: string | null,
): Promise<Date | null> {
  if (!episodeId) return null;
  try {
    const row = await pool.query(
      `SELECT at FROM stage_events
       WHERE patient_id = $1 AND episode_id = $2 AND stage_code = 'STAGE_6'
       ORDER BY at DESC LIMIT 1`,
      [patientId, episodeId]
    );
    return row.rows[0]?.at ?? null;
  } catch {
    return null;
  }
}

/**
 * Legacy fallback: try to approximate delivery date from patient_current_stage
 * when stage is fogpotlas_kesz or gondozas_alatt.
 */
async function getDeliveryDateLegacy(
  pool: Pool,
  patientId: string,
): Promise<Date | null> {
  try {
    const row = await pool.query(
      `SELECT stage_date FROM patient_current_stage WHERE patient_id = $1`,
      [patientId]
    );
    return row.rows[0]?.stage_date ?? null;
  } catch {
    return null;
  }
}
