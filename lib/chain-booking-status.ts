/**
 * Whether the episode should offer the "book full chain" flow (multi-step scheduling) —
 * ajánlat, nem kötelezettség (WP-1.3).
 * Uses open work-pool intents vs pending work phases from the DB.
 */
export function chainBookingRequiredFromCounts(openWorkIntents: number, pendingWorkPhases: number): boolean {
  return openWorkIntents >= 2 || (pendingWorkPhases >= 2 && openWorkIntents >= 1);
}
