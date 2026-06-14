/**
 * Episode forecast — pure projection math (no DB).
 *
 * Extracted from `computeEpisodeForecast` so the visit-count and completion-window
 * logic can be unit-tested in isolation.
 *
 * WP1 fix (haladás-tudatos becslés): the remaining-visit estimate now subtracts
 * already-completed visits / counts only the concretely-remaining plan steps, so
 * the projected completion date moves forward as the treatment progresses. The
 * previous implementation projected the pathway's *total* visit count regardless
 * of how far the episode had advanced, which systematically overestimated the ETA.
 */

export const DEFAULT_CADENCE_DAYS = 14;

/** P80 buffer applied to the concrete remaining-step count when no analytics exist. */
export const P80_STEP_BUFFER = 1.3;

/** Visit counts used by the no-analytics, no-steps pathway heuristic. */
export const PATHWAY_HEURISTIC_P50_RATIO = 0.6;
export const PATHWAY_HEURISTIC_P80_RATIO = 0.9;

/** Defaults when the episode has no care pathway at all. */
export const NO_PATHWAY_P50 = 4;
export const NO_PATHWAY_P80 = 6;

export interface VisitProjectionInput {
  /** Whether the episode has a care pathway at all. */
  hasCarePathway: boolean;
  /** care_pathway_analytics.median_visits — calibrated *total* visits for the pathway (null if uncalibrated). */
  medianVisits: number | null;
  /** care_pathway_analytics.p80_visits — calibrated total visits, 80th percentile. */
  p80Visits: number | null;
  /** care_pathway_analytics.median_cadence_days — typical days between visits (null → default). */
  medianCadenceDays: number | null;
  /** Completed visits so far (completed appointments on the episode). */
  completedVisits: number;
  /**
   * Concretely-remaining plan steps from `episode_work_phases`
   * (pending + scheduled, merged children excluded). `null` when no work phases
   * have been generated yet for the episode.
   */
  remainingSteps: number | null;
  /** Total work-pool steps in the pathway template (heuristic denominator). */
  totalWorkSteps: number | null;
}

export interface VisitProjection {
  remainingVisitsP50: number;
  remainingVisitsP80: number;
  cadenceDays: number;
  assumptions: string[];
}

/**
 * Project the number of *remaining* visits (P50/P80) and the visit cadence.
 *
 * Priority order:
 *  1. Calibrated analytics present → use median/p80 visits, progress-adjusted by
 *     subtracting completed visits.
 *  2. Generated work phases present → use the concrete remaining-step count
 *     (most accurate per-episode signal), with a P80 buffer for re-attempts.
 *  3. Pathway template only → heuristic on the work-step count, progress-adjusted.
 *  4. No pathway → coarse defaults.
 *
 * P50/P80 are always clamped to at least 1, and P80 ≥ P50.
 */
export function projectRemainingVisits(input: VisitProjectionInput): VisitProjection {
  const { hasCarePathway, medianVisits, p80Visits, medianCadenceDays, completedVisits, remainingSteps, totalWorkSteps } =
    input;

  // 1. Calibrated analytics — progress-adjusted.
  if (hasCarePathway && medianVisits != null && p80Visits != null) {
    const cadenceDays = medianCadenceDays != null ? Number(medianCadenceDays) : DEFAULT_CADENCE_DAYS;
    const p50 = Math.max(1, Math.ceil(Number(medianVisits)) - completedVisits);
    const p80 = Math.max(p50, Math.ceil(Number(p80Visits)) - completedVisits);
    return {
      remainingVisitsP50: p50,
      remainingVisitsP80: p80,
      cadenceDays,
      assumptions: [
        'calibrated-pathway',
        medianCadenceDays != null ? 'cadence-from-analytics' : 'CADENCE_DEFAULTED',
        'PROGRESS_ADJUSTED',
      ],
    };
  }

  // 2. Concrete remaining steps from episode_work_phases.
  if (remainingSteps != null) {
    const p50 = Math.max(1, remainingSteps);
    const p80 = Math.max(p50, Math.ceil(remainingSteps * P80_STEP_BUFFER));
    return {
      remainingVisitsP50: p50,
      remainingVisitsP80: p80,
      cadenceDays: DEFAULT_CADENCE_DAYS,
      assumptions: ['EPISODE_STEPS_REMAINING', 'CADENCE_DEFAULTED', 'PROGRESS_ADJUSTED'],
    };
  }

  // 3. Pathway template only — heuristic, progress-adjusted.
  if (hasCarePathway) {
    const workSteps = totalWorkSteps != null && totalWorkSteps > 0 ? totalWorkSteps : 4;
    const p50 = Math.max(1, Math.ceil(workSteps * PATHWAY_HEURISTIC_P50_RATIO) - completedVisits);
    const p80 = Math.max(p50, Math.ceil(workSteps * PATHWAY_HEURISTIC_P80_RATIO) - completedVisits);
    return {
      remainingVisitsP50: p50,
      remainingVisitsP80: p80,
      cadenceDays: DEFAULT_CADENCE_DAYS,
      assumptions: ['NO_ANALYTICS_FALLBACK', 'CADENCE_DEFAULTED', 'PROGRESS_ADJUSTED'],
    };
  }

  // 4. No pathway — coarse defaults.
  return {
    remainingVisitsP50: NO_PATHWAY_P50,
    remainingVisitsP80: NO_PATHWAY_P80,
    cadenceDays: DEFAULT_CADENCE_DAYS,
    assumptions: ['NO_CARE_PATHWAY_DEFAULT', 'CADENCE_DEFAULTED'],
  };
}

/**
 * Completion window = next-step window shifted out by the projected remaining
 * visits × cadence. P50 anchors to the next step's earliest date, P80 to its latest.
 */
export function computeCompletionWindow(
  nextStepEarliest: Date,
  nextStepLatest: Date,
  projection: Pick<VisitProjection, 'remainingVisitsP50' | 'remainingVisitsP80' | 'cadenceDays'>
): { start: Date; end: Date } {
  const start = new Date(nextStepEarliest);
  start.setDate(start.getDate() + projection.remainingVisitsP50 * projection.cadenceDays);
  const end = new Date(nextStepLatest);
  end.setDate(end.getDate() + projection.remainingVisitsP80 * projection.cadenceDays);
  return { start, end };
}
