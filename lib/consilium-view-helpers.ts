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

export function consiliumPresentationOncologyRows(ps: {
  primerMutetLeirasa?: string | null;
  radioterapia?: boolean | null;
  radioterapiaDozis?: string | null;
  radioterapiaDatumIntervallum?: string | null;
  chemoterapia?: boolean | null;
  chemoterapiaLeiras?: string | null;
}): Array<{ label: string; value: string | null }> {
  const rtParts = [ps.radioterapiaDozis?.trim() || null, ps.radioterapiaDatumIntervallum?.trim() || null].filter(
    Boolean,
  ) as string[];
  const radioterapiaValue = ps.radioterapia ? ['Igen', ...rtParts].join(' · ') : 'Nem';
  const chemoterapiaBase = ps.chemoterapia ? 'Igen' : 'Nem';
  const chemoterapiaLeiras = ps.chemoterapiaLeiras?.trim() || null;
  const chemoterapiaValue = chemoterapiaLeiras ? `${chemoterapiaBase} · ${chemoterapiaLeiras}` : chemoterapiaBase;
  return [
    { label: 'Primer műtét leírása', value: ps.primerMutetLeirasa?.trim() || null },
    { label: 'Sugárkezelés', value: radioterapiaValue },
    { label: 'Kemoterápia', value: chemoterapiaValue },
  ];
}

export function consiliumPresentationOhipRows(ps: {
  ohip14Summary?: Partial<
    Record<
      'T0' | 'T1' | 'T2' | 'T3',
      {
        totalScore: number | null;
        completedAt: string | null;
        functionalLimitationScore: number | null;
        physicalPainScore: number | null;
        psychologicalDiscomfortScore: number | null;
        physicalDisabilityScore: number | null;
        psychologicalDisabilityScore: number | null;
        socialDisabilityScore: number | null;
        handicapScore: number | null;
      }
    >
  >;
}): Array<{ label: string; value: string | null }> {
  const impactLabel = (score: number): string => {
    if (score <= 8) return 'alacsony hatás';
    if (score <= 18) return 'enyhe-közepes hatás';
    if (score <= 28) return 'közepes hatás';
    if (score <= 42) return 'jelentős hatás';
    return 'nagyon jelentős hatás';
  };

  const domainLabels = {
    functionalLimitationScore: 'Funkcionális korlátozottság',
    physicalPainScore: 'Fizikai fájdalom',
    psychologicalDiscomfortScore: 'Pszichés diszkomfort',
    physicalDisabilityScore: 'Fizikai akadályozottság',
    psychologicalDisabilityScore: 'Pszichés akadályozottság',
    socialDisabilityScore: 'Szociális akadályozottság',
    handicapScore: 'Hátrányérzet',
  } as const;
  type DomainKey = keyof typeof domainLabels;

  let worst: { label: string; score: number } | null = null;
  for (const row of Object.values(ps.ohip14Summary ?? {})) {
    if (!row) continue;
    const domains: Record<DomainKey, number | null> = {
      functionalLimitationScore: row.functionalLimitationScore,
      physicalPainScore: row.physicalPainScore,
      psychologicalDiscomfortScore: row.psychologicalDiscomfortScore,
      physicalDisabilityScore: row.physicalDisabilityScore,
      psychologicalDisabilityScore: row.psychologicalDisabilityScore,
      socialDisabilityScore: row.socialDisabilityScore,
      handicapScore: row.handicapScore,
    };
    for (const [key, value] of Object.entries(domains) as Array<[DomainKey, number | null]>) {
      if (value == null) continue;
      if (!worst || value > worst.score) {
        worst = { label: domainLabels[key], score: value };
      }
    }
  }

  const timepoints: Array<'T0' | 'T1' | 'T2' | 'T3'> = ['T0', 'T1', 'T2', 'T3'];
  const rows = timepoints.map((tp) => {
    const row = ps.ohip14Summary?.[tp];
    if (!row || row.totalScore == null) return { label: `OHIP-14 ${tp}`, value: null };
    const dateText = formatConsiliumHuDateTime(row.completedAt);
    return {
      label: `OHIP-14 ${tp}`,
      value: `${row.totalScore}/56 · ${impactLabel(row.totalScore)} · ${dateText}`,
    };
  });
  rows.push({
    label: 'Legrosszabb OHIP domén',
    value: worst ? `${worst.label} (${worst.score}/8)` : null,
  });
  return rows;
}
