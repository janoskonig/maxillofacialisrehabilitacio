/**
 * Közös, tiszta segédfüggvények konzílium vetítés / előkészítő UI-hoz (kliens + szerver típusok).
 */

import type { PresentationTimelineEpisode, PresentationTimelineStage } from '@/lib/consilium-presentation';

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

/** Sűrű UI-hoz: név vagy email levágása (ne tördelje szét a sort). */
export function consiliumShortDisplay(text: string | null | undefined, maxLen = 42): string {
  if (text == null) return '';
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(1, maxLen - 1))}…`;
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

/** Egybefűzött stádium sor: epizód azonosító + meta a színkódoláshoz és fejléchez. */
export type CareTimelineFlatRow = {
  episodeId: string;
  epLabel: string;
  episodeCreatedBy: string | null;
  episodeCreatedByRole: string | null;
  st: PresentationTimelineStage;
};

export function flattenCareTimelineNewestFirst(
  care: PresentationTimelineEpisode[] | undefined,
): CareTimelineFlatRow[] {
  if (!care?.length) return [];
  const rows: CareTimelineFlatRow[] = [];
  for (const ep of care) {
    const epLabel = [ep.reason, ep.status].filter(Boolean).join(' · ') || 'Epizód';
    for (const st of ep.stages) {
      rows.push({
        episodeId: ep.id,
        epLabel,
        episodeCreatedBy: ep.episodeCreatedBy,
        episodeCreatedByRole: ep.episodeCreatedByRole,
        st,
      });
    }
  }
  rows.sort((a, b) => new Date(b.st.at).getTime() - new Date(a.st.at).getTime());
  return rows;
}

export type CareTimelineAccent = {
  episodeBlockClass: string;
  episodeTitleClass: string;
  stageCardClass: string;
  /** Kis kitöltött pont (stádium esemény) */
  timelineStageDotClass: string;
  /** Nagyobb gyűrűs pont (új epizód első bejegyzése) */
  timelineEpisodeDotClass: string;
};

const CARE_TIMELINE_PALETTES: CareTimelineAccent[] = [
  {
    episodeBlockClass: 'border-l-4 border-amber-400/80 bg-amber-500/15 border border-white/12',
    episodeTitleClass: 'text-amber-100',
    stageCardClass: 'border-l-2 border-amber-400/50 bg-amber-500/[0.08] border border-white/10 rounded-md',
    timelineStageDotClass: 'bg-amber-400 ring-2 ring-zinc-950',
    timelineEpisodeDotClass: 'bg-zinc-950 ring-2 ring-amber-400',
  },
  {
    episodeBlockClass: 'border-l-4 border-cyan-400/80 bg-cyan-500/15 border border-white/12',
    episodeTitleClass: 'text-cyan-100',
    stageCardClass: 'border-l-2 border-cyan-400/50 bg-cyan-500/[0.08] border border-white/10 rounded-md',
    timelineStageDotClass: 'bg-cyan-400 ring-2 ring-zinc-950',
    timelineEpisodeDotClass: 'bg-zinc-950 ring-2 ring-cyan-400',
  },
  {
    episodeBlockClass: 'border-l-4 border-violet-400/80 bg-violet-500/15 border border-white/12',
    episodeTitleClass: 'text-violet-100',
    stageCardClass: 'border-l-2 border-violet-400/50 bg-violet-500/[0.08] border border-white/10 rounded-md',
    timelineStageDotClass: 'bg-violet-400 ring-2 ring-zinc-950',
    timelineEpisodeDotClass: 'bg-zinc-950 ring-2 ring-violet-400',
  },
  {
    episodeBlockClass: 'border-l-4 border-emerald-400/80 bg-emerald-500/15 border border-white/12',
    episodeTitleClass: 'text-emerald-100',
    stageCardClass: 'border-l-2 border-emerald-400/50 bg-emerald-500/[0.08] border border-white/10 rounded-md',
    timelineStageDotClass: 'bg-emerald-400 ring-2 ring-zinc-950',
    timelineEpisodeDotClass: 'bg-zinc-950 ring-2 ring-emerald-400',
  },
  {
    episodeBlockClass: 'border-l-4 border-rose-400/75 bg-rose-500/15 border border-white/12',
    episodeTitleClass: 'text-rose-100',
    stageCardClass: 'border-l-2 border-rose-400/50 bg-rose-500/[0.08] border border-white/10 rounded-md',
    timelineStageDotClass: 'bg-rose-400 ring-2 ring-zinc-950',
    timelineEpisodeDotClass: 'bg-zinc-950 ring-2 ring-rose-400',
  },
  {
    episodeBlockClass: 'border-l-4 border-sky-400/80 bg-sky-500/15 border border-white/12',
    episodeTitleClass: 'text-sky-100',
    stageCardClass: 'border-l-2 border-sky-400/50 bg-sky-500/[0.08] border border-white/10 rounded-md',
    timelineStageDotClass: 'bg-sky-400 ring-2 ring-zinc-950',
    timelineEpisodeDotClass: 'bg-zinc-950 ring-2 ring-sky-400',
  },
];

export function careTimelineEpisodeAccent(episodeId: string): CareTimelineAccent {
  let h = 0;
  for (let i = 0; i < episodeId.length; i++) {
    h = (h * 31 + episodeId.charCodeAt(i)) >>> 0;
  }
  return CARE_TIMELINE_PALETTES[h % CARE_TIMELINE_PALETTES.length]!;
}

/**
 * Sötét UI (vetítés / előkészítő): a szerző megjelenített nevének színe a users.role alapján.
 * Beutaló orvos — piros; fogpótlástanász és admin — kék; technikus — zöld.
 */
export function careTimelineAuthorNameClass(role: string | null | undefined): string {
  switch (role) {
    case 'beutalo_orvos':
      return 'font-medium text-rose-300';
    case 'admin':
    case 'fogpótlástanász':
      return 'font-medium text-sky-300';
    case 'technikus':
      return 'font-medium text-emerald-300';
    default:
      return 'font-medium text-white/80';
  }
}
