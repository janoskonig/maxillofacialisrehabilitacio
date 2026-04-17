/**
 * Single source of truth: episode_work_phases.status → episode_plan_items.status.
 * Keep in sync with backfill SQL and tests (episode plan migration).
 */
export const EWP_TO_PLAN_ITEM_STATUS_SQL = `CASE ewp.status
  WHEN 'completed' THEN 'completed'
  WHEN 'scheduled' THEN 'scheduled'
  WHEN 'skipped' THEN 'cancelled'
  ELSE 'planned'
END`;

export type EpisodeWorkPhaseStatus = 'pending' | 'scheduled' | 'completed' | 'skipped';

export type EpisodePlanItemDisplayStatus = 'planned' | 'scheduled' | 'completed' | 'cancelled';

export function mapEwpStatusToPlanItemStatus(status: string): EpisodePlanItemDisplayStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'scheduled':
      return 'scheduled';
    case 'skipped':
      return 'cancelled';
    default:
      return 'planned';
  }
}
