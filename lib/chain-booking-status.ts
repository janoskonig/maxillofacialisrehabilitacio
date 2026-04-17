/**
 * Whether the episode should show the mandatory "book full chain" wizard (multi-step scheduling).
 * Uses open work-pool intents vs pending work phases from the DB.
 */
export function chainBookingRequiredFromCounts(openWorkIntents: number, pendingWorkPhases: number): boolean {
  return openWorkIntents >= 2 || (pendingWorkPhases >= 2 && openWorkIntents >= 1);
}
