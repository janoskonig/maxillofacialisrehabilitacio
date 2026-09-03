/**
 * Vizit-alapú („puzzle") kezelési terv: közös típusok és pure helperek.
 *
 * A terv-kártya (EpisodeStepsManager) alkalom-sorokban (VisitRow) jeleníti
 * meg a munkafázisokat kockákként (PhasePill); egy sor = egy episode_visits
 * sor. Az itt élő helperek pure függvények — a komponens-tesztek is ezeken
 * keresztül ellenőrzik a fejléc-összegzést (státusz-chip, összidő, címke,
 * dátum) és a vizit-csoportosítást.
 */
import { SkipForward, CheckCircle2, Circle, Clock } from 'lucide-react';
import { DEFAULT_VISIT_GAP_DAYS, formatVisitGap } from '@/lib/visit-plan-constants';

export { DEFAULT_VISIT_GAP_DAYS, formatVisitGap };

export interface EpisodeStep {
  id: string;
  episodeId: string;
  stepCode: string;
  pathwayOrderIndex: number;
  pool: string;
  durationMinutes: number;
  defaultDaysOffset: number;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  appointmentId: string | null;
  createdAt: string;
  completedAt: string | null;
  sourceEpisodePathwayId: string | null;
  seq: number | null;
  customLabel?: string | null;
  toothTreatmentId?: string | null;
  mergedIntoStepId?: string | null;
  toothNumber?: number | null;
  treatmentLabel?: string | null;
  /** WP-4.1a/4.2: melyik alkalomhoz (episode_visits) tartozik a fázis. */
  visitId: string | null;
  /** WP-4.2: állcsont-hatókör. */
  jaw: 'felso' | 'also' | 'mindketto' | null;
  /** WP-4.2: fog-hatókör (episode_work_phase_teeth) — fogszámok listája. */
  teeth: string[];
  /**
   * WP-1.2: az integritás-javítás során elveszett a sor foglalása (a
   * hivatkozott időpontot lemondták/törölték), és azóta sincs új. A kockán
   * halk jelzést mutatunk: „nincs élő időpont — foglaljon újat".
   */
  lostAppointment?: boolean;
}

/** GET /api/episodes/:id/work-phases → visits[] metaadat-sor. */
export interface EpisodeVisit {
  id: string;
  seq: number;
  label: string | null;
  daysOffset: number | null;
  plannedDurationMinutes: number | null;
  /**
   * Puzzle v2 (094): az alkalom időpontja — „az időpontfoglalás a váz". NULL =
   * tervezett (időpont nélküli) alkalom. A státusz NULL = nyitott foglalás,
   * 'completed' = megtörtént.
   */
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentEnd: string | null;
  appointmentStatus: string | null;
}

/** A vázhoz rendelhető, alkalom nélküli foglalt időpont (GET work-phases → unattachedAppointments[]). */
export interface UnattachedAppointment {
  id: string;
  startTime: string | null;
  endTime: string | null;
  pool: string | null;
  stepCode: string | null;
  dentistEmail: string | null;
  /** WP-6.5: kézzel leválasztva — a terv automatikus rácsúszása kihagyja. */
  visitDetachedAt: string | null;
}

/** Nyitott (jövőbeli vagy még le nem zárt) foglalása van az alkalomnak. */
export function visitHasOpenAppointment(visit: Pick<EpisodeVisit, 'appointmentId' | 'appointmentStatus'>): boolean {
  return !!visit.appointmentId && visit.appointmentStatus == null;
}

export function visitAppointmentCompleted(visit: Pick<EpisodeVisit, 'appointmentId' | 'appointmentStatus'>): boolean {
  return !!visit.appointmentId && visit.appointmentStatus === 'completed';
}

/** A GET /api/episodes/:id/step-projections sorainak itt használt szelete. */
export interface StepProjectionInfo {
  /** Kanonikus episode_work_phases.id — ezen join-olunk az EpisodeStep.id-hoz. */
  workPhaseId?: string | null;
  status: string;
  actualDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  waitFromNowDays: number | null;
}

/** /api/step-catalog egy sora — a paletta és a címke-feloldás forrása. */
export interface PaletteItem {
  stepCode: string;
  labelHu: string;
  isActive: boolean;
  /** 091: a bal hasáb sorrendje; null = csak keresésből érhető el. */
  paletteOrder: number | null;
  defaultDurationMinutes: number | null;
  defaultPool: 'consult' | 'work' | 'control' | null;
}

/** /api/episodes/:id/linked-tooth-treatments egy sora. */
export interface LinkedToothTreatment {
  id: string;
  toothNumber: number;
  treatmentCode: string;
  status: string;
  labelHu: string;
  /** Legacy; same as inWorkPhases. */
  inSteps: boolean;
  inWorkPhases?: boolean;
}

/** Áthelyezés / hozzáadás célja: meglévő alkalom id-ja vagy új alkalom. */
export type VisitTarget = string | 'new';

export type ConfirmAction = 'skip' | 'unskip' | 'delete' | 'timing' | 'reopen';

export const poolLabels: Record<string, string> = {
  consult: 'Konzultáció',
  work: 'Munkafázis',
  control: 'Kontroll',
};

export const statusConfig: Record<
  string,
  { icon: typeof Circle; label: string; color: string; bgColor: string }
> = {
  pending: { icon: Circle, label: 'Várakozik', color: 'text-gray-400 dark:text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/60' },
  scheduled: { icon: Clock, label: 'Időpont foglalva', color: 'text-blue-500 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-950/40' },
  completed: { icon: CheckCircle2, label: 'Kész', color: 'text-green-500 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-950/40' },
  skipped: { icon: SkipForward, label: 'Átugorva', color: 'text-amber-500 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950/40' },
};

/** Állcsont-hatókör rövid címkéi a kockákon. */
export const JAW_SCOPE_LABELS: Record<string, string> = {
  felso: 'felső állcsont',
  also: 'alsó állcsont',
  mindketto: 'mindkét állcsont',
};

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
}

export function formatWaitDays(days: number): string {
  if (days === 0) return 'ma';
  if (days === 1) return '1 nap múlva';
  return `${days} nap múlva`;
}

/** Optimista (még szerver-azonosító nélküli) sor/vizit ideiglenes id-ja. */
export function isTempId(id: string): boolean {
  return id.startsWith('tmp');
}

/** Map work-phase API row (camelCase) to local EpisodeStep shape (stepCode = work phase code). */
export function mapWorkPhaseApiToEpisodeStep(row: Record<string, unknown>): EpisodeStep {
  const code = (row.workPhaseCode ?? row.stepCode) as string;
  const rawTeeth = Array.isArray(row.teeth) ? row.teeth : [];
  return {
    id: String(row.id),
    episodeId: String(row.episodeId),
    stepCode: code,
    pathwayOrderIndex: Number(row.pathwayOrderIndex),
    pool: String(row.pool),
    durationMinutes: Number(row.durationMinutes),
    defaultDaysOffset: Number(row.defaultDaysOffset),
    status: row.status as EpisodeStep['status'],
    appointmentId: row.appointmentId != null ? String(row.appointmentId) : null,
    createdAt: String(row.createdAt),
    completedAt: row.completedAt != null ? String(row.completedAt) : null,
    sourceEpisodePathwayId:
      row.sourceEpisodePathwayId != null ? String(row.sourceEpisodePathwayId) : null,
    seq: row.seq != null ? Number(row.seq) : null,
    customLabel: row.customLabel != null ? String(row.customLabel) : null,
    toothTreatmentId: row.toothTreatmentId != null ? String(row.toothTreatmentId) : null,
    mergedIntoStepId:
      row.mergedIntoWorkPhaseId != null ? String(row.mergedIntoWorkPhaseId) : null,
    toothNumber: row.toothNumber != null ? Number(row.toothNumber) : null,
    treatmentLabel: row.treatmentLabel != null ? String(row.treatmentLabel) : null,
    visitId: row.visitId != null ? String(row.visitId) : null,
    jaw:
      row.jaw === 'felso' || row.jaw === 'also' || row.jaw === 'mindketto'
        ? row.jaw
        : null,
    teeth: rawTeeth.map((t) => String(t)),
  };
}

export function mapWorkPhasesResponse(
  rows: unknown[] | undefined,
  lostAppointmentWorkPhaseIds?: unknown[]
): EpisodeStep[] {
  if (!rows?.length) return [];
  const lostIds = new Set(
    (lostAppointmentWorkPhaseIds ?? []).map((id) => String(id))
  );
  return rows.map((r) => {
    const step = mapWorkPhaseApiToEpisodeStep(r as Record<string, unknown>);
    if (lostIds.has(step.id)) step.lostAppointment = true;
    return step;
  });
}

export function mapVisitsResponse(rows: unknown[] | undefined): EpisodeVisit[] {
  if (!rows?.length) return [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      seq: Number(row.seq),
      label: row.label != null ? String(row.label) : null,
      daysOffset: row.daysOffset != null ? Number(row.daysOffset) : null,
      plannedDurationMinutes:
        row.plannedDurationMinutes != null ? Number(row.plannedDurationMinutes) : null,
      appointmentId: row.appointmentId != null ? String(row.appointmentId) : null,
      appointmentStart: row.appointmentStart != null ? String(row.appointmentStart) : null,
      appointmentEnd: row.appointmentEnd != null ? String(row.appointmentEnd) : null,
      appointmentStatus: row.appointmentStatus != null ? String(row.appointmentStatus) : null,
    };
  });
}

export function mapUnattachedAppointments(rows: unknown[] | undefined): UnattachedAppointment[] {
  if (!rows?.length) return [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      startTime: row.startTime != null ? String(row.startTime) : null,
      endTime: row.endTime != null ? String(row.endTime) : null,
      pool: row.pool != null ? String(row.pool) : null,
      stepCode: row.stepCode != null ? String(row.stepCode) : null,
      dentistEmail: row.dentistEmail != null ? String(row.dentistEmail) : null,
      visitDetachedAt: row.visitDetachedAt != null ? String(row.visitDetachedAt) : null,
    };
  });
}

export function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function mapCatalogResponse(rows: unknown[] | undefined): PaletteItem[] {
  if (!rows?.length) return [];
  return rows
    .map((r) => {
      const row = r as Record<string, unknown>;
      const pool = row.defaultPool;
      return {
        stepCode: String(row.stepCode),
        labelHu: String(row.labelHu ?? row.stepCode),
        isActive: row.isActive !== false,
        paletteOrder: row.paletteOrder != null ? Number(row.paletteOrder) : null,
        defaultDurationMinutes:
          row.defaultDurationMinutes != null ? Number(row.defaultDurationMinutes) : null,
        defaultPool:
          pool === 'consult' || pool === 'work' || pool === 'control' ? pool : null,
      } satisfies PaletteItem;
    })
    .filter((i) => i.isActive);
}

/** A paletta (bal hasáb) elemei sorrendben — a többi csak keresésből érhető el. */
export function paletteEntries(catalog: PaletteItem[]): PaletteItem[] {
  return catalog
    .filter((i) => i.paletteOrder != null)
    .sort((a, b) => (a.paletteOrder ?? 0) - (b.paletteOrder ?? 0) || a.labelHu.localeCompare(b.labelHu, 'hu'));
}

/**
 * Keresés a teljes katalógusban: a paletta-elemek elöl, majd a többi aktív
 * elem címke szerint; a több sablonban azonos címkével szereplő (előtagos)
 * kódok közül csak az elsőt mutatjuk, hogy ne legyen 11× „Átadás".
 */
export function searchCatalog(catalog: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return paletteEntries(catalog);
  const matches = catalog.filter(
    (i) => i.labelHu.toLowerCase().includes(q) || i.stepCode.toLowerCase().includes(q)
  );
  const palette = matches
    .filter((i) => i.paletteOrder != null)
    .sort((a, b) => (a.paletteOrder ?? 0) - (b.paletteOrder ?? 0));
  const seenLabels = new Set(palette.map((i) => i.labelHu.toLowerCase()));
  const rest: PaletteItem[] = [];
  for (const item of matches
    .filter((i) => i.paletteOrder == null)
    .sort((a, b) => a.labelHu.localeCompare(b.labelHu, 'hu'))) {
    const key = item.labelHu.toLowerCase();
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    rest.push(item);
  }
  return [...palette, ...rest];
}

// ─── Alkalom-csoportosítás ───────────────────────────────────────────────────

export interface VisitGroup {
  visit: EpisodeVisit;
  /** Minden tag a megjelenítési sorrendben (primary sorok + összevont gyerekeik). */
  phases: EpisodeStep[];
  /** Csak a nem összevont (foglalható) sorok — státusz, összidő, foglalás ezekből. */
  primaries: EpisodeStep[];
}

/**
 * A sorok alkalmakba rendezése a `steps` tömb sorrendjében (a kliens a saját
 * megjelenítési sorrendjét tartja; a szerver ugyanígy — vizit, azon belül a
 * mai sorrend, az áthelyezett sor a végén — számoz át). Az összevont gyerek a
 * primary-ja után áll. Vizit nélküli / ismeretlen vizitű sor a `unassigned`
 * szakaszba kerül (backfill előtti vagy hibás adat).
 */
export function buildVisitGroups(
  steps: EpisodeStep[],
  visits: EpisodeVisit[]
): { groups: VisitGroup[]; unassigned: EpisodeStep[] } {
  const known = new Set(visits.map((v) => v.id));
  const childrenByPrimary = new Map<string, EpisodeStep[]>();
  for (const s of steps) {
    if (s.mergedIntoStepId) {
      const arr = childrenByPrimary.get(s.mergedIntoStepId) ?? [];
      arr.push(s);
      childrenByPrimary.set(s.mergedIntoStepId, arr);
    }
  }
  const primaryIds = new Set(steps.filter((s) => !s.mergedIntoStepId).map((s) => s.id));
  const byVisit = new Map<string, EpisodeStep[]>();
  const unassigned: EpisodeStep[] = [];
  const place = (s: EpisodeStep) => {
    if (s.visitId && known.has(s.visitId)) {
      const arr = byVisit.get(s.visitId) ?? [];
      arr.push(s);
      byVisit.set(s.visitId, arr);
    } else {
      unassigned.push(s);
    }
  };
  for (const s of steps) {
    if (s.mergedIntoStepId && primaryIds.has(s.mergedIntoStepId)) continue; // a primary után jön
    place(s);
    for (const child of childrenByPrimary.get(s.id) ?? []) place(child);
  }
  return {
    groups: visits.map((v) => {
      const phases = byVisit.get(v.id) ?? [];
      return { visit: v, phases, primaries: phases.filter((p) => !p.mergedIntoStepId) };
    }),
    unassigned,
  };
}

/** Az összevont gyerek a primary-ja státuszát mutatja (a szerver is így kezeli). */
export function effectiveStatus(step: EpisodeStep, stepsById: Map<string, EpisodeStep>): EpisodeStep['status'] {
  if (step.mergedIntoStepId) {
    const primary = stepsById.get(step.mergedIntoStepId);
    if (primary) return primary.status;
  }
  return step.status;
}

/** A vizitköz napokban — NULL-nál a vizit-alap (7 nap). */
export function visitGapDays(visit: Pick<EpisodeVisit, 'daysOffset'>): number {
  return visit.daysOffset ?? DEFAULT_VISIT_GAP_DAYS;
}

// ─── Alkalom-fejléc összegzések (pure) ───────────────────────────────────────

export type VisitStatusKey =
  | 'ures'
  | 'varakozik'
  | 'foglalva'
  | 'teljesult'
  | 'kihagyva'
  | 'vegyes';

export interface VisitStatusSummary {
  key: VisitStatusKey;
  label: string;
  /** Tailwind chip-osztályok (világos + sötét). */
  chipClass: string;
}

const VISIT_STATUS_CHIPS: Record<VisitStatusKey, { label: string; chipClass: string }> = {
  ures: { label: 'Üres', chipClass: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400' },
  varakozik: { label: 'Várakozik', chipClass: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' },
  foglalva: { label: 'Foglalva', chipClass: 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300' },
  teljesult: { label: 'Teljesült', chipClass: 'bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300' },
  kihagyva: { label: 'Kihagyva', chipClass: 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300' },
  vegyes: { label: 'Vegyes', chipClass: 'bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300' },
};

/** Az alkalom státusz-chipje a tag-fázisok (primary sorok) állapotából. */
export function summarizeVisitStatus(phases: EpisodeStep[]): VisitStatusSummary {
  let key: VisitStatusKey;
  const active = phases.filter((p) => p.status !== 'skipped');
  if (phases.length === 0) {
    key = 'ures';
  } else if (active.length === 0) {
    key = 'kihagyva';
  } else {
    const statuses = new Set(active.map((p) => p.status));
    if (statuses.size === 1) {
      const only = active[0].status;
      key = only === 'completed' ? 'teljesult' : only === 'scheduled' ? 'foglalva' : 'varakozik';
    } else {
      key = 'vegyes';
    }
  }
  return { key, ...VISIT_STATUS_CHIPS[key] };
}

/**
 * Az alkalom összideje percben: a vizit planned_duration_minutes felülírása,
 * különben a nem kihagyott tag-fázisok duration_minutes összege. Az összevont
 * (merged) gyerekek percét nem adjuk hozzá — a primary sor perce a foglalható
 * blokk egésze.
 */
export function visitTotalMinutes(
  visit: Pick<EpisodeVisit, 'plannedDurationMinutes'> | null,
  phases: EpisodeStep[]
): number | null {
  if (visit?.plannedDurationMinutes != null) return visit.plannedDurationMinutes;
  const sum = phases
    .filter((p) => p.status !== 'skipped' && !p.mergedIntoStepId)
    .reduce((acc, p) => acc + (Number.isFinite(p.durationMinutes) ? p.durationMinutes : 0), 0);
  return sum > 0 ? sum : null;
}

/** Az alkalom címe: a vizit label-je, különben a tag-fázisok címkéiből képzett. */
export function visitDisplayLabel(
  visit: Pick<EpisodeVisit, 'label'> | null,
  phases: EpisodeStep[],
  getPhaseLabel: (step: EpisodeStep) => string
): string {
  if (visit?.label) return visit.label;
  if (phases.length === 0) return 'Üres alkalom';
  const labels = phases.map(getPhaseLabel);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} + ${labels[1]}`;
  return `${labels[0]} + ${labels[1]} +${labels.length - 2}`;
}

export interface VisitDateInfo {
  kind: 'booked' | 'window' | 'done';
  text: string;
}

/**
 * Az alkalom dátuma vagy becsült ablaka a tag-fázisok vetítéséből:
 * foglalt tag → a foglalt dátum; csak várakozók → min(windowStart)–max(windowEnd);
 * minden kész → az utolsó teljesítés dátuma.
 */
export function visitDateInfo(
  phases: EpisodeStep[],
  projectionByPhaseId: Map<string, StepProjectionInfo>
): VisitDateInfo | null {
  const active = phases.filter((p) => p.status !== 'skipped');
  if (active.length === 0) return null;

  const bookedDates = active
    .filter((p) => p.status === 'scheduled')
    .map((p) => projectionByPhaseId.get(p.id)?.actualDate)
    .filter((d): d is string => !!d)
    .sort();
  if (bookedDates.length > 0) {
    return { kind: 'booked', text: formatShortDate(bookedDates[0]) };
  }

  if (active.every((p) => p.status === 'completed')) {
    const doneDates = active
      .map((p) => p.completedAt)
      .filter((d): d is string => !!d)
      .sort();
    if (doneDates.length > 0) {
      return { kind: 'done', text: formatShortDate(doneDates[doneDates.length - 1]) };
    }
    return null;
  }

  const windows = active
    .filter((p) => p.status === 'pending')
    .map((p) => projectionByPhaseId.get(p.id))
    .filter((pr): pr is StepProjectionInfo => !!pr?.windowStart && !!pr?.windowEnd);
  if (windows.length > 0) {
    const starts = windows.map((w) => w.windowStart as string).sort();
    const ends = windows.map((w) => w.windowEnd as string).sort();
    const start = formatShortDate(starts[0]);
    const end = formatShortDate(ends[ends.length - 1]);
    return { kind: 'window', text: start === end ? start : `${start} – ${end}` };
  }
  return null;
}

/**
 * Puzzle v2: az alkalom státusz-chipje — a VÁZ (időpont) az elsődleges: nyitott
 * időponttal „Foglalva" (üresen is), megtörtént időponttal „Teljesült";
 * időpont nélkül a tagok állapotából (a régi szabály).
 */
export function summarizeVisitStatusV2(
  visit: Pick<EpisodeVisit, 'appointmentId' | 'appointmentStatus'>,
  primaries: EpisodeStep[]
): VisitStatusSummary {
  if (visitHasOpenAppointment(visit)) {
    return { key: 'foglalva', ...VISIT_STATUS_CHIPS.foglalva };
  }
  if (visitAppointmentCompleted(visit)) {
    return { key: 'teljesult', ...VISIT_STATUS_CHIPS.teljesult };
  }
  return summarizeVisitStatus(primaries);
}

/**
 * Puzzle v2: az alkalom dátuma — a VÁZ (időpont) az elsődleges; tervezett
 * alkalomnál a tagok vetítéséből becsült ablak (a régi szabály).
 */
export function visitDateInfoV2(
  visit: Pick<EpisodeVisit, 'appointmentId' | 'appointmentStart' | 'appointmentStatus'>,
  phases: EpisodeStep[],
  projectionByPhaseId: Map<string, StepProjectionInfo>
): VisitDateInfo | null {
  if (visit.appointmentId && visit.appointmentStart) {
    if (visit.appointmentStatus === 'completed') {
      return { kind: 'done', text: formatShortDate(visit.appointmentStart) };
    }
    if (visit.appointmentStatus == null) {
      return { kind: 'booked', text: formatShortDate(visit.appointmentStart) };
    }
  }
  return visitDateInfo(phases, projectionByPhaseId);
}

/** A kocka hatókör-szövege: fogszámok, különben állcsont, különben legacy fog #N. */
export function phaseScopeText(step: EpisodeStep): string | null {
  if (step.teeth.length > 0) {
    return `fog ${step.teeth.join(', ')}`;
  }
  if (step.jaw) return JAW_SCOPE_LABELS[step.jaw] ?? step.jaw;
  if (step.toothNumber != null) return `fog #${step.toothNumber}`;
  return null;
}

/** Fogszám-lista értelmezése szabad szövegből („11, 12 21" → ['11','12','21']). */
export function parseTeethInput(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\s,;]+/)
        .map((t) => t.trim())
        .filter((t) => /^\d{1,2}$/.test(t))
    )
  );
}
