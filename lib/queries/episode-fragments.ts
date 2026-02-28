/**
 * Inline subquery that returns the latest stage_code per episode.
 *
 * Typical usage (as a LEFT JOIN):
 *   LEFT JOIN (${LATEST_STAGE_SUBQUERY}) se ON pe.id = se.episode_id
 *
 * Or as a standalone query with a WHERE clause:
 *   SELECT ... FROM (${LATEST_STAGE_SUBQUERY}) ls WHERE ls.episode_id = ANY($1)
 */
export const LATEST_STAGE_SUBQUERY = `
  SELECT DISTINCT ON (episode_id) episode_id, stage_code
  FROM stage_events
  ORDER BY episode_id, at DESC
`;

/**
 * Stage codes considered "work-in-progress" (patient actively going through treatment).
 */
export const WIP_STAGE_CODES = [
  'STAGE_1',
  'STAGE_2',
  'STAGE_3',
  'STAGE_4',
  'STAGE_5',
  'STAGE_6',
] as const;

/**
 * Preparatory stages (waiting / pre-treatment).
 */
export const PREPARATORY_STAGE_CODES = [
  'STAGE_0',
  'STAGE_1',
  'STAGE_2',
  'STAGE_3',
  'STAGE_4',
] as const;
