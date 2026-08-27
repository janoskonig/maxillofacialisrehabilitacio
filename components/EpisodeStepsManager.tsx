'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from '@/contexts/ToastContext';
import {
  Loader2, SkipForward, RotateCcw, CheckCircle2, Circle, Clock,
  ChevronDown, ChevronUp, ChevronRight, GripVertical, Trash2,
  Plus, Search, FileText, Layers, PenLine, Merge, Unlink, Calendar, SendHorizontal,
  AlertTriangle, CalendarDays, UserRound, CalendarPlus, CalendarClock, CalendarX2, Link2, Undo2,
} from 'lucide-react';
import { WorkPhaseTaskDelegateBlock } from './WorkPhaseTaskDelegateBlock';
import { PlanValidationPanel } from './PlanValidationPanel';
import { LONG_DURATION_MINUTES } from '@/lib/treatment-plan-validation';
import { useWorkPhaseBooking } from '@/hooks/useWorkPhaseBooking';
import { WorkPhaseBookingModals } from './WorkPhaseBookingModals';
import { PlanStartDateControl } from './PlanStartDateControl';
import type { WorklistRowState } from '@/lib/worklist-types';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const restrictToVerticalAxis: Modifier = (args) => ({
  ...args.transform,
  x: 0,
});

interface EpisodeStep {
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
  /**
   * WP-1.2: az integritás-javítás során elveszett a sor foglalása (a
   * hivatkozott időpontot lemondták/törölték), és azóta sincs új. A sorban
   * halk jelzést mutatunk: „nincs élő időpont — foglaljon újat".
   */
  lostAppointment?: boolean;
}

interface LinkedToothTreatment {
  id: string;
  toothNumber: number;
  treatmentCode: string;
  status: string;
  labelHu: string;
  /** Legacy; same as inWorkPhases. */
  inSteps: boolean;
  inWorkPhases?: boolean;
}

interface StepCatalogItem {
  stepCode: string;
  labelHu: string;
}

interface EpisodePathwayInfo {
  id: string;
  carePathwayId: string;
  pathwayName: string;
  jaw?: 'felso' | 'also' | null;
}

const JAW_SHORT: Record<string, string> = {
  felso: 'felső',
  also: 'alsó',
};

// ─── Tervezett ütemezés (step-projections) — a lépéssorba fésülve ────────────

/** A GET /api/episodes/:id/step-projections sorainak itt használt szelete. */
interface StepProjectionInfo {
  /** Kanonikus episode_work_phases.id — ezen join-olunk az EpisodeStep.id-hoz. */
  workPhaseId?: string | null;
  status: string;
  actualDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  waitFromNowDays: number | null;
}

interface StepProjectionSummary {
  completedCount: number;
  remainingCount: number;
  estimatedCompletionEarliest: string | null;
  estimatedCompletionLatest: string | null;
  nextStepWaitDays: number | null;
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
}

function formatWaitDays(days: number): string {
  if (days === 0) return 'ma';
  if (days === 1) return '1 nap múlva';
  return `${days} nap múlva`;
}

function estimatedCompletionText(s: StepProjectionSummary): string | null {
  const e = s.estimatedCompletionEarliest;
  const l = s.estimatedCompletionLatest;
  if (e && l) return `${formatShortDate(e)} – ${formatShortDate(l)}`;
  if (l) return `legkésőbb ${formatShortDate(l)}`;
  if (e) return `legkorábban ${formatShortDate(e)}`;
  return null;
}

/** Map work-phase API row (camelCase) to local EpisodeStep shape (stepCode = work phase code). */
function mapWorkPhaseApiToEpisodeStep(row: Record<string, unknown>): EpisodeStep {
  const code = (row.workPhaseCode ?? row.stepCode) as string;
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
  };
}

function mapWorkPhasesResponse(
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

export interface EpisodeStepsManagerProps {
  episodeId: string;
  /** Optional — enables the "rebook on worklist" link from sequence-violation flags. */
  patientId?: string;
  carePathwayId: string | null;
  carePathwayName?: string | null;
  episodePathways?: EpisodePathwayInfo[];
  onStepChanged?: () => void;
  /** Az epizód felelős orvosa — a terv-kártya metasorában jelenik meg. */
  assignedProviderName?: string | null;
  /** Kezelési út + felelős orvos szerkesztő (EpisodePathwayEditor) — a kártya
      „Beállítások módosítása" gombja mögött nyílik. Csak jogosultnak adandó át. */
  settingsPanel?: React.ReactNode;
  /** Külső frissítő kulcs (pl. beállítás-mentés után) — változásra teljes újratöltés. */
  refreshTrigger?: number;
}

const poolLabels: Record<string, string> = {
  consult: 'Konzultáció',
  work: 'Munkafázis',
  control: 'Kontroll',
};

const statusConfig: Record<string, { icon: typeof Circle; label: string; color: string; bgColor: string }> = {
  pending: { icon: Circle, label: 'Várakozik', color: 'text-gray-400 dark:text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-800/60' },
  scheduled: { icon: Clock, label: 'Időpont foglalva', color: 'text-blue-500 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-950/40' },
  completed: { icon: CheckCircle2, label: 'Kész', color: 'text-green-500 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-950/40' },
  skipped: { icon: SkipForward, label: 'Átugorva', color: 'text-amber-500 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950/40' },
};

const PATHWAY_COLORS = [
  'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300',
  'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300',
  'bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300',
  'bg-pink-100 dark:bg-pink-950/50 text-pink-700 dark:text-pink-300',
  'bg-cyan-100 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300',
];

type AdderTab = 'catalog' | 'freetext' | 'tooth';

type ConfirmAction = 'skip' | 'unskip' | 'delete' | 'timing' | 'reopen';

/** Terv-sorhoz párosított worklist-foglalási akciók (useWorkPhaseBooking-ból). */
interface RowBookingActions {
  state: WorklistRowState;
  onBook: () => void;
  onLink: () => void;
  onMarkDoneRetro: () => void;
  onMarkUnsuccessful: () => void;
}

// ─── Sortable step row ───────────────────────────────────────────────────────

function SortableStepRow({
  step, idx, isNext, stepLabel, pathwayLabel, pathwayColor,
  mergedChildren, projection, rowBooking,
  onSkipConfirm, onUnskipConfirm, onDelete, onReopenConfirm,
  mergeMode, mergeSelected, onToggleMerge,
  onEditTiming, onUnmerge, canDelegate, onDelegateClick, delegateOpen,
  onDeleteChild,
}: {
  step: EpisodeStep;
  idx: number;
  isNext: boolean;
  stepLabel: string;
  pathwayLabel: string | null;
  pathwayColor: string;
  mergedChildren: EpisodeStep[];
  projection: StepProjectionInfo | null;
  rowBooking: RowBookingActions | null;
  onSkipConfirm: () => void;
  onUnskipConfirm: () => void;
  onDelete: () => void;
  onReopenConfirm: () => void;
  mergeMode: boolean;
  mergeSelected: boolean;
  onToggleMerge: () => void;
  onEditTiming: () => void;
  onUnmerge: () => void;
  canDelegate: boolean;
  onDelegateClick: () => void;
  delegateOpen: boolean;
  onDeleteChild: (child: EpisodeStep) => void;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: step.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative' as const,
  };

  const config = statusConfig[step.status] ?? statusConfig.pending;
  const StatusIcon = config.icon;
  const canSkip = step.status === 'pending' || step.status === 'scheduled';
  const canUnskip = step.status === 'skipped';
  // A tervből bármelyik sor elhagyható — a foglalt időpontot a szerver mondja
  // le, a kész fázis pedig az előzményekből is kikerül.
  const canDelete = true;
  const isAdHoc = !step.sourceEpisodePathwayId;
  const isTooth = !!step.toothTreatmentId;
  const hasMerged = mergedChildren.length > 0;

  // Kész / kihagyott → vékony, halvány sor (kevesebb zaj a tervben).
  if (step.status === 'completed' || step.status === 'skipped') {
    return (
      <div ref={setNodeRef} style={style}>
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 ${
            step.status === 'completed' ? 'opacity-70' : 'opacity-60'
          }`}
        >
          <span className="text-xs font-mono text-gray-400 dark:text-gray-500 w-5 text-right shrink-0">{idx + 1}.</span>
          <StatusIcon className={`w-4 h-4 shrink-0 ${config.color}`} />
          <span
            className={`flex-1 min-w-0 truncate text-sm ${
              step.status === 'skipped' ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {stepLabel}
          </span>
          {step.status === 'completed' && (step.completedAt || projection?.actualDate) && (
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
              {formatShortDate((step.completedAt ?? projection?.actualDate) as string)}
            </span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">{config.label}</span>
          {step.status === 'completed' && !mergeMode && (
            <button
              onClick={onReopenConfirm}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Mégsem kész — visszaállítás várakozóra (indoklás szükséges)"
            >
              <Undo2 className="w-3 h-3" />
              Mégsem kész
            </button>
          )}
          {canUnskip && !mergeMode && (
            <button
              onClick={onUnskipConfirm}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Visszaállítás várakozóra"
            >
              <RotateCcw className="w-3 h-3" />
              Visszaállít
            </button>
          )}
          {canDelete && !mergeMode && (
            <button
              onClick={onDelete}
              className="shrink-0 p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors"
              title="Munkafázis elhagyása a tervből"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`flex items-center gap-2 flex-wrap px-3 py-2.5 rounded-lg transition-colors ${
          isDragging ? 'shadow-lg ring-2 ring-medical-primary/30' : ''
        } ${isNext ? 'bg-medical-primary/5 border border-medical-primary/20' : config.bgColor}`}
      >
        {mergeMode && (
          <input
            type="checkbox"
            checked={mergeSelected}
            onChange={onToggleMerge}
            className="w-4 h-4 shrink-0 accent-medical-primary"
          />
        )}

        {/* Drag handle */}
        <button
          ref={setActivatorNodeRef}
          className="touch-none p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-grab active:cursor-grabbing shrink-0"
          {...attributes}
          {...listeners}
          tabIndex={-1}
          aria-label="Húzd át"
        >
          <GripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        </button>

        {/* Step number + icon */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-gray-400 dark:text-gray-500 w-5 text-right">{idx + 1}.</span>
          <StatusIcon className={`w-4 h-4 ${config.color}`} />
        </div>

        {/* Step info — min szélesség alatt az akciósor új sorba törik */}
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {stepLabel}
            </span>
            {isNext && (
              <span className="text-xs font-medium text-medical-primary bg-medical-primary/10 px-1.5 py-0.5 rounded">
                Következő
              </span>
            )}
            {pathwayLabel && (
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${pathwayColor}`}>
                {pathwayLabel}
              </span>
            )}
            {isTooth && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300">
                fog #{step.toothNumber}
              </span>
            )}
            {isAdHoc && !isTooth && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                egyedi
              </span>
            )}
            {hasMerged && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300">
                +{mergedChildren.length} összevonva
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-gray-500 dark:text-gray-400">{poolLabels[step.pool] ?? step.pool}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {step.durationMinutes} perc
              {hasMerged ? ' (foglalható blokk)' : ''}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{step.defaultDaysOffset} nap offset</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
            <span className={`text-xs ${config.color}`}>{config.label}</span>
            {/* Tervezett ütemezés — foglalt időpont / becsült időablak a vetítésből */}
            {step.status === 'scheduled' && projection?.actualDate && (
              <>
                <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
                <span className="text-xs text-blue-600 dark:text-blue-300">
                  📅 {formatShortDate(projection.actualDate)}
                  {projection.waitFromNowDays != null && projection.waitFromNowDays > 0 &&
                    ` (${formatWaitDays(projection.waitFromNowDays)})`}
                </span>
              </>
            )}
            {step.status === 'pending' && projection?.windowStart && projection?.windowEnd && (
              <>
                <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  🕐 {formatShortDate(projection.windowStart)} – {formatShortDate(projection.windowEnd)}
                  {projection.waitFromNowDays != null &&
                    ` (${projection.waitFromNowDays === 0 ? 'most ütemezendő' : formatWaitDays(projection.waitFromNowDays)})`}
                </span>
              </>
            )}
          </div>
          {/* WP-1.2: klinikai jelentésű, halk sor-jelzés — a lépés foglalása
              az integritás-takarítás során veszett el (a hivatkozott időpont
              már nem élő), és azóta nincs új. Nem banner, nem blokkol. */}
          {step.status === 'pending' && step.lostAppointment && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-blue-700 dark:text-blue-300">
              <CalendarX2 className="w-3.5 h-3.5 shrink-0" />
              <span>Ehhez a lépéshez már nincs élő időpont — foglaljon újat.</span>
            </div>
          )}
          {/* Merged children list */}
          {hasMerged && (
            <div className="mt-1 ml-1 space-y-0.5">
              {mergedChildren.map((child) => (
                <div key={child.id} className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-300">
                  <Merge className="w-3 h-3" />
                  <span>{child.customLabel || child.treatmentLabel || child.stepCode.replace(/_/g, ' ')}</span>
                  {child.toothNumber && <span className="text-violet-400 dark:text-violet-500">(fog #{child.toothNumber})</span>}
                  {!mergeMode && (
                    <button
                      onClick={() => onDeleteChild(child)}
                      className="p-0.5 text-violet-400 dark:text-violet-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors"
                      title="Ez az összevont alfázis elhagyása a tervből"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions — egy sorban jobbra zárva; szűk helyen saját sorba törik és belül tördel */}
        <div className="flex grow items-center gap-1 flex-wrap justify-end">
          {rowBooking && !mergeMode && rowBooking.state === 'READY' && (
            <>
              <button
                onClick={rowBooking.onBook}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-medical-primary rounded hover:bg-medical-primary-dark transition-colors"
                title="Időpont foglalása erre a munkafázisra"
              >
                <CalendarPlus className="w-3 h-3" />
                Foglalás
              </button>
              <button
                onClick={rowBooking.onLink}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                title="Már létező jövőbeli foglalás (pl. páciens portál) hozzárendelése ehhez a munkafázishoz"
              >
                <Link2 className="w-3 h-3" />
                Meglévő foglalás
              </button>
              <button
                onClick={rowBooking.onMarkDoneRetro}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="A munkafázis elkészült, nem itt foglalt időponttal (utólagos jelölés)"
              >
                Elkészült (utólag)
              </button>
            </>
          )}
          {rowBooking && !mergeMode && rowBooking.state === 'BOOKED' && (
            <>
              <button
                onClick={rowBooking.onBook}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-medical-primary bg-medical-primary/10 rounded hover:bg-medical-primary/20 transition-colors"
                title="Áthelyezés másik időpontra (a jelenlegi foglalás automatikusan törlődik)"
              >
                <CalendarClock className="w-3 h-3" />
                Áthelyezés
              </button>
              <button
                onClick={rowBooking.onMarkUnsuccessful}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 rounded hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors"
                title="A próba sikertelen volt — új próba szükséges (indok kötelező)"
              >
                <AlertTriangle className="w-3 h-3" />
                Sikertelen próba
              </button>
              <button
                onClick={rowBooking.onMarkDoneRetro}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="A munkafázis elkészült (nem itt foglalt), utólag jelölés"
              >
                Elkészült (utólag)
              </button>
            </>
          )}
          {rowBooking && rowBooking.state === 'BOOKING_IN_PROGRESS' && (
            <span className="text-xs text-gray-500 dark:text-gray-400 px-1">Foglalás…</span>
          )}
          {rowBooking && rowBooking.state === 'OVERRIDE_REQUIRED' && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300"
              title="A foglaláshoz felülírási megerősítés szükséges — a megnyitott ablak bezárása után újra foglalható"
            >
              Felülírás szükséges
            </span>
          )}
          {rowBooking && rowBooking.state === 'NEEDS_REVIEW' && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300"
              title="Hiányzó foglalási adat (időtartam, időablak vagy pool) — ellenőrizd a munkafázis beállításait"
            >
              Ellenőrizendő
            </span>
          )}
          {canDelegate && !mergeMode && (
            <button
              onClick={onDelegateClick}
              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                delegateOpen
                  ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950/50'
                  : 'text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
              }`}
              title="Feladat kiosztása / felosztása"
            >
              <SendHorizontal className="w-3 h-3" />
              Feladat
            </button>
          )}
          {!mergeMode && (
            <button
              onClick={onEditTiming}
              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-medical-primary hover:bg-medical-primary/10 rounded transition-colors"
              title="Időzítés szerkesztése"
            >
              <Calendar className="w-3.5 h-3.5" />
            </button>
          )}
          {hasMerged && !mergeMode && (
            <button
              onClick={onUnmerge}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-violet-600 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 rounded hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
              title="Összevonás felbontása"
            >
              <Unlink className="w-3 h-3" />
              Szétbont
            </button>
          )}
          {canDelete && !mergeMode && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              title="Munkafázis elhagyása a tervből"
            >
              <Trash2 className="w-3 h-3" />
              Elhagyom
            </button>
          )}
          {canSkip && !mergeMode && (
            <button
              onClick={onSkipConfirm}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/50 rounded hover:bg-amber-200 dark:hover:bg-amber-900/40 transition-colors"
              title="Munkafázis átugrása"
            >
              <SkipForward className="w-3 h-3" />
              Átugrom
            </button>
          )}
          {canUnskip && !mergeMode && (
            <button
              onClick={onUnskipConfirm}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Visszaállítás"
            >
              <RotateCcw className="w-3 h-3" />
              Visszaállít
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step row + inline confirm (combined) ────────────────────────────────────

function StepRowWithConfirm({
  step, idx, isNext, stepLabel, pathwayLabel, pathwayColor,
  mergedChildren, projection, rowBooking,
  confirmStepId, confirmAction, skipReason, saving,
  mergeMode, mergeSelected, onToggleMerge,
  onSkipConfirm, onUnskipConfirm, onDelete, onReopenConfirm,
  onSkip, onUnskip, onDeleteConfirm, onReopen, onCancel, onSkipReasonChange,
  onEditTiming, onUnmerge, onDeleteChild,
  episodeId, delegatePhaseId, setDelegatePhaseId,
}: {
  step: EpisodeStep; idx: number; isNext: boolean; stepLabel: string;
  pathwayLabel: string | null; pathwayColor: string;
  mergedChildren: EpisodeStep[];
  projection: StepProjectionInfo | null;
  rowBooking: RowBookingActions | null;
  confirmStepId: string | null; confirmAction: ConfirmAction | null;
  skipReason: string; saving: boolean;
  mergeMode: boolean; mergeSelected: boolean; onToggleMerge: () => void;
  onSkipConfirm: () => void; onUnskipConfirm: () => void; onDelete: () => void;
  onReopenConfirm: () => void;
  onSkip: () => void; onUnskip: () => void; onDeleteConfirm: (stepId: string) => void;
  onReopen: () => void;
  onCancel: () => void; onSkipReasonChange: (v: string) => void;
  onEditTiming: () => void; onUnmerge: () => void;
  onDeleteChild: (child: EpisodeStep) => void;
  episodeId: string;
  delegatePhaseId: string | null;
  setDelegatePhaseId: (id: string | null) => void;
}) {
  // A törlés-megerősítés a sorhoz tartozó összevont alfázisra is vonatkozhat —
  // azok nem külön sorként, hanem a szülő alatt jelennek meg.
  const confirmChild = mergedChildren.find((c) => c.id === confirmStepId) ?? null;
  const isConfirming = confirmStepId === step.id || confirmChild !== null;
  const deleteTarget = confirmChild ?? step;
  const deleteTargetLabel = confirmChild
    ? confirmChild.customLabel || confirmChild.treatmentLabel || confirmChild.stepCode.replace(/_/g, ' ')
    : stepLabel;
  const canDelegate = step.status === 'pending' || step.status === 'scheduled';
  const delegateOpen = delegatePhaseId === step.id;
  return (
    <div>
      <SortableStepRow
        step={step} idx={idx} isNext={isNext}
        stepLabel={stepLabel} pathwayLabel={pathwayLabel} pathwayColor={pathwayColor}
        mergedChildren={mergedChildren}
        projection={projection} rowBooking={rowBooking}
        onSkipConfirm={onSkipConfirm} onUnskipConfirm={onUnskipConfirm} onDelete={onDelete}
        onReopenConfirm={onReopenConfirm}
        mergeMode={mergeMode} mergeSelected={mergeSelected} onToggleMerge={onToggleMerge}
        onEditTiming={onEditTiming} onUnmerge={onUnmerge}
        onDeleteChild={onDeleteChild}
        canDelegate={canDelegate}
        delegateOpen={delegateOpen}
        onDelegateClick={() => setDelegatePhaseId(delegateOpen ? null : step.id)}
      />
      {delegateOpen && (
        <div className="ml-12 mb-2">
          <WorkPhaseTaskDelegateBlock
            episodeId={episodeId}
            workPhaseId={step.id}
            phaseLabel={stepLabel}
            onClose={() => setDelegatePhaseId(null)}
          />
        </div>
      )}
      {isConfirming && (
        <div className="mt-1 ml-12 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          {confirmAction === 'skip' && (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                Biztosan átugorja a(z) <strong>{stepLabel}</strong> munkafázist?
              </p>
              {rowBooking?.state === 'BOOKED' ? (
                <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">
                  Ehhez a munkafázishoz 1 jövőbeli foglalt időpont tartozik — az átugrással az időpont is lemondásra kerül.
                </p>
              ) : step.status === 'scheduled' ? (
                <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">
                  Ehhez a munkafázishoz foglalt időpont tartozik — az átugrással a jövőbeli időpont lemondásra kerül, a már megtörtént vizitet nem érinti.
                </p>
              ) : null}
              <input
                type="text" value={skipReason} onChange={(e) => onSkipReasonChange(e.target.value)}
                placeholder="Ok (opcionális, pl. már megtörtént)"
                className="w-full text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 mb-2"
              />
              <div className="flex items-center gap-2">
                <button onClick={onSkip} disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 disabled:opacity-50">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Átugrás
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Mégse</button>
              </div>
            </>
          )}
          {confirmAction === 'unskip' && (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">Visszaállítja a(z) <strong>{stepLabel}</strong> munkafázist várakozóra?</p>
              <div className="flex items-center gap-2">
                <button onClick={onUnskip} disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-600 text-white rounded text-xs font-medium hover:bg-gray-700 disabled:opacity-50">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Visszaállítás
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Mégse</button>
              </div>
            </>
          )}
          {confirmAction === 'reopen' && (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                Visszaállítja a(z) <strong>{stepLabel}</strong> kész munkafázist várakozóra? Indoklás szükséges.
              </p>
              <input
                type="text" value={skipReason} onChange={(e) => onSkipReasonChange(e.target.value)}
                placeholder="Indoklás (legalább 5 karakter, pl. tévedésből jelölve késznek)"
                className="w-full text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 mb-2"
              />
              <div className="flex items-center gap-2">
                <button onClick={onReopen} disabled={saving || skipReason.trim().length < 5}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-600 text-white rounded text-xs font-medium hover:bg-gray-700 disabled:opacity-50">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Visszaállítás várakozóra
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Mégse</button>
              </div>
            </>
          )}
          {confirmAction === 'delete' && (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                Biztosan elhagyja a(z) <strong>{deleteTargetLabel}</strong> munkafázist a tervből? Ez a művelet nem vonható vissza.
              </p>
              {deleteTarget.status === 'scheduled' && (
                <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">
                  Ehhez a munkafázishoz foglalt időpont tartozik — a törléssel az időpont is lemondásra kerül.
                </p>
              )}
              {deleteTarget.status === 'completed' && (
                <p className="text-sm text-amber-700 dark:text-amber-300 mb-2">
                  Ez a munkafázis teljesítettként van jelölve — törléssel a terv előzményéből is eltűnik.
                </p>
              )}
              {!confirmChild && mergedChildren.length > 0 && (
                <p className="text-sm text-violet-700 dark:text-violet-300 mb-2">
                  Az összevont {mergedChildren.length} alfázis nem törlődik: önálló terv-sorként marad meg.
                </p>
              )}
              <div className="flex items-center gap-2">
                <button onClick={() => onDeleteConfirm(deleteTarget.id)} disabled={saving}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 disabled:opacity-50">
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Elhagyás
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Mégse</button>
              </div>
            </>
          )}
          {confirmAction === 'timing' && (
            <TimingEditor
              step={step}
              mergedChildCount={mergedChildren.length}
              saving={saving}
              onCancel={onCancel}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Timing editor (inline) ───────────────────────────────────────────────────

function TimingEditor({ step, mergedChildCount, saving, onCancel }: {
  step: EpisodeStep;
  mergedChildCount: number;
  saving: boolean;
  onCancel: () => void;
}) {
  const [daysOffset, setDaysOffset] = useState(step.defaultDaysOffset);
  const [duration, setDuration] = useState(step.durationMinutes);
  const [localSaving, setLocalSaving] = useState(false);
  const { showToast } = useToast();

  const handleSave = async () => {
    setLocalSaving(true);
    try {
      const res = await fetch(`/api/episodes/${step.episodeId}/work-phases/${step.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ defaultDaysOffset: daysOffset, durationMinutes: duration }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      showToast('Időzítés frissítve', 'success');
      onCancel();
      window.dispatchEvent(new Event('episode-work-phases-reload'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setLocalSaving(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2 font-medium">Időzítés szerkesztése</p>
      {mergedChildCount > 0 && (
        <p className="text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-800 rounded-md px-2 py-1.5 mb-2">
          Összevont csoport: ez a percszám az <strong>egész</strong> egy időpontra eső blokkra vonatkozik
          (foglalható slot). A részlépések külön perce csak tájékoztató; szétbontás után külön állítható.
        </p>
      )}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Nap offset:</label>
          <input type="number" value={daysOffset} onChange={(e) => setDaysOffset(Math.max(0, parseInt(e.target.value) || 0))}
            min={0} className="w-16 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-center" />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Időtartam:</label>
          <input type="number" value={duration} onChange={(e) => setDuration(Math.max(5, parseInt(e.target.value) || 30))}
            min={5} step={5} className="w-16 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-center" />
          <span className="text-xs text-gray-400 dark:text-gray-500">perc</span>
        </div>
      </div>
      {/* WP-1.1: hosszú időtartam — halk inline hint, csak itt, a szerkesztő
          sorban (nem badge, nem összesítő). Nem blokkol semmit. */}
      {duration > LONG_DURATION_MINUTES && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
          Szokatlanul hosszú időtartam ({duration} perc) — ellenőrizze, hogy valóban egy alkalomra szánja.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button onClick={handleSave} disabled={saving || localSaving}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-medical-primary text-white rounded text-xs font-medium hover:bg-medical-primary-dark disabled:opacity-50">
          {(saving || localSaving) && <Loader2 className="w-3 h-3 animate-spin" />} Mentés
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">Mégse</button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EpisodeStepsManager({
  episodeId,
  patientId,
  carePathwayId,
  carePathwayName,
  episodePathways: initialEpisodePathways,
  onStepChanged,
  assignedProviderName,
  settingsPanel,
  refreshTrigger,
}: EpisodeStepsManagerProps) {
  const { showToast } = useToast();
  const [steps, setSteps] = useState<EpisodeStep[]>([]);
  const [stepLabels, setStepLabels] = useState<Map<string, string>>(new Map());
  const [catalogItems, setCatalogItems] = useState<StepCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [confirmStepId, setConfirmStepId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [, setReordering] = useState(false);
  const [episodePathways, setEpisodePathways] = useState<EpisodePathwayInfo[]>(initialEpisodePathways ?? []);
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Tervezett ütemezés (vetítés) — a lépéssorokba fésülve jelenik meg
  const [projections, setProjections] = useState<StepProjectionInfo[]>([]);
  const [projectionSummary, setProjectionSummary] = useState<StepProjectionSummary | null>(null);
  const [projectionBlockedReason, setProjectionBlockedReason] = useState<string | null>(null);

  // Merge mode
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const [delegatePhaseId, setDelegatePhaseId] = useState<string | null>(null);

  // Linked tooth treatments
  const [linkedTreatments, setLinkedTreatments] = useState<LinkedToothTreatment[]>([]);

  useEffect(() => { setMounted(true); }, []);

  // Reload steps on timing save / external appointment mutations. A vetítést
  // explicit is frissítjük: külső foglalás-változásnál (pl. időpont törlése a
  // Gyors foglalás listában) a lépés-szignatúra változatlan maradhat, a
  // vetített dátumok mégis elavulnak.
  useEffect(() => {
    const handler = () => { loadSteps(); loadProjections(); notifyPlanChanged(); };
    window.addEventListener('episode-work-phases-reload', handler);
    return () => window.removeEventListener('episode-work-phases-reload', handler);
  });

  // Step adder panel
  const [adderOpen, setAdderOpen] = useState(false);
  const [adderTab, setAdderTab] = useState<AdderTab>('catalog');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [addingStep, setAddingStep] = useState(false);

  // Free-text step form
  const [freeLabel, setFreeLabel] = useState('');
  const [freePool, setFreePool] = useState('work');
  const [freeDuration, setFreeDuration] = useState(30);

  const hasMultiplePathways = episodePathways.length > 1;

  const pathwayColorMap = useMemo(() => {
    const m = new Map<string, string>();
    episodePathways.forEach((ep, idx) => {
      m.set(ep.id, PATHWAY_COLORS[idx % PATHWAY_COLORS.length]);
    });
    return m;
  }, [episodePathways]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ─── Data loading ────────────────────────────────────────────────────────

  const loadSteps = useCallback(async () => {
    try {
      // WP-0.7: mellékhatás-mentes olvasás. Korábban a mutáló POST .../generate
      // töltötte a listát — a kártya megnyitása írt a DB-be, és a törölt
      // fázisokat visszatette. A generálás az aktiválás / sablon-alkalmazás
      // dolga; ez itt csak GET.
      const res = await fetch(`/api/episodes/${episodeId}/work-phases`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Nem sikerült betölteni');
      }
      const data = await res.json();
      setSteps(
        mapWorkPhasesResponse(
          data.workPhases ?? data.steps,
          data.lostAppointmentWorkPhaseIds
        )
      );
    } catch (e) {
      console.error('Error loading episode steps:', e);
    }
  }, [episodeId]);

  const loadLabels = useCallback(async () => {
    try {
      const res = await fetch('/api/step-catalog', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const items: StepCatalogItem[] = (data.items ?? data.steps ?? []).map((s: { stepCode: string; labelHu: string }) => ({
          stepCode: s.stepCode,
          labelHu: s.labelHu,
        }));
        setCatalogItems(items);
        const map = new Map<string, string>();
        items.forEach((s) => map.set(s.stepCode, s.labelHu));
        setStepLabels(map);
      }
    } catch { /* non-critical */ }
  }, []);

  const loadEpisodePathways = useCallback(async () => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setEpisodePathways(data.episode?.episodePathways ?? []);
      }
    } catch { /* non-critical */ }
  }, [episodeId]);

  const loadLinkedTreatments = useCallback(async () => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/linked-tooth-treatments`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setLinkedTreatments(data.treatments ?? []);
      }
    } catch { /* non-critical */ }
  }, [episodeId]);

  // Egyidejű hívások összevonása: a signature-effect és az explicit frissítők
  // (booking-callback, reload-esemény) ugyanabban a körben duplán kérnék.
  const projectionsInFlightRef = useRef<Promise<void> | null>(null);
  const loadProjections = useCallback(async () => {
    if (projectionsInFlightRef.current) return projectionsInFlightRef.current;
    const run = (async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}/step-projections`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.blocked) {
          setProjections([]);
          setProjectionSummary(null);
          setProjectionBlockedReason(data.blockedReason ?? 'Ismeretlen ok');
          return;
        }
        setProjections(data.steps ?? []);
        setProjectionSummary(data.summary ?? null);
        setProjectionBlockedReason(null);
      } catch { /* nem kritikus — a lista dátumok nélkül is használható */ }
    })();
    projectionsInFlightRef.current = run.finally(() => {
      projectionsInFlightRef.current = null;
    });
    return projectionsInFlightRef.current;
  }, [episodeId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSteps(), loadLabels(), loadEpisodePathways(), loadLinkedTreatments()]).finally(() => setLoading(false));
  }, [carePathwayId, refreshTrigger, loadSteps, loadLabels, loadEpisodePathways, loadLinkedTreatments]);

  // ─── Sor-szintű foglalás (worklist-motor) ────────────────────────────────

  // Foglalás/kész-jelölés után a lépéslistát ÉS a vetítést is újratöltjük.
  // A vetítés explicit kell: áthelyezésnél (scheduled→scheduled) a
  // planSignature nem változik, a 📅 dátumok mégis elavulnak.
  const handleBookingChanged = useCallback(() => {
    void loadSteps();
    void loadProjections();
    onStepChanged?.();
  }, [loadSteps, loadProjections, onStepChanged]);

  const booking = useWorkPhaseBooking({
    patientId: patientId ?? null,
    episodeId,
    onChanged: handleBookingChanged,
  });
  const bookingRefresh = booking.refresh;

  // Terv-kártyás mutáció (skip/törlés/hozzáadás/átrendezés…) után a worklist
  // sorai is frissülnek, hogy a Foglalás gombok állapota ne maradjon le.
  const notifyPlanChanged = useCallback(() => {
    onStepChanged?.();
    void bookingRefresh();
  }, [onStepChanged, bookingRefresh]);

  // refreshTrigger-bump (pl. kezelési út mentése) → worklist újratöltés is.
  // Az első futást kihagyjuk: mountkor a hook maga fetch-el.
  const skipFirstBookingRefresh = useRef(true);
  useEffect(() => {
    if (skipFirstBookingRefresh.current) {
      skipFirstBookingRefresh.current = false;
      return;
    }
    void bookingRefresh();
  }, [refreshTrigger, bookingRefresh]);

  const handlePlanStartSaved = useCallback(() => {
    void bookingRefresh();
    void loadProjections();
    onStepChanged?.();
  }, [bookingRefresh, loadProjections, onStepChanged]);

  // ─── Step actions ────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await loadSteps();
      showToast('Munkafázisok generálva', 'success');
    } catch {
      showToast('Nem sikerült generálni a munkafázisokat', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleSkip = async (stepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'skipped', reason: skipReason || 'Manuálisan átugorva' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      const row = data.workPhase ?? data.step;
      setSteps((prev) => prev.map((s) => (s.id === stepId ? mapWorkPhaseApiToEpisodeStep(row) : s)));
      setConfirmStepId(null);
      setConfirmAction(null);
      setSkipReason('');
      const cancelled = typeof data.cancelledAppointments === 'number' ? data.cancelledAppointments : 0;
      showToast(
        cancelled > 0
          ? `Munkafázis átugorva, ${cancelled} jövőbeli foglalt időpont lemondva`
          : 'Munkafázis átugorva',
        'success'
      );
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUnskip = async (stepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'pending', reason: 'Visszaállítva várakozóra' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      const row = data.workPhase ?? data.step;
      setSteps((prev) => prev.map((s) => (s.id === stepId ? mapWorkPhaseApiToEpisodeStep(row) : s)));
      setConfirmStepId(null);
      setConfirmAction(null);
      showToast('Munkafázis visszaállítva', 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSaving(false);
    }
  };

  /** „Mégsem kész" — completed munkafázis visszaállítása várakozóra, kötelező indoklással. */
  const handleReopen = async (stepId: string) => {
    const reason = skipReason.trim();
    if (reason.length < 5) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'pending', reason }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      const row = data.workPhase ?? data.step;
      setSteps((prev) => prev.map((s) => (s.id === stepId ? mapWorkPhaseApiToEpisodeStep(row) : s)));
      setConfirmStepId(null);
      setConfirmAction(null);
      setSkipReason('');
      showToast('Munkafázis visszaállítva várakozóra', 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (stepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/${stepId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json().catch(() => ({} as { cancelledAppointments?: number }));
      setSteps((prev) =>
        prev
          .filter((s) => s.id !== stepId)
          // Összevont blokk szülőjének törlésekor a gyerekek önálló sorrá válnak
          // (a szerveren FK ON DELETE SET NULL) — a lista ne rejtse el őket.
          .map((s) => (s.mergedIntoStepId === stepId ? { ...s, mergedIntoStepId: null } : s))
      );
      setConfirmStepId(null);
      setConfirmAction(null);
      const cancelled = typeof data.cancelledAppointments === 'number' ? data.cancelledAppointments : 0;
      showToast(
        cancelled > 0
          ? `Munkafázis törölve, ${cancelled} foglalt időpont lemondva`
          : 'Munkafázis törölve',
        'success'
      );
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a törlésnél', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Reorder (arrows) ───────────────────────────────────────────────────

  const persistReorder = async (newPrimarySteps: EpisodeStep[]) => {
    setReordering(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stepIds: newPrimarySteps.map((s) => s.id) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps(mapWorkPhasesResponse(data.workPhases ?? data.steps));
      if (data.partial) {
        // A sorrend mentve, de az időpont-átkötés nem sikerült — ne maradjon néma.
        showToast(
          typeof data.message === 'string' && data.message
            ? data.message
            : 'A sorrend mentve, de az időpontok átkötése nem sikerült maradéktalanul.',
          'info',
          8000
        );
      }
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba az átrendezésnél', 'error');
      await loadSteps();
    } finally {
      setReordering(false);
    }
  };

  // ─── DnD reorder ────────────────────────────────────────────────────────

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = primarySteps.findIndex((s) => s.id === active.id);
    const newIdx = primarySteps.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const newSteps = [...primarySteps];
    const [removed] = newSteps.splice(oldIdx, 1);
    newSteps.splice(newIdx, 0, removed);
    persistReorder(newSteps);
  };

  // ─── Merge / Unmerge ────────────────────────────────────────────────────

  const handleMergeConfirm = async () => {
    if (mergeSelection.size < 2) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ stepIds: Array.from(mergeSelection) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps(mapWorkPhasesResponse(data.workPhases ?? data.steps));
      setMergeMode(false);
      setMergeSelection(new Set());
      showToast('Munkafázisok összevonva', 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba az összevonásnál', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUnmerge = async (primaryStepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/${primaryStepId}/unmerge`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps(mapWorkPhasesResponse(data.workPhases ?? data.steps));
      showToast('Összevonás felbontva', 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a szétbontásnál', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Add tooth treatment to steps ──────────────────────────────────────

  const addToothTreatmentStep = async (tt: LinkedToothTreatment) => {
    setAddingStep(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/from-tooth-treatment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ toothTreatmentId: tt.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      setSteps(mapWorkPhasesResponse(data.workPhases ?? data.steps));
      await loadLinkedTreatments();
      showToast(`${tt.labelHu} – ${tt.toothNumber} hozzáadva`, 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a hozzáadásnál', 'error');
    } finally {
      setAddingStep(false);
    }
  };

  // ─── Step adder ─────────────────────────────────────────────────────────

  const addCatalogStep = async (item: StepCatalogItem) => {
    setAddingStep(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workPhaseCode: item.stepCode, pool: 'work' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      const row = data.workPhase ?? data.step;
      setSteps((prev) => [...prev, mapWorkPhaseApiToEpisodeStep(row)]);
      showToast(`${item.labelHu} hozzáadva`, 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a hozzáadásnál', 'error');
    } finally {
      setAddingStep(false);
    }
  };

  const addFreeTextStep = async () => {
    if (!freeLabel.trim()) return;
    setAddingStep(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          label: freeLabel.trim(),
          pool: freePool,
          durationMinutes: freeDuration,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      const row = data.workPhase ?? data.step;
      setSteps((prev) => [...prev, mapWorkPhaseApiToEpisodeStep(row)]);
      setFreeLabel('');
      setFreeDuration(30);
      showToast('Egyedi munkafázis hozzáadva', 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a hozzáadásnál', 'error');
    } finally {
      setAddingStep(false);
    }
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const getStepLabel = (step: EpisodeStep): string => {
    if (step.customLabel) return step.customLabel;
    if (step.treatmentLabel && step.toothNumber) return `${step.treatmentLabel} – ${step.toothNumber}`;
    if (step.treatmentLabel) return step.treatmentLabel;
    return stepLabels.get(step.stepCode) ?? step.stepCode.replace(/_/g, ' ');
  };

  const getPathwayLabel = (sourceId: string | null): string | null => {
    if (!sourceId) return null;
    const pw = episodePathways.find((p) => p.id === sourceId);
    if (!pw) return null;
    const jawSuffix = pw.jaw ? ` (${JAW_SHORT[pw.jaw] ?? pw.jaw})` : '';
    if (!hasMultiplePathways && !pw.jaw) return null;
    return pw.pathwayName + jawSuffix;
  };

  const getPathwayColor = (sourceId: string | null): string => {
    if (!sourceId) return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
    return pathwayColorMap.get(sourceId) ?? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
  };

  const filteredCatalog = useMemo(() => {
    if (!catalogSearch.trim()) return catalogItems;
    const q = catalogSearch.toLowerCase();
    return catalogItems.filter(
      (item) => item.labelHu.toLowerCase().includes(q) || item.stepCode.toLowerCase().includes(q)
    );
  }, [catalogItems, catalogSearch]);

  const primarySteps = useMemo(() => steps.filter((s) => !s.mergedIntoStepId), [steps]);
  const mergedChildrenMap = useMemo(() => {
    const m = new Map<string, EpisodeStep[]>();
    for (const s of steps) {
      if (s.mergedIntoStepId) {
        const arr = m.get(s.mergedIntoStepId) ?? [];
        arr.push(s);
        m.set(s.mergedIntoStepId, arr);
      }
    }
    return m;
  }, [steps]);

  const nextPendingIndex = primarySteps.findIndex((s) => s.status === 'pending' || s.status === 'scheduled');
  const stepIds = useMemo(() => primarySteps.map((s) => s.id), [primarySteps]);

  const hasPathways = carePathwayId || (episodePathways && episodePathways.length > 0);
  const availableToothTreatments = useMemo(
    () => linkedTreatments.filter((t) => !(t.inWorkPhases ?? t.inSteps)),
    [linkedTreatments]
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  // Re-validate the plan whenever a step's identity, status, pool, duration or
  // offset changes (az offset a vetítési ablakokat tolja el).
  const planSignature = useMemo(
    () => steps.map((s) => `${s.id}:${s.status}:${s.pool}:${s.durationMinutes}:${s.defaultDaysOffset}`).join('|'),
    [steps]
  );

  // A vetítést a kezdeti betöltés után és minden lépés-mutáció (signature-váltás)
  // után frissítjük — betöltés közben kihagyva, hogy mountkor ne fusson duplán.
  useEffect(() => {
    if (loading) return;
    loadProjections();
  }, [loading, planSignature, loadProjections]);

  const projectionByPhaseId = useMemo(() => {
    const m = new Map<string, StepProjectionInfo>();
    for (const p of projections) {
      if (p.workPhaseId) m.set(String(p.workPhaseId), p);
    }
    return m;
  }, [projections]);

  const pathwayDisplayName = useMemo(() => {
    if (episodePathways.length > 0) {
      return episodePathways
        .map((p) => p.pathwayName + (p.jaw ? ` (${JAW_SHORT[p.jaw] ?? p.jaw})` : ''))
        .join(', ');
    }
    return carePathwayName ?? null;
  }, [episodePathways, carePathwayName]);

  const nonSkippedCount = primarySteps.filter((s) => s.status !== 'skipped').length;
  const completedCount = primarySteps.filter((s) => s.status === 'completed').length;
  const progressPct = nonSkippedCount > 0 ? (completedCount / nonSkippedCount) * 100 : 0;
  const completionText = projectionSummary ? estimatedCompletionText(projectionSummary) : null;

  /** Terv-sor → worklist-akciók (workPhaseId-n párosítva). */
  const buildRowBooking = (step: EpisodeStep): RowBookingActions | null => {
    if (!booking.enabled) return null;
    const item = booking.itemByWorkPhaseId.get(step.id);
    if (!item) return null;
    return {
      state: booking.rowStateFor(item),
      onBook: () => booking.openSlotPicker(item),
      onLink: () => booking.openLinkAppointment(item),
      onMarkDoneRetro: () => booking.openMarkCompleteRetro(item),
      onMarkUnsuccessful: () => booking.openMarkUnsuccessful(item),
    };
  };

  const pendingCount = primarySteps.filter((s) => s.status === 'pending').length;
  const showConvertAllInAdder =
    booking.enabled && booking.hasReady && pendingCount >= 2 && !booking.chainBookingRequired;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Kezelési terv</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Az epizód munkafázisai, állapotuk és tervezett ütemezésük
          </p>
        </div>
        <div className="flex items-center gap-2">
          {steps.length > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length}/{steps.length} kész
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Betöltés…</span>
            </div>
          ) : (
            <>
              {/* ─── Terv-meta: kezelési út + felelős orvos (a terv beállításai) ─── */}
              {(assignedProviderName !== undefined || settingsPanel) && (
                <div className="mb-3 pb-3 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2 flex-wrap text-sm text-gray-700 dark:text-gray-300">
                    <UserRound className="w-4 h-4 text-medical-primary shrink-0" />
                    <span>
                      Felelős orvos:{' '}
                      <strong className="text-gray-900 dark:text-gray-100">
                        {assignedProviderName || '— nincs beállítva'}
                      </strong>
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      · Sablon:{' '}
                      <strong className="text-gray-700 dark:text-gray-200">
                        {pathwayDisplayName || '— nincs alkalmazva'}
                      </strong>
                    </span>
                    {settingsPanel && (
                      <button
                        type="button"
                        onClick={() => setSettingsOpen((v) => !v)}
                        className="ml-auto inline-flex items-center gap-1 text-medical-primary hover:underline text-sm font-medium shrink-0"
                        aria-expanded={settingsOpen}
                      >
                        Beállítások módosítása
                        <ChevronRight className={`w-4 h-4 transition-transform ${settingsOpen ? 'rotate-90' : ''}`} />
                      </button>
                    )}
                  </div>
                  {settingsOpen && settingsPanel && <div className="mt-2">{settingsPanel}</div>}
                  {booking.enabled && booking.planStartDateKnown && (
                    <div className="mt-2">
                      <PlanStartDateControl
                        episodeId={episodeId}
                        planStartDate={booking.planStartDate}
                        onSaved={handlePlanStartSaved}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ─── Foglalási állapot: lánc-ajánlat, blokk ─────────────── */}
              {/* WP-1.2: az EpisodeIntegrityBanner kikerült a kartonról — a
                  javítható integritás-ügyeket a szerver olvasáskor magától
                  rendezi, a maradék az /admin „Ütemezési integritás" fülön él. */}
              {booking.enabled && (
                <div className="mb-3 empty:mb-0 empty:hidden space-y-2">
                  {booking.error && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Foglalási műveletek betöltése sikertelen.</span>
                      <button
                        type="button"
                        onClick={() => void booking.refresh()}
                        className="underline font-medium"
                      >
                        Újra
                      </button>
                    </div>
                  )}
                  {booking.loading && !booking.hasItems && !booking.error && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 px-1">
                      Foglalási lehetőségek betöltése…
                    </p>
                  )}
                  {booking.chainBookingRequired && (
                    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm text-blue-900 dark:text-blue-200">
                      <p className="font-semibold">Több lépés is foglalható egyszerre</p>
                      <p className="mt-1 text-blue-800/90 dark:text-blue-300/90">
                        {pendingCount >= 2
                          ? `Az epizód következő ${pendingCount} lépése egy menetben lefoglalható, a láncolást a rendszer számolja.`
                          : 'Az epizód következő lépései egy menetben lefoglalhatók, a láncolást a rendszer számolja.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => void booking.convertAll()}
                        disabled={booking.convertAllBusy}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-medical-primary text-white rounded-md text-xs font-semibold hover:bg-medical-primary-dark disabled:opacity-50"
                      >
                        {booking.convertAllBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                        {booking.convertAllBusy ? 'Lefoglalás…' : 'Összes szükséges időpont lefoglalása'}
                      </button>
                    </div>
                  )}
                  {booking.convertAllMessage && (
                    <div
                      className={`text-sm px-3 py-2 rounded ${
                        booking.convertAllMessage.type === 'success'
                          ? 'bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300'
                          : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
                      }`}
                    >
                      {booking.convertAllMessage.text}
                      <button
                        type="button"
                        onClick={booking.dismissConvertAllMessage}
                        className="ml-2 underline"
                      >
                        Elrejt
                      </button>
                      {booking.convertAllMessage.type === 'error' && booking.hasReady && (
                        <button
                          type="button"
                          onClick={() => void booking.convertAll()}
                          disabled={booking.convertAllBusy}
                          className="mt-2 block px-3 py-1.5 bg-medical-primary text-white rounded-md text-xs font-semibold hover:bg-medical-primary-dark disabled:opacity-50"
                        >
                          {booking.convertAllBusy ? 'Lefoglalás…' : 'Összes szükséges időpont lefoglalása'}
                        </button>
                      )}
                    </div>
                  )}
                  {booking.blockedItem?.blockedReason &&
                    booking.blockedItem.blockedCode !== 'NO_CARE_PATHWAY' && (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Foglalás blokkolva: {booking.blockedItem.blockedReason}</span>
                      </div>
                    )}
                </div>
              )}

              {/* ─── Tervezett ütemezés — összefoglaló ────────────────── */}
              {projectionBlockedReason && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Nem tudunk ütemezést becsülni: {projectionBlockedReason}</span>
                </div>
              )}
              {primarySteps.length > 0 && (
                <div className="mb-4">
                  <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-medical-primary rounded-full transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  {(completionText || (projectionSummary?.nextStepWaitDays != null && projectionSummary.nextStepWaitDays > 0)) && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 flex-wrap">
                      <CalendarDays className="w-4 h-4 text-medical-primary shrink-0" />
                      {completionText && (
                        <span>
                          Becsült befejezés:{' '}
                          <strong className="text-gray-900 dark:text-gray-100">{completionText}</strong>
                        </span>
                      )}
                      {projectionSummary?.nextStepWaitDays != null && projectionSummary.nextStepWaitDays > 0 && (
                        <span>· következő lépés {formatWaitDays(projectionSummary.nextStepWaitDays)}</span>
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* ─── Nincs sablon alkalmazva — a lista ezért üres ─────── */}
              {!hasPathways && primarySteps.length === 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-300">
                  Nincs kezelési terv sablon alkalmazva az epizódra, ezért a munkafázis-lista üres.
                  {settingsPanel && ' Sablont a fenti „Beállítások módosítása" gombbal választhat.'}
                </div>
              )}

              {/* ─── Terv-validáció (WP3, WP-1.1) ─────────────────────── */}
              {/* Üres terv (nincs aktív lépés) → a validációs panel helyett a
                  kártya üres-állapota jelez; badge sehol nem jelenik meg.
                  A szerverrel (batch/GET mergedFilter) egyezően csak a nem
                  összevont (primary) sorokat számoljuk. */}
              {primarySteps.some((s) => s.status !== 'skipped') ? (
                <PlanValidationPanel episodeId={episodeId} patientId={patientId} signature={planSignature} />
              ) : steps.length > 0 ? (
                <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3 text-sm text-gray-600 dark:text-gray-400">
                  A kezelési terv üres — minden munkafázis kihagyva. Új lépést a „Munkafázis
                  hozzáadása" gombbal vehet fel.
                </div>
              ) : null}

              {/* ─── Step adder panel ─────────────────────────────────── */}
              <div className="mb-4">
                {!adderOpen ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {steps.length === 0 && hasPathways && (
                      <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-medical-primary text-white rounded-md text-sm hover:bg-medical-primary-dark disabled:opacity-50"
                      >
                        {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <Layers className="w-3.5 h-3.5" />
                        Munkafázisok generálása sablonból
                      </button>
                    )}
                    <button
                      onClick={() => { setAdderTab('catalog'); setAdderOpen(true); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-md text-sm hover:border-medical-primary hover:text-medical-primary transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Munkafázis hozzáadása
                    </button>
                    {showConvertAllInAdder && (
                      <button
                        type="button"
                        onClick={() => void booking.convertAll()}
                        disabled={booking.convertAllBusy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 dark:border-gray-700 text-medical-primary rounded-md text-sm hover:border-medical-primary disabled:opacity-50 transition-colors"
                        title="A hátralévő munkafázisok időpontjainak lefoglalása egy lépésben"
                      >
                        {booking.convertAllBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {booking.convertAllBusy ? 'Lefoglalás…' : 'Összes szükséges időpont lefoglalása'}
                      </button>
                    )}
                    {primarySteps.length >= 2 && (
                      <button
                        onClick={() => { setMergeMode(!mergeMode); setMergeSelection(new Set()); }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                          mergeMode
                            ? 'bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700'
                            : 'border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-violet-400 hover:text-violet-600'
                        }`}
                      >
                        <Merge className="w-3.5 h-3.5" />
                        {mergeMode ? 'Összevonás mód' : 'Összevonás'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-3 bg-gray-50/50 dark:bg-gray-800/60">
                    {/* Tab switcher */}
                    <div className="flex items-center gap-1 mb-3 flex-wrap">
                      <button
                        onClick={() => setAdderTab('catalog')}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          adderTab === 'catalog'
                            ? 'bg-medical-primary text-white'
                            : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        <FileText className="w-3 h-3" />
                        Katalógusból
                      </button>
                      {availableToothTreatments.length > 0 && (
                        <button
                          onClick={() => setAdderTab('tooth')}
                          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                            adderTab === 'tooth'
                              ? 'bg-teal-600 text-white'
                              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          }`}
                        >
                          🦷 Fogkezelés
                        </button>
                      )}
                      <div className="flex-1" />
                      <button
                        onClick={() => setAdderOpen(false)}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1"
                      >
                        Bezárás
                      </button>
                    </div>

                    {/* Catalog tab */}
                    {adderTab === 'catalog' && (
                      <div>
                        <div className="relative mb-2">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                          <input
                            type="text"
                            value={catalogSearch}
                            onChange={(e) => setCatalogSearch(e.target.value)}
                            placeholder="Katalógus keresése…"
                            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-md"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {filteredCatalog.length === 0 ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400 py-2 text-center">Nincs találat</p>
                          ) : (
                            filteredCatalog.map((item) => (
                              <button
                                key={item.stepCode}
                                onClick={() => addCatalogStep(item)}
                                disabled={addingStep}
                                className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-white dark:hover:bg-gray-800 hover:shadow-sm transition-all text-sm disabled:opacity-50 group"
                              >
                                <Plus className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 group-hover:text-medical-primary shrink-0" />
                                <span className="font-medium text-gray-800 dark:text-gray-200 group-hover:text-medical-primary">{item.labelHu}</span>
                                <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto shrink-0">{item.stepCode}</span>
                              </button>
                            ))
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setAdderTab('freetext')}
                          className="mt-2 text-xs text-gray-500 dark:text-gray-400 hover:text-medical-primary inline-flex items-center gap-1"
                        >
                          <PenLine className="w-3 h-3" />
                          Haladó: egyedi megnevezésű munkafázis
                        </button>
                      </div>
                    )}

                    {/* Free text tab */}
                    {adderTab === 'freetext' && (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setAdderTab('catalog')}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-medical-primary"
                        >
                          ← Vissza a katalógushoz
                        </button>
                        <input
                          type="text"
                          value={freeLabel}
                          onChange={(e) => setFreeLabel(e.target.value)}
                          placeholder="Munkafázis megnevezése (pl. Ideiglenes korona)"
                          className="w-full text-sm border border-gray-300 dark:border-gray-700 rounded-md px-3 py-1.5"
                        />
                        <div className="flex items-center gap-2">
                          <select
                            value={freePool}
                            onChange={(e) => setFreePool(e.target.value)}
                            className="text-sm border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5"
                          >
                            <option value="consult">Konzultáció</option>
                            <option value="work">Munkafázis</option>
                            <option value="control">Kontroll</option>
                          </select>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={freeDuration}
                              onChange={(e) => setFreeDuration(Math.max(5, parseInt(e.target.value) || 30))}
                              min={5}
                              step={5}
                              className="w-16 text-sm border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 text-center"
                            />
                            <span className="text-xs text-gray-500 dark:text-gray-400">perc</span>
                          </div>
                          <button
                            onClick={addFreeTextStep}
                            disabled={!freeLabel.trim() || addingStep}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-medical-primary text-white rounded-md text-sm hover:bg-medical-primary-dark disabled:opacity-50 ml-auto"
                          >
                            {addingStep ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                            Hozzáadás
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tooth treatment tab */}
                    {adderTab === 'tooth' && (
                      <div>
                        {availableToothTreatments.length === 0 ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400 py-2 text-center">Nincs hozzáadható fogkezelés (mindegyik már a munkafázis-sorban van)</p>
                        ) : (
                          <div className="max-h-48 overflow-y-auto space-y-0.5">
                            {availableToothTreatments.map((tt) => (
                              <button
                                key={tt.id}
                                onClick={() => addToothTreatmentStep(tt)}
                                disabled={addingStep}
                                className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-white dark:hover:bg-gray-800 hover:shadow-sm transition-all text-sm disabled:opacity-50 group"
                              >
                                <Plus className="w-3.5 h-3.5 text-teal-400 dark:text-teal-500 group-hover:text-teal-600 shrink-0" />
                                <span className="font-medium text-gray-800 dark:text-gray-200 group-hover:text-teal-700">{tt.labelHu}</span>
                                <span className="text-xs text-teal-600 dark:text-teal-300 ml-1">fog #{tt.toothNumber}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ─── Merge mode toolbar ──────────────────────────────── */}
              {mergeMode && (
                <div className="mb-3 flex items-center gap-2 p-2 rounded-lg bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800">
                  <Merge className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                  <span className="text-sm text-violet-700 dark:text-violet-300">Jelölje ki a munkafázisokat, amelyeket egy időpontra szeretne összevonni.</span>
                  <div className="flex-1" />
                  <button
                    onClick={handleMergeConfirm}
                    disabled={mergeSelection.size < 2 || saving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded-md text-xs font-medium hover:bg-violet-700 disabled:opacity-50"
                  >
                    {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                    Összevonás ({mergeSelection.size})
                  </button>
                  <button
                    onClick={() => { setMergeMode(false); setMergeSelection(new Set()); }}
                    className="px-2 py-1 text-xs text-violet-600 dark:text-violet-300 hover:text-violet-800"
                  >
                    Mégse
                  </button>
                </div>
              )}

              {/* ─── Step list with DnD ──────────────────────────────── */}
              {primarySteps.length === 0 ? (
                hasPathways ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Még nincsenek munkafázisok. Adjon hozzá a fenti űrlapon.</p>
                ) : null
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Húzza a munkafázisokat a kívánt sorrendbe. A kukával elhagyhatja a felesleges elemeket.
                  </p>
                  {mounted ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
                    <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
                      {primarySteps.map((step, idx) => (
                        <StepRowWithConfirm
                          key={step.id}
                          step={step}
                          idx={idx}
                          isNext={idx === nextPendingIndex}
                          stepLabel={getStepLabel(step)}
                          pathwayLabel={getPathwayLabel(step.sourceEpisodePathwayId)}
                          pathwayColor={getPathwayColor(step.sourceEpisodePathwayId)}
                          mergedChildren={mergedChildrenMap.get(step.id) ?? []}
                          projection={projectionByPhaseId.get(step.id) ?? null}
                          rowBooking={buildRowBooking(step)}
                          confirmStepId={confirmStepId}
                          confirmAction={confirmAction}
                          skipReason={skipReason}
                          saving={saving}
                          mergeMode={mergeMode}
                          mergeSelected={mergeSelection.has(step.id)}
                          onToggleMerge={() => {
                            setMergeSelection((prev) => {
                              const next = new Set(prev);
                              if (next.has(step.id)) next.delete(step.id); else next.add(step.id);
                              return next;
                            });
                          }}
                          onSkipConfirm={() => { setConfirmStepId(step.id); setConfirmAction('skip'); setSkipReason(''); }}
                          onUnskipConfirm={() => { setConfirmStepId(step.id); setConfirmAction('unskip'); }}
                          onDelete={() => { setConfirmStepId(step.id); setConfirmAction('delete'); }}
                          onReopenConfirm={() => { setConfirmStepId(step.id); setConfirmAction('reopen'); setSkipReason(''); }}
                          onSkip={() => handleSkip(step.id)}
                          onUnskip={() => handleUnskip(step.id)}
                          onDeleteConfirm={(id) => handleDelete(id)}
                          onReopen={() => handleReopen(step.id)}
                          onCancel={() => { setConfirmStepId(null); setConfirmAction(null); }}
                          onSkipReasonChange={setSkipReason}
                          onEditTiming={() => { setConfirmStepId(step.id); setConfirmAction('timing'); }}
                          onUnmerge={() => handleUnmerge(step.id)}
                          onDeleteChild={(child) => { setConfirmStepId(child.id); setConfirmAction('delete'); }}
                          episodeId={episodeId}
                          delegatePhaseId={delegatePhaseId}
                          setDelegatePhaseId={setDelegatePhaseId}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                  ) : (
                    <div className="animate-pulse space-y-2">
                      {primarySteps.map((_, i) => (
                        <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded-lg" />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {booking.enabled && <WorkPhaseBookingModals api={booking} />}
    </div>
  );
}
