/**
 * Episode plan migration feature flags (default off).
 * READ_PLAN_ITEMS / WRITE_PLAN_ITEMS / SCHEDULER_USE_PLAN_ITEMS — enable only per runbook.
 */
function parsePlanItemFlag(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}

export function isReadPlanItemsEnabled(): boolean {
  return parsePlanItemFlag(process.env.READ_PLAN_ITEMS);
}

export function isWritePlanItemsEnabled(): boolean {
  return parsePlanItemFlag(process.env.WRITE_PLAN_ITEMS);
}

export function isSchedulerUsePlanItemsEnabled(): boolean {
  return parsePlanItemFlag(process.env.SCHEDULER_USE_PLAN_ITEMS);
}
