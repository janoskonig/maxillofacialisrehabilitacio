/**
 * Hiányzási okkódok a patient_field_na jelölésekhez (migration 068).
 *
 * A hiányzó adat MECHANIZMUSA statisztikailag nem mindegy: a „beteg
 * megtagadta" (MNAR-gyanús) és a „még nem kérdezték" (MCAR-közeli)
 * másképp torzít, mint a valódi nem-alkalmazhatóság. Az okkód a kutatási
 * exportba is bekerül, hogy az elemzés a hiányzást osztályozni tudja.
 */

export const FIELD_NA_REASON_CODES = [
  'nem_alkalmazhato',
  'nem_ismert',
  'beteg_megtagadta',
  'meg_nem_kerdeztek',
] as const;

export type FieldNaReasonCode = (typeof FIELD_NA_REASON_CODES)[number];

export const FIELD_NA_REASON_LABELS: Record<FieldNaReasonCode, string> = {
  nem_alkalmazhato: 'Nem alkalmazható',
  nem_ismert: 'Nem ismert',
  beteg_megtagadta: 'Beteg megtagadta',
  meg_nem_kerdeztek: 'Még nem kérdezték',
};

export function isFieldNaReasonCode(value: unknown): value is FieldNaReasonCode {
  return typeof value === 'string' && (FIELD_NA_REASON_CODES as readonly string[]).includes(value);
}
