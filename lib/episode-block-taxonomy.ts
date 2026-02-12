/**
 * Episode block taxonomy: allowed keys + default TTL (days).
 * Used for validation and auto-setting expires_at when creating blocks.
 */

export const BLOCK_TAXONOMY: Record<string, number> = {
  WAIT_LAB: 14,
  WAIT_HEALING: 30,
  WAIT_SURGERY: 60,
  PATIENT_DELAY: 14,
  WAIT_OR: 60,
  WAIT_IMPLANT: 90,
  OTHER: 14,
};

export const RENEWAL_ESCALATION_THRESHOLD = 2;

export function getDefaultTtlDays(key: string): number {
  return BLOCK_TAXONOMY[key] ?? BLOCK_TAXONOMY.OTHER;
}

export function isValidBlockKey(key: string): boolean {
  return key in BLOCK_TAXONOMY;
}
