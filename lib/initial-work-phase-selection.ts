/**
 * Initial work-phase selection for pre-scheduling (slot intents) — pure, DB-free.
 *
 * Functional purpose: when an episode is activated the system pre-suggests the next
 * couple of *work* appointments to book. It must suggest the steps the doctor
 * actually planned — respecting steps they skipped or edited — not a fresh guess
 * from the pathway template.
 *
 * WP2 (safe slice): prefer the curated `episode_work_phases` (the plan's source of
 * truth, skip-aware) when they exist; fall back to the template-by-completed-count
 * heuristic only when no plan has been generated yet.
 */

export const DEFAULT_DURATION_MINUTES = 30;
export const DEFAULT_DAYS_OFFSET = 14;

export interface InitialWorkPhase {
  workPhaseCode: string;
  pool: 'work';
  durationMinutes: number;
  defaultDaysOffset: number;
  /** Stable identity used as slot_intents.step_seq (UNIQUE with episode_id + step_code). */
  stepSeq: number;
}

/** Minimal shape of a curated episode_work_phases row. */
export interface EpisodeWorkPhaseLite {
  workPhaseCode: string;
  pool: string | null;
  durationMinutes: number | null;
  defaultDaysOffset: number | null;
  status: string;
  pathwayOrderIndex: number;
}

/** Minimal shape of a pathway template phase. */
export interface PathwayPhaseLite {
  work_phase_code: string;
  pool: string;
  duration_minutes: number;
  default_days_offset: number;
}

function durationOrDefault(v: number | null | undefined): number {
  return typeof v === 'number' && v > 0 ? v : DEFAULT_DURATION_MINUTES;
}

function offsetOrDefault(v: number | null | undefined): number {
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_DAYS_OFFSET;
}

/**
 * SSOT path: the next `limit` *pending* work-pool steps from the curated plan, in
 * scheduling order. Skipped / completed / scheduled steps are ignored, so the
 * suggestions follow what the doctor actually left to do.
 */
export function selectInitialWorkPhasesFromSteps(
  steps: EpisodeWorkPhaseLite[],
  limit: number
): InitialWorkPhase[] {
  const out: InitialWorkPhase[] = [];
  for (const s of steps) {
    if (out.length >= limit) break;
    if (s.status !== 'pending') continue;
    if (s.pool !== 'work') continue;
    out.push({
      workPhaseCode: s.workPhaseCode,
      pool: 'work',
      durationMinutes: durationOrDefault(s.durationMinutes),
      defaultDaysOffset: offsetOrDefault(s.defaultDaysOffset),
      stepSeq: s.pathwayOrderIndex,
    });
  }
  return out;
}

/**
 * Fallback path (no plan generated yet): the next `limit` work-pool phases from the
 * pathway template, starting after the completed-appointment count. Count-based and
 * not skip-aware — used only until the plan is generated.
 */
export function selectInitialWorkPhasesFromPathway(
  pathway: PathwayPhaseLite[],
  completedCount: number,
  limit: number
): InitialWorkPhase[] {
  const out: InitialWorkPhase[] = [];
  const start = Math.max(0, completedCount);
  for (let i = start; i < pathway.length && out.length < limit; i++) {
    const p = pathway[i];
    if (p.pool !== 'work') continue;
    out.push({
      workPhaseCode: p.work_phase_code,
      pool: 'work',
      durationMinutes: durationOrDefault(p.duration_minutes),
      defaultDaysOffset: offsetOrDefault(p.default_days_offset),
      stepSeq: i,
    });
  }
  return out;
}
