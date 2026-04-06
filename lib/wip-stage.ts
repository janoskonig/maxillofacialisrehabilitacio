/**
 * Shared WIP stage helper — single source of truth.
 * WIP = status='open' AND isWipStage(stage_code).
 * WIP stages: STAGE_1..STAGE_6 (not STAGE_0 pre-consult, not STAGE_7 control).
 */

export const WIP_STAGE_CODES = ['STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'STAGE_6'] as const;
const WIP_STAGES = new Set<string>(WIP_STAGE_CODES);

/**
 * Orvosi (fogpótlástanászi) terhelés számolásához: jelenleg STAGE_5 = protetikai fázis folyamatban.
 * Nem tartalmazza a konzultációs / sebészeti / átadás előtti egyéb stádiumokat.
 */
export const PROSTHETIC_WORKLOAD_STAGE_CODES = ['STAGE_5'] as const;

/** SQL IN-lista a protetikai terhelés stádiumaira (egyetlen idézőjelezett érték). */
export function prostheticWorkloadStagesInSql(): string {
  return PROSTHETIC_WORKLOAD_STAGE_CODES.map((c) => `'${c}'`).join(', ');
}

export function isWipStage(stage_code: string | null): boolean {
  return stage_code != null && WIP_STAGES.has(stage_code);
}
