/**
 * Legal capacity helpers for consent / privacy-notice declarations.
 *
 * Patients below GUARDIAN_REQUIRED_BELOW_AGE require a legal guardian
 * (törvényes képviselő) to make declarations on their behalf.
 *
 * NOTE (legal sign-off): the published privacy notice (app/privacy-hu, policy
 * version 1.2) now also states 18, matching this enforced threshold and the
 * Ptk. cselekvőképesség rule. The final threshold still awaits DPO / lawyer
 * sign-off — if they rule 16 (GDPR Art. 8-style), change this constant AND
 * publish a *material* notice bump (v1.3, no editorial ack backfill).
 */
export const GUARDIAN_REQUIRED_BELOW_AGE = 18;

/** Whole years between birthDate and `now` (default: current date). */
export function computeAgeYears(birthDate: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  const d = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * True when the patient needs a legal guardian to declare on their behalf.
 * Unknown birth date → false (cannot determine; handled as adult, surface elsewhere).
 */
export function requiresGuardian(birthDate: string | Date | null | undefined, now: Date = new Date()): boolean {
  const age = computeAgeYears(birthDate, now);
  if (age === null) return false;
  return age < GUARDIAN_REQUIRED_BELOW_AGE;
}
