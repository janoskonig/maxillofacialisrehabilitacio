/**
 * Legal capacity helpers for consent / privacy-notice declarations.
 *
 * Patients below GUARDIAN_REQUIRED_BELOW_AGE require a legal guardian
 * (törvényes képviselő) to make declarations on their behalf.
 *
 * NOTE (legal sign-off): the privacy notice currently states 16; Hungarian
 * cselekvőképesség is generally 18. This single constant must be reconciled
 * with the published notice by the DPO / lawyer.
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
