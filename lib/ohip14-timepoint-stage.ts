import type { OHIP14Timepoint } from './types';

/**
 * Új modell (stage_events): melyik stage_code-nál melyik OHIP timepoint kitölthető.
 * T0 = első konzultáció, T1 = rehabilitáció előtt (protetikai fázis előtt), T2 = gondozás.
 */
export const OHIP_TIMEPOINT_STAGE_CODES: Record<OHIP14Timepoint, string> = {
  T0: 'STAGE_0',
  T1: 'STAGE_4',
  T2: 'STAGE_7',
};

/** Régi modell: timepoint → patient_stages.stage érték */
export const LEGACY_OHIP_TIMEPOINT_STAGES: Record<OHIP14Timepoint, string> = {
  T0: 'uj_beteg',
  T1: 'onkologiai_kezeles_kesz',
  T2: 'gondozas_alatt',
};

/**
 * Megadott timepoint kitölthető-e a jelenlegi stádiummal (új: stage_code, régi: stage string).
 * Kliens és szerver egyaránt használhatja (nincs pg függőség).
 */
export function isTimepointAllowedForStage(
  timepoint: OHIP14Timepoint,
  stageCodeOrLegacyStage: string | null,
  useNewModel: boolean
): boolean {
  if (!stageCodeOrLegacyStage) return false;
  if (useNewModel) {
    return OHIP_TIMEPOINT_STAGE_CODES[timepoint] === stageCodeOrLegacyStage;
  }
  return LEGACY_OHIP_TIMEPOINT_STAGES[timepoint] === stageCodeOrLegacyStage;
}

/** Aktuális stádiumhoz tartozó timepoint (ha van), null egyébként */
export function getTimepointForStage(
  stageCodeOrLegacyStage: string | null,
  useNewModel: boolean
): OHIP14Timepoint | null {
  if (!stageCodeOrLegacyStage) return null;
  const timepoints = ['T0', 'T1', 'T2'] as const;
  if (useNewModel) {
    const found = timepoints.find((tp) => OHIP_TIMEPOINT_STAGE_CODES[tp] === stageCodeOrLegacyStage);
    return found ?? null;
  }
  const found = timepoints.find((tp) => LEGACY_OHIP_TIMEPOINT_STAGES[tp] === stageCodeOrLegacyStage);
  return found ?? null;
}
