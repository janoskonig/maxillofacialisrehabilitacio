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
    if (!episodeId) {
      return { episodeId: null, stageCode: null, stage: null, useNewModel: true };
    }
    const row = await pool.query(
      `SELECT stage_code FROM stage_events WHERE patient_id = $1 AND episode_id = $2 ORDER BY at DESC LIMIT 1`,
      [patientId, episodeId]
    );
    const stageCode = row.rows[0]?.stage_code ?? null;
    return { episodeId, stageCode, stage: null, useNewModel: true };
  }

  const legacy = await pool.query(
    `SELECT episode_id, stage FROM patient_current_stage WHERE patient_id = $1`,
    [patientId]
  );
  if (legacy.rows.length === 0) {
    return { episodeId: null, stageCode: null, stage: null, useNewModel: false };
  }
  const stage = legacy.rows[0].stage as string;
  const episodeId = legacy.rows[0].episode_id ?? null;
  const stageCode = LEGACY_STAGE_TO_CODE[stage] ?? 'STAGE_0';
  return { episodeId, stageCode, stage, useNewModel: false };
}

/** Szerver oldali wrapper a tiszta függvényre */
export function isTimepointAllowedForStage(
  timepoint: OHIP14Timepoint,
  stageCodeOrLegacyStage: string | null,
  useNewModel: boolean
): boolean {
  return isTimepointAllowedForStagePure(timepoint, stageCodeOrLegacyStage, useNewModel);
}

/**
 * Visszaadja a beteg aktuális stádium kódját (STAGE_0..STAGE_7).
 * Új modell: stage_events (onkológiai, traumás, veleszületett egyaránt).
 * Régi modell: patient_stages → megfeleltetés STAGE_*-ra.
 * @param episodeId opcionális; ha nincs megadva, az aktív (open) epizódot használja
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

  // Legacy: patient_stages / patient_current_stage
  const legacy = await pool.query(
    `SELECT stage FROM patient_current_stage WHERE patient_id = $1`,
    [patientId]
  );
  const legacyStage = legacy.rows[0]?.stage as string | undefined;
  if (!legacyStage) return null;
  return LEGACY_STAGE_TO_CODE[legacyStage] ?? 'STAGE_0';
}
