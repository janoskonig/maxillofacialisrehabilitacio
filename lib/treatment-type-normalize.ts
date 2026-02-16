/**
 * Központi normalizáló: régi tipus string vagy treatmentTypeCode → canonical treatmentTypeCode.
 * Egyetlen helyen legyen a string→code logika. Ne duplikálódjon a UI-ban.
 *
 * Normalizálás: trim + toLowerCase() (whitespace→_ nem).
 * treatmentTypeCode csak akkor menthető, ha létezik treatment_types.code.
 */

/** Régi tipus (kezelesiTervOptions) → treatment_types.code mapping */
const LEGACY_TIPUS_TO_CODE: Record<string, string> = {
  'zárólemez': 'zarolemez',
  'részleges akrilátlemezes fogpótlás': 'reszleges_akrilat',
  'teljes lemezes fogpótlás': 'teljes_lemez',
  'fedőlemezes fogpótlás': 'fedolemezes',
  'kapocselhorgonyzású részleges fémlemezes fogpótlás': 'kapocselhorgonyzasu_reszleges',
  'kombinált fogpótlás kapocselhorgonyzással': 'kombinalt_kapoccsal',
  'kombinált fogpótlás rejtett elhorgonyzási eszközzel': 'kombinalt_rejtett',
  'rögzített fogpótlás fogakon elhorgonyozva': 'rogzitett_fogakon',
  'cementezett rögzítésű implantációs korona/híd': 'cementezett_implant',
  'csavarozott rögzítésű implantációs korona/híd': 'csavarozott_implant',
  'sebészi sablon készítése': 'sebeszi_sablon',
};

/**
 * Normalize input to canonical treatmentTypeCode.
 * @param input - régi tipus string VAGY treatmentTypeCode
 * @returns canonical treatmentTypeCode | null (if unknown/empty)
 */
export function normalizeToTreatmentTypeCode(
  input: string | null | undefined
): string | null {
  if (input == null || typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // Ha már code formátumban van (snake_case)
  if (/^[a-z0-9_]+$/.test(trimmed)) {
    return trimmed;
  }

  // Régi tipus mapping
  const mapped = LEGACY_TIPUS_TO_CODE[input.trim()];
  if (mapped) return mapped;

  // Nem találtuk meg – lehet más formátum, próbáljuk lowercase-ként
  const lowerKey = Object.keys(LEGACY_TIPUS_TO_CODE).find(
    (k) => k.toLowerCase() === trimmed
  );
  return lowerKey ? LEGACY_TIPUS_TO_CODE[lowerKey] : null;
}

/**
 * Extract suggested treatment type codes from patient kezelesi_terv (felso + also).
 * Deterministic: felso first, then also, dedupe, stable sort.
 */
export function extractSuggestedTreatmentTypeCodes(
  kezelesiTervFelso: Array<{ tipus?: string; treatmentTypeCode?: string }> | null | undefined,
  kezelesiTervAlso: Array<{ tipus?: string; treatmentTypeCode?: string }> | null | undefined
): string[] {
  const codes = new Set<string>();
  const add = (item: { tipus?: string; treatmentTypeCode?: string }) => {
    const code =
      normalizeToTreatmentTypeCode(item.treatmentTypeCode) ??
      normalizeToTreatmentTypeCode(item.tipus);
    if (code) codes.add(code);
  };
  (kezelesiTervFelso ?? []).forEach(add);
  (kezelesiTervAlso ?? []).forEach(add);
  return Array.from(codes).sort();
}
