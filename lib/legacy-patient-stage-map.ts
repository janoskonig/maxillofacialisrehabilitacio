/** Egyesített GET válaszban a régi patient_stages sorok ID előtagja — nem stage_events PK. */
export const LEGACY_MERGED_STAGE_EVENT_ID_PREFIX = 'legacy-ps:';

/** Régi patient_stages.stage → univerzális stage_code (mindhárom etiológiánál). */
export const LEGACY_PATIENT_STAGE_TO_CODE: Record<string, string> = {
  uj_beteg: 'STAGE_0',
  onkologiai_kezeles_kesz: 'STAGE_0',
  arajanlatra_var: 'STAGE_2',
  implantacios_sebeszi_tervezesre_var: 'STAGE_2',
  fogpotlasra_var: 'STAGE_5',
  fogpotlas_keszul: 'STAGE_5',
  fogpotlas_kesz: 'STAGE_6',
  gondozas_alatt: 'STAGE_7',
};

export function legacyPatientStageToCode(stage: string): string {
  return LEGACY_PATIENT_STAGE_TO_CODE[stage] ?? 'STAGE_0';
}
