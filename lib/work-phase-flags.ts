/**
 * Work-phase feature flags (default off).
 *
 * AUTO_GENERATE_WORK_PHASES — when on, episode activation generates the
 * episode_work_phases from the care pathway automatically (instead of requiring
 * the user to click "Munkafázisok generálása sablonból"). Off by default so
 * enabling it is an explicit product decision.
 */
function parseFlag(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

export function isAutoGenerateWorkPhasesEnabled(): boolean {
  return parseFlag(process.env.AUTO_GENERATE_WORK_PHASES);
}
