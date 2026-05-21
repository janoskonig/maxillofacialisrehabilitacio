/**
 * Epizód horgony-dátum a munkafázis ablakokhoz (default_days_offset láncolás).
 * Prioritás: utolsó teljesített fázis → utolsó teljesített időpont → kezdődátum → opened_at.
 */

export interface SchedulingAnchorInput {
  lastResolvedAt: Date | null;
  lastCompletedAppointmentAt: Date | null;
  planStartDate: Date | null;
  openedAt: Date;
}

/** Visszaadja a következő pending fázisok első horgonyát. */
export function resolveSchedulingAnchor(input: SchedulingAnchorInput): Date {
  if (input.lastResolvedAt) {
    return new Date(input.lastResolvedAt);
  }
  if (input.lastCompletedAppointmentAt) {
    return new Date(input.lastCompletedAppointmentAt);
  }
  if (input.planStartDate) {
    return new Date(input.planStartDate);
  }
  return new Date(input.openedAt);
}
