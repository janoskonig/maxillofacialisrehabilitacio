/**
 * Slot intent priority: ageing + overdue_days + starvation guard.
 * Priority increases with overdue_days + time_in_WIP (ageing).
 * Starvation guard: intents open > X days get escalated priority.
 */

export const STARVATION_DAYS = 14;
export const MAX_PRIORITY = 999;

export interface IntentForPriority {
  created_at: Date | string;
  window_end: Date | string | null;
  priority?: number;
}

/**
 * Compute effective priority for an open intent.
 * Base 50 + overdue_days * 5 + age_days * 2.
 * Starvation: if open > STARVATION_DAYS, force MAX_PRIORITY (escalation bucket).
 */
export function computeIntentPriority(
  intent: IntentForPriority,
  now: Date = new Date()
): { priority: number; isStarvation: boolean } {
  const created = new Date(intent.created_at);
  const windowEnd = intent.window_end ? new Date(intent.window_end) : null;
  const ageDays = Math.floor((now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000));
  const overdueDays = windowEnd && windowEnd < now
    ? Math.ceil((now.getTime() - windowEnd.getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  if (ageDays >= STARVATION_DAYS) {
    return { priority: MAX_PRIORITY, isStarvation: true };
  }

  const base = intent.priority ?? 0;
  const ageing = Math.min(50, ageDays * 2);
  const overdue = Math.min(50, overdueDays * 5);
  const priority = Math.min(MAX_PRIORITY - 1, base + 50 + ageing + overdue);

  return { priority, isStarvation: false };
}
