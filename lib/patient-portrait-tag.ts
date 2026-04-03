/**
 * Portré / arc–szájfotó dokumentumok.
 *
 * Kanonikus tárolási címke új feltöltéseknél: **foto** (UI: „Önarckép”).
 * A többi név régi vagy szinonim címke — validáció és lekérdezések továbbra is ismerik.
 */
export const CANONICAL_PORTRAIT_DOCUMENT_TAG = 'foto';

export const PORTRAIT_DOCUMENT_TAGS_LOWER = new Set([
  CANONICAL_PORTRAIT_DOCUMENT_TAG,
  'portre',
  'portré',
  'onarckép',
  'onarkep',
  'önarckép',
  'önarkep',
  'portrait',
  'selfie',
]);

/** OP / panoráma: kanonikus címke **op**; ezek a DB-ben gyakori szinonimák (nem külön gomb a választóban). */
export const CANONICAL_OP_DOCUMENT_TAG = 'op';

export const OP_DOCUMENT_ALIAS_TAGS_LOWER = new Set([
  'orthopantomogram',
  'panorámaröntgen',
  'panorama',
  'röntgen',
]);

export function tagStringIsPortraitTag(tag: string): boolean {
  return PORTRAIT_DOCUMENT_TAGS_LOWER.has(tag.trim().toLowerCase());
}

/**
 * Dokumentum-bekérő és címke-API: ne listázzuk külön a kanonikus foto és op mellett
 * (pl. önarckép, portré, orthopantomogram — ezekre a foto / op kérhető).
 */
export function isLegacyDocumentTagSupersededInPicker(tag: string): boolean {
  const k = tag.trim().toLowerCase();
  if (!k) return false;
  if (k === CANONICAL_PORTRAIT_DOCUMENT_TAG || k === CANONICAL_OP_DOCUMENT_TAG) {
    return false;
  }
  if (tagStringIsPortraitTag(tag)) {
    return true;
  }
  if (OP_DOCUMENT_ALIAS_TAGS_LOWER.has(k)) {
    return true;
  }
  return false;
}

/** SQL-ben: lower(elem) IN (...) — portré + foto egy halmazban */
export function portraitDocumentTagsSqlInList(): string {
  return Array.from(PORTRAIT_DOCUMENT_TAGS_LOWER)
    .map((t) => `'${t.replace(/'/g, "''")}'`)
    .join(', ');
}
