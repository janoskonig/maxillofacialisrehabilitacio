/**
 * Dokumentum tag normalizálás és egyezés (export kategóriák: technikus_meltanyossagi, arajanlat).
 * Kanonikus kategória/path: technikus_meltanyossagi (nem technikus_mertek).
 */

/**
 * Normalize a single tag: NFD + strip combining marks, lowercase, collapse whitespace.
 * Hyphen/dot/underscore treated as word separators (collapse to single space).
 * e.g. "technikus   méltányossági" → "technikus meltanyossagi"
 */
export function normalizeTag(s: string | null | undefined): string {
  if (s == null || typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_\-\.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Check if doc tags (array or comma-separated) match the target tag or any alias.
 * Comparison uses normalized form.
 */
export function hasTag(
  docTags: string[] | null | undefined,
  target: string,
  aliases?: string[]
): boolean {
  const normalizedTarget = normalizeTag(target);
  if (!normalizedTarget) return false;
  const toMatch = [normalizedTarget, ...(aliases ?? []).map(normalizeTag)].filter(Boolean);
  const tags = Array.isArray(docTags) ? docTags : [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (toMatch.includes(n)) return true;
  }
  return false;
}
