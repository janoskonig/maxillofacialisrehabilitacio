/**
 * TAJ (Társadalombiztosítási Azonosító Jel) checksum validation.
 *
 * Algorithm:
 *   Weights for positions 1–8: 3, 7, 3, 7, 3, 7, 3, 7
 *   Check digit (position 9) = (Σ weight_i × digit_i) mod 10
 */

const TAJ_WEIGHTS = [3, 7, 3, 7, 3, 7, 3, 7] as const;

export function isValidTajChecksum(taj: string): boolean {
  const digits = taj.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  if (digits === '000000000') return false;

  const nums = digits.split('').map(Number);
  const sum = TAJ_WEIGHTS.reduce((acc, w, i) => acc + w * nums[i], 0);
  return (sum % 10) === nums[8];
}

/**
 * Returns true when the TAJ looks complete (9 digits) but has an invalid check digit.
 * Useful for showing a non-blocking warning.
 */
export function tajHasChecksumError(taj: string | null | undefined): boolean {
  if (!taj) return false;
  const digits = taj.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  return !isValidTajChecksum(taj);
}
