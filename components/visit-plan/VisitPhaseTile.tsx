'use client';

/**
 * WP-4.3 — kezelés-„kocka": egy munkafázis (primary EWP sor) megjelenítése az
 * alkalom-kártyán belül. A korábbi terv-sor (SortableStepRow) utódja:
 * - mutatja a hatókört (fogszámok vagy állcsont), státuszt, ütemezést;
 * - a meglévő sor-műveletek (foglalás, skip, törlés, időzítés, delegálás,
 *   összevonás-felbontás) változatlanul elérhetők;
 * - draggable a vizitek közti áthúzáshoz, ÉS van nem-drag alternatíva
 *   („Áthelyezés másik alkalomba" menü);
 * - az összevont (merged) csoport EGY kockaként jelenik meg (a gyerekek a
 *   kockán belül, listaként) — a csoport együtt mozog alkalmak között.
 */
import { useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import {
  Loader2, SkipForward, RotateCcw, Trash2, Merge, Unlink, Calendar,
  SendHorizontal, AlertTriangle, CalendarPlus, CalendarClock, CalendarX2,
  Link2, Undo2, GripVertical,
} from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { WorkPhaseTaskDelegateBlock } from '../WorkPhaseTaskDelegateBlock';
import { LONG_DURATION_MINUTES } from '@/lib/treatment-plan-validation';
import type { WorklistRowState } from '@/lib/worklist-types';
import {
  type ConfirmAction,
  type EpisodeStep,
  type EpisodeVisit,
  type StepProjectionInfo,
  formatShortDate,
  formatWaitDays,
  phaseScopeText,
  poolLabels,
  statusConfig,
} from './visit-plan-types';
import { MoveToVisitMenu } from './MoveToVisitMenu';

/** Terv-sorhoz párosított worklist-foglalási akciók (useWorkPhaseBooking-ból). */
export interface RowBookingActions {
  state: WorklistRowState;
  onBook: () => void;
  onLink: () => void;
  onMarkDoneRetro: () => void;
  onMarkUnsuccessful: () => void;
}

export interface VisitPhaseTileProps {
  step: EpisodeStep;
  /** Globális sorszám (a teljes terv alkalom-sorrendjében). */
  idx: number;
  isNext: boolean;
  stepLabel: string;
  pathwayLabel: string | null;
  pathwayColor: string;
  mergedChildren: EpisodeStep[];
  projection: StepProjectionInfo | null;
  rowBooking: RowBookingActions | null;
  confirmStepId: string | null;
  confirmAction: ConfirmAction | null;
  skipReason: string;
  saving: boolean;
  mergeMode: boolean;
  mergeSelected: boolean;
  onToggleMerge: () => void;
  onSkipConfirm: () => void;
  onUnskipConfirm: () => void;
  onDelete: () => void;
  onReopenConfirm: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  onDeleteConfirm: (stepId: string) => void;
  onReopen: () => void;
  onCancel: () => void;
  onSkipReasonChange: (v: string) => void;
  onEditTiming: () => void;
  onUnmerge: () => void;
  onDeleteChild: (child: EpisodeStep) => void;
  episodeId: string;
  delegatePhaseId: string | null;
  setDelegatePhaseId: (id: string | null) => void;
  /** Vizit-áthelyezés (nem-drag alternatíva). */
  visits: EpisodeVisit[];
  visitOptionLabel: (visit: EpisodeVisit, index: number) => string;
  onMoveToVisit: (step: EpisodeStep, target: string | 'new') => void;
  /** Drag kikapcsolása (pl. merge-módban). */
  dragDisabled?: boolean;
}

// ─── A kocka törzse ──────────────────────────────────────────────────────────

function PhaseTileBody({
  step, idx, isNext, stepLabel, pathwayLabel, pathwayColor,
  mergedChildren, projection, rowBooking,
  onSkipConfirm, onUnskipConfirm, onDelete, onReopenConfirm,
  mergeMode, mergeSelected, onToggleMerge,
  onEditTiming, onUnmerge, canDelegate, onDelegateClick, delegateOpen,
  onDeleteChild,
  visits, visitOptionLabel, onMoveToVisit, dragDisabled, saving,
}: Omit<
  VisitPhaseTileProps,
  | 'confirmStepId' | 'confirmAction' | 'skipReason'
  | 'onSkip' | 'onUnskip' | 'onDeleteConfirm' | 'onReopen' | 'onCancel'
  | 'onSkipReasonChange' | 'episodeId' | 'delegatePhaseId' | 'setDelegatePhaseId'
> & {
  canDelegate: boolean;
  onDelegateClick: () => void;
  delegateOpen: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: `phase:${step.id}`,
      data: { type: 'phase', stepId: step.id, visitId: step.visitId },
      disabled: dragDisabled,
    });

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative' as const,
  };

  const config = statusConfig[step.status] ?? statusConfig.pending;
  const StatusIcon = config.icon;
  const canSkip = step.status === 'pending' || step.status === 'scheduled';
  const canUnskip = step.status === 'skipped';
  // A tervből bármelyik kocka elhagyható — a foglalt időpontot a szerver mondja
  // le, a kész fázis pedig az előzményekből is kikerül.
  const canDelete = true;
  const isAdHoc = !step.sourceEpisodePathwayId;
  const scopeText = phaseScopeText(step);
  const hasMerged = mergedChildren.length > 0;

  const moveMenu = !mergeMode && (
    <MoveToVisitMenu
      visits={visits}
      currentVisitId={step.visitId}
      visitOptionLabel={visitOptionLabel}
      onMove={(target) => onMoveToVisit(step, target)}
      saving={saving}
      compact={step.status === 'completed' || step.status === 'skipped'}
    />
  );

  // Kész / kihagyott → vékony, halvány kocka (kevesebb zaj a tervben).
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
            {scopeText && (
              <span className="ml-1.5 text-xs text-teal-600 dark:text-teal-400">({scopeText})</span>
            )}
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
          {moveMenu}
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

        {/* Drag handle — húzás másik alkalomba */}
        {!dragDisabled && (
          <button
            ref={setActivatorNodeRef}
            className="touch-none p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-grab active:cursor-grabbing shrink-0"
            {...attributes}
            {...listeners}
            tabIndex={-1}
            aria-label="Húzd másik alkalomba"
          >
            <GripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          </button>
        )}

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
            {scopeText && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300">
                {scopeText}
              </span>
            )}
            {isAdHoc && !scopeText && (
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
          {/* Összevont gyerekek — a csoport EGY kocka, a tagok itt, a kockán belül */}
          {hasMerged && (
            <div className="mt-1 ml-1 space-y-0.5">
              {mergedChildren.map((child) => (
                <div key={child.id} className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-300">
                  <Merge className="w-3 h-3" />
                  <span>{child.customLabel || child.treatmentLabel || child.stepCode.replace(/_/g, ' ')}</span>
                  {phaseScopeText(child) && (
                    <span className="text-violet-400 dark:text-violet-500">({phaseScopeText(child)})</span>
                  )}
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
          {moveMenu}
          {!mergeMode && (
            <button
              onClick={onEditTiming}
              className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-medical-primary hover:bg-medical-primary/10 rounded transition-colors"
              title="Időzítés és hatókör szerkesztése"
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

// ─── Időzítés + hatókör szerkesztő (inline) ──────────────────────────────────

function TimingScopeEditor({ step, mergedChildCount, saving, onCancel }: {
  step: EpisodeStep;
  mergedChildCount: number;
  saving: boolean;
  onCancel: () => void;
}) {
  const [daysOffset, setDaysOffset] = useState(step.defaultDaysOffset);
  const [duration, setDuration] = useState(step.durationMinutes);
  const [jaw, setJaw] = useState<string>(step.jaw ?? '');
  const [teethText, setTeethText] = useState(step.teeth.join(', '));
  const [localSaving, setLocalSaving] = useState(false);
  const { showToast } = useToast();

  const parseTeeth = (text: string): string[] =>
    Array.from(
      new Set(
        text
          .split(/[\s,;]+/)
          .map((t) => t.trim())
          .filter((t) => /^\d{1,2}$/.test(t))
      )
    );

  const handleSave = async () => {
    setLocalSaving(true);
    try {
      const res = await fetch(`/api/episodes/${step.episodeId}/work-phases/${step.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          defaultDaysOffset: daysOffset,
          durationMinutes: duration,
          // WP-4.2 hatókör-mezők — a route timing-ágán a státusszal nem, de az
          // időzítéssel kombinálhatók (no-op esetén nem termel napló-sort).
          jaw: jaw === '' ? null : jaw,
          teeth: parseTeeth(teethText),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      showToast('Időzítés és hatókör frissítve', 'success');
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
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2 font-medium">Időzítés és hatókör szerkesztése</p>
      {mergedChildCount > 0 && (
        <p className="text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-800 rounded-md px-2 py-1.5 mb-2">
          Összevont csoport: ez a percszám az <strong>egész</strong> egy időpontra eső blokkra vonatkozik
          (foglalható slot). A részlépések külön perce csak tájékoztató; szétbontás után külön állítható.
        </p>
      )}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
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
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap" htmlFor={`jaw-${step.id}`}>Állcsont:</label>
          <select
            id={`jaw-${step.id}`}
            value={jaw}
            onChange={(e) => setJaw(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1"
          >
            <option value="">—</option>
            <option value="felso">felső</option>
            <option value="also">alsó</option>
            <option value="mindketto">mindkettő</option>
          </select>
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-[180px]">
          <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap" htmlFor={`teeth-${step.id}`}>Fogszámok:</label>
          <input
            id={`teeth-${step.id}`}
            type="text"
            value={teethText}
            onChange={(e) => setTeethText(e.target.value)}
            placeholder="pl. 11, 12, 21"
            className="flex-1 text-sm border border-gray-300 dark:border-gray-700 rounded px-2 py-1"
          />
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

// ─── Kocka + inline megerősítő (kombinált) ───────────────────────────────────

export function VisitPhaseTile(props: VisitPhaseTileProps) {
  const {
    step, stepLabel, mergedChildren, rowBooking,
    confirmStepId, confirmAction, skipReason, saving,
    onSkip, onUnskip, onDeleteConfirm, onReopen, onCancel, onSkipReasonChange,
    episodeId, delegatePhaseId, setDelegatePhaseId,
  } = props;
  // A törlés-megerősítés a kockához tartozó összevont alfázisra is vonatkozhat —
  // azok nem külön kockaként, hanem a szülőn belül jelennek meg.
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
      <PhaseTileBody
        {...props}
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
            <TimingScopeEditor
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
