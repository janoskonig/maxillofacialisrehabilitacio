/**
 * WP-4.3 — vizit-alapú („puzzle") kezelési terv: közös típusok és pure helperek.
 *
 * A terv-kártya (EpisodeStepsManager) alkalom-kártyákban (VisitCard) jeleníti
 * meg a munkafázisokat; egy kártya = egy episode_visits sor. Az itt élő
 * helperek pure függvények — a komponens-tesztek is ezeken keresztül
 * ellenőrzik a fejléc-összegzést (státusz-chip, összidő, címke, dátum).
 */
import { SkipForward, CheckCircle2, Circle, Clock } from 'lucide-react';

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
   * hivatkozott időpontot lemondták/törölték), és azóta sincs új. A sorban
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
    };
  });
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
    .filter((p) => p.status !== 'skipped')
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

/** A kocka hatókör-szövege: fogszámok, különben állcsont, különben legacy fog #N. */
export function phaseScopeText(step: EpisodeStep): string | null {
  if (step.teeth.length > 0) {
    return `fog ${step.teeth.join(', ')}`;
  }
  if (step.jaw) return JAW_SCOPE_LABELS[step.jaw] ?? step.jaw;
  if (step.toothNumber != null) return `fog #${step.toothNumber}`;
  return null;
}
