/**
 * Shared window computation for pathway steps.
 * Single source of truth — used by next-step-engine, episode-activation, and slot-intent-projector.
 */

export interface StepWindow {
  windowStart: Date;
  windowEnd: Date;
  /** Anchor + offset; use this to chain the next step's anchor (not windowEnd). */
  expectedDate: Date;
}

/**
 * Compute the scheduling window for a pathway step.
 * @param anchor - hard fact: completed appointment start_time, OR episode.opened_at
 * @param defaultDaysOffset - pathway step default_days_offset
 */
export function computeStepWindow(anchor: Date, defaultDaysOffset: number): StepWindow {
  const windowStart = new Date(anchor);
  windowStart.setDate(windowStart.getDate() + Math.max(0, defaultDaysOffset - 7));
  const windowEnd = new Date(anchor);
  windowEnd.setDate(windowEnd.getDate() + defaultDaysOffset + 14);
  const expectedDate = new Date(anchor);
  expectedDate.setDate(expectedDate.getDate() + defaultDaysOffset);
  return { windowStart, windowEnd, expectedDate };
}
