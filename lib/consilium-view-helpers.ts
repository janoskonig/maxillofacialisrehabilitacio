/**
 * Közös, tiszta segédfüggvények konzílium vetítés / előkészítő UI-hoz (kliens + szerver típusok).
 */

export type ConsiliumPrepCommentSnapshot = {
  id: string;
  checklistKey: string;
  body: string;
  authorDisplay: string;
  createdAt: string;
};

export function formatConsiliumHuDateTime(iso: string | null | undefined): string {
  if (iso == null || iso === '') return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  return new Date(iso).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' });
}

export function prepCommentsGroupedByKey(
  comments: readonly ConsiliumPrepCommentSnapshot[] | null | undefined,
): Map<string, ConsiliumPrepCommentSnapshot[]> {
  const m = new Map<string, ConsiliumPrepCommentSnapshot[]>();
  for (const c of comments ?? []) {
    const arr = m.get(c.checklistKey) ?? [];
    arr.push(c);
    m.set(c.checklistKey, arr);
  }
  return m;
}

/** Kommentek olyan checklist kulcsokhoz, amik már nincsenek a napirendben. */
export function orphanPrepCommentsByKey(
  comments: readonly ConsiliumPrepCommentSnapshot[] | null | undefined,
  validKeys: ReadonlySet<string>,
): Map<string, ConsiliumPrepCommentSnapshot[]> {
  const m = new Map<string, ConsiliumPrepCommentSnapshot[]>();
  for (const c of comments ?? []) {
    if (validKeys.has(c.checklistKey)) continue;
    const arr = m.get(c.checklistKey) ?? [];
    arr.push(c);
    m.set(c.checklistKey, arr);
  }
  return m;
}

export function consiliumPresentationDiagnosisText(ps: {
  bnoDescription?: string | null;
  diagnozis?: string | null;
}): string | null {
  const b = (ps.bnoDescription || '').trim();
  const d = (ps.diagnozis || '').trim();
  if (!b && !d) return null;
  if (b && d && b === d) return b;
  if (b && d) return `${b}\n\n${d}`;
  return b || d;
}
