'use client';

/**
 * Kezelési terv kártya — vizit-alapú „puzzle" tábla (v2, 2026-09).
 *
 * Bal hasáb: generikus kezelés-paletta (csonkpreparálás, precíziós-szituációs
 * lenyomatvétel, átadás, …) + keresés a teljes katalógusban, egyedi fázis,
 * fogkezelési igények, „Feltöltés sablonból" (másodlagos). Jobb hasáb: az
 * alkalmak („vizitek") sorai, bennük a kezelés-kockák; két alkalom között a
 * vizitköz (alap: 1 hét) egy kattintással állítható. A munkafázisnak NINCS
 * saját várakozási ideje.
 *
 * Minden mutáció optimista (usePlanBoard): a felület azonnal frissül, a kérés
 * a háttérben megy, hiba esetén visszaáll. Egy alkalom = egy időpont: a
 * foglalás alkalom-szinten indul; több nyitott fázisnál a szerver előbb egy
 * blokkba vonja őket (prepare-booking), és a meglévő foglalási motor
 * (useWorkPhaseBooking) modáljai nyílnak.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import {
  Loader2, ChevronDown, ChevronUp, ChevronRight, Plus, AlertTriangle, CalendarDays, Layers, CalendarCheck2, Link2,
} from 'lucide-react';
import {
  DndContext, closestCenter, pointerWithin, rectIntersection,
  KeyboardSensor, PointerSensor, useSensor, useSensors, useDroppable,
  type CollisionDetection, type DragEndEvent, type DragStartEvent, type Modifier,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import type { WorklistItemBackend } from '@/lib/worklist-types';
import { useWorkPhaseBooking } from '@/hooks/useWorkPhaseBooking';
import { PlanValidationPanel } from './PlanValidationPanel';
import { WorkPhaseBookingModals } from './WorkPhaseBookingModals';
import { PlanStartDateControl } from './PlanStartDateControl';
import { PlanHistoryLog } from './PlanHistoryLog';
import { WorkPhaseTaskDelegateBlock } from './WorkPhaseTaskDelegateBlock';
import { EpisodeProviderControl } from './EpisodeProviderControl';
import {
  effectiveStatus,
  formatShortDate,
  formatShortDateTime,
  formatWaitDays,
  isTempId,
  summarizeVisitStatusV2,
  visitDateInfoV2,
  visitDisplayLabel,
  visitGapDays,
  visitHasOpenAppointment,
  visitTotalMinutes,
  type EpisodeStep,
  type EpisodeVisit,
  type VisitGroup,
  type VisitTarget,
} from './visit-plan/visit-plan-types';
import { Popover as VisitPopover, MenuItem as VisitMenuItem, MenuHeading as VisitMenuHeading } from './visit-plan/Popover';
import { usePlanBoard, type StepProjectionSummary } from './visit-plan/usePlanBoard';
import { PhasePalette } from './visit-plan/PhasePalette';
import { VisitRow } from './visit-plan/VisitRow';
import { VisitGap } from './visit-plan/VisitGap';
import { PhasePill } from './visit-plan/PhasePill';
import { VisitBookingButton } from './visit-plan/VisitBookingButton';

const restrictToVerticalAxis: Modifier = (args) => ({
  ...args.transform,
  x: 0,
});

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

function estimatedCompletionText(s: StepProjectionSummary): string | null {
  const e = s.estimatedCompletionEarliest;
  const l = s.estimatedCompletionLatest;
  if (e && l) return `${formatShortDate(e)} – ${formatShortDate(l)}`;
  if (l) return `legkésőbb ${formatShortDate(l)}`;
  if (e) return `legkorábban ${formatShortDate(e)}`;
  return null;
}

export interface EpisodeStepsManagerProps {
  episodeId: string;
  /** Optional — enables booking from the visit rows (worklist engine needs the patient). */
  patientId?: string;
  carePathwayId: string | null;
  carePathwayName?: string | null;
  episodePathways?: EpisodePathwayInfo[];
  onStepChanged?: () => void;
  /**
   * Az epizód felelős orvosa — a kártya fejlécében feltűnő chipként, a sablontól
   * függetlenül (EpisodeProviderControl). `showProvider` nélkül nem jelenik meg.
   */
  assignedProviderId?: string | null;
  assignedProviderName?: string | null;
  showProvider?: boolean;
  /** admin / fogpótlástanász válthatja a felelős orvost. */
  canEditProvider?: boolean;
  /** admin / fogpótlástanász szerkesztheti a palettát („sablonok"): felvétel / levétel / mentés. */
  canEditPalette?: boolean;
  /** Felelős orvos váltása után (karton + foglalási motor frissítése). */
  onProviderChanged?: () => void;
  /** Kezelési terv sablon szerkesztő (EpisodePathwayEditor) — a kártya
      „Sablon módosítása" gombja mögött nyílik. Csak jogosultnak adandó át. */
  settingsPanel?: React.ReactNode;
  /** Külső frissítő kulcs (pl. beállítás-mentés után) — változásra teljes újratöltés. */
  refreshTrigger?: number;
}

// ─── „Új alkalom" zóna: droppable + kattintható (nem-drag alternatíva) ───────

function NewVisitZone({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'new-visit-zone' });
  return (
    <div
      ref={setNodeRef}
      data-testid="new-visit-zone"
      className={`rounded-xl border-2 border-dashed px-3 py-2 flex items-center gap-2 flex-wrap transition-colors ${
        isOver ? 'border-medical-primary bg-medical-primary/5' : 'border-gray-300 dark:border-gray-700'
      }`}
    >
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium text-medical-primary rounded-md hover:bg-medical-primary/10 transition-colors disabled:opacity-50"
      >
        <Plus className="w-4 h-4" />
        Új alkalom
      </button>
      <span className="text-xs text-gray-400 dark:text-gray-500">
        Kezelést ide ejtve új alkalom nyílik.
      </span>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EpisodeStepsManager({
  episodeId,
  patientId,
  carePathwayId,
  carePathwayName,
  episodePathways = [],
  onStepChanged,
  assignedProviderId = null,
  assignedProviderName = null,
  showProvider = false,
  canEditProvider = false,
  canEditPalette = false,
  onProviderChanged,
  settingsPanel,
  refreshTrigger,
}: EpisodeStepsManagerProps) {
  const { showToast, confirm } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeDragType, setActiveDragType] = useState<'visit' | 'item' | null>(null);
  const [delegatePhaseId, setDelegatePhaseId] = useState<string | null>(null);
  const [busyVisitId, setBusyVisitId] = useState<string | null>(null);
  useEffect(() => { setMounted(true); }, []);

  // A tábla és a foglalási motor kölcsönösen frissítik egymást — ref-en át,
  // hogy ne legyen körkörös hook-függőség.
  const bookingRefreshRef = useRef<() => Promise<void>>(async () => {});
  const onPlanChanged = useCallback(() => {
    void bookingRefreshRef.current();
  }, []);

  const board = usePlanBoard({
    episodeId,
    showToast,
    confirm,
    onStatusChanged: onStepChanged,
    onPlanChanged,
    refreshTrigger,
  });

  const handleBookingChanged = useCallback(() => {
    void board.reload();
    void board.loadProjections();
    onStepChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.reload, board.loadProjections, onStepChanged]);

  const booking = useWorkPhaseBooking({
    patientId: patientId ?? null,
    episodeId,
    onChanged: handleBookingChanged,
  });
  bookingRefreshRef.current = booking.refresh;

  // refreshTrigger-bump (pl. kezelési út mentése) → worklist újratöltés is.
  // Az első futást kihagyjuk: mountkor a hook maga fetch-el.
  const skipFirstBookingRefresh = useRef(true);
  useEffect(() => {
    if (skipFirstBookingRefresh.current) {
      skipFirstBookingRefresh.current = false;
      return;
    }
    void booking.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  // ─── Címkék, származtatott adatok ────────────────────────────────────────

  const getStepLabel = useCallback(
    (step: EpisodeStep): string => {
      if (step.customLabel) return step.customLabel;
      if (step.treatmentLabel && step.toothNumber) return `${step.treatmentLabel} – ${step.toothNumber}`;
      if (step.treatmentLabel) return step.treatmentLabel;
      return board.catalogLabelByCode.get(step.stepCode) ?? step.stepCode.replace(/_/g, ' ');
    },
    [board.catalogLabelByCode]
  );

  const visitTitle = useCallback(
    (visit: EpisodeVisit, index: number): string => {
      const group = board.groups.find((g) => g.visit.id === visit.id);
      return `${index + 1}. alkalom — ${visitDisplayLabel(visit, group?.phases ?? [], getStepLabel)}`;
    },
    [board.groups, getStepLabel]
  );

  const primaries = useMemo(() => board.steps.filter((s) => !s.mergedIntoStepId), [board.steps]);
  const nextPendingStepId = useMemo(() => {
    for (const g of board.groups) {
      const hit = g.primaries.find((p) => p.status === 'pending' || p.status === 'scheduled');
      if (hit) return hit.id;
    }
    return board.unassigned.find((p) => p.status === 'pending' || p.status === 'scheduled')?.id ?? null;
  }, [board.groups, board.unassigned]);

  const nonSkippedCount = primaries.filter((s) => s.status !== 'skipped').length;
  const completedCount = primaries.filter((s) => s.status === 'completed').length;
  const progressPct = nonSkippedCount > 0 ? (completedCount / nonSkippedCount) * 100 : 0;
  const completionText = board.projectionSummary ? estimatedCompletionText(board.projectionSummary) : null;
  const pendingPrimaryCount = primaries.filter((s) => s.status === 'pending').length;

  const hasPathways = Boolean(carePathwayId) || episodePathways.length > 0;
  const pathwayDisplayName = useMemo(() => {
    if (episodePathways.length > 0) {
      return episodePathways
        .map((p) => p.pathwayName + (p.jaw ? ` (${JAW_SHORT[p.jaw] ?? p.jaw})` : ''))
        .join(', ');
    }
    return carePathwayName ?? null;
  }, [episodePathways, carePathwayName]);

  // Re-validate the plan whenever a step's identity, status, pool, duration or
  // visit changes.
  const planSignature = useMemo(
    () => board.steps.map((s) => `${s.id}:${s.status}:${s.pool}:${s.durationMinutes}:${s.visitId ?? ''}`).join('|'),
    [board.steps]
  );

  const activeIndex = board.visits.findIndex((v) => v.id === board.activeVisitId);
  const paletteTargetHint = activeIndex >= 0 ? `→ ${activeIndex + 1}. alkalom` : '→ új alkalom';

  // ─── Puzzle v2: a váz — alkalom nélküli időpontok hozzárendelése ─────────
  /** Melyik alkalomhoz nyílik az időpont-választó (null = zárva). */
  const [attachForVisitId, setAttachForVisitId] = useState<string | null>(null);
  const unattached = board.unattachedAppointments;
  const visitOptionsForAppointment = useMemo(
    () => board.groups.filter((g) => !visitHasOpenAppointment(g.visit) && !isTempId(g.visit.id)),
    [board.groups]
  );

  // ─── Vizit-szintű foglalás ──────────────────────────────────────────────

  const [pendingBookingAction, setPendingBookingAction] = useState<{
    primaryId: string;
    action: (item: WorklistItemBackend) => void;
  } | null>(null);

  useEffect(() => {
    if (!pendingBookingAction) return;
    const item = booking.itemByWorkPhaseId.get(pendingBookingAction.primaryId);
    if (item) {
      const a = pendingBookingAction;
      setPendingBookingAction(null);
      setBusyVisitId(null);
      a.action(item);
      return;
    }
    const t = setTimeout(() => {
      setPendingBookingAction(null);
      setBusyVisitId(null);
      showToast('A foglalási sor még nem frissült — próbálja újra a foglalást', 'error');
    }, 8000);
    return () => clearTimeout(t);
  }, [booking.itemByWorkPhaseId, pendingBookingAction, showToast]);

  const openPrimariesOf = (group: VisitGroup) =>
    group.primaries.filter((p) => p.status === 'pending' || p.status === 'scheduled');

  const runVisitBookingAction = async (
    group: VisitGroup,
    action: (item: WorklistItemBackend) => void
  ) => {
    const open = openPrimariesOf(group);
    if (open.length === 0) return;
    const anchor = open.find((p) => p.status === 'scheduled') ?? open[0];
    if (open.length === 1) {
      const item = booking.itemByWorkPhaseId.get(anchor.id);
      if (item) action(item);
      return;
    }
    // Több nyitott fázis → előbb egy blokk (a szerver összevonja), aztán a
    // friss worklist-sorral nyílik a modál.
    setBusyVisitId(group.visit.id);
    const primaryId = await board.prepareVisitBooking(group.visit.id);
    if (!primaryId) {
      setBusyVisitId(null);
      return;
    }
    await booking.refresh();
    setPendingBookingAction({ primaryId, action });
  };

  const renderVisitBooking = (group: VisitGroup) => {
    if (!booking.enabled) return null;
    const open = openPrimariesOf(group);
    if (open.length === 0) return null;
    // Foglalt alkalom: a váz chipje a fejlécben (VisitRow), a foglalási
    // menü a primary worklist-sorából jön (áthelyezés / sikertelen / kész).
    // Ha az időpont az alkalomé, de a primary linkje még nem ért ide
    // (optimista állapot), a chip elég.
    if (visitHasOpenAppointment(group.visit) && !open.some((p) => p.appointmentId === group.visit.appointmentId)) {
      return null;
    }
    const anchor = open.find((p) => p.status === 'scheduled') ?? open[0];
    if (isTempId(anchor.id)) return null;
    const item = booking.itemByWorkPhaseId.get(anchor.id);
    if (!item) return null;
    return (
      <VisitBookingButton
        state={booking.rowStateFor(item)}
        bookedStartIso={item.bookedAppointmentStartTime ?? null}
        needsMerge={open.length > 1}
        busy={busyVisitId === group.visit.id}
        onBook={() => void runVisitBookingAction(group, (it) => booking.openSlotPicker(it))}
        onLink={() => void runVisitBookingAction(group, (it) => booking.openLinkAppointment(it))}
        onMarkDoneRetro={() => void runVisitBookingAction(group, (it) => booking.openMarkCompleteRetro(it))}
        onMarkUnsuccessful={() => booking.openMarkUnsuccessful(item)}
      />
    );
  };

  /** Lánc-foglalás: előbb minden több-fázisú alkalom egy blokkba, aztán a köteg. */
  const handleConvertAll = async () => {
    const multi = board.groups.filter((g) => openPrimariesOf(g).length > 1);
    for (const g of multi) {
      const id = await board.prepareVisitBooking(g.visit.id);
      if (!id) return;
    }
    if (multi.length > 0) await booking.refresh();
    await booking.convertAll();
  };

  const showConvertAll =
    booking.enabled && booking.hasReady && pendingPrimaryCount >= 2 && !booking.chainBookingRequired;

  // ─── DnD ─────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const activeId = String(args.active.id);
    if (activeId.startsWith('visit:')) {
      const containers = args.droppableContainers.filter((c) => String(c.id).startsWith('visit:'));
      return closestCenter({ ...args, droppableContainers: containers });
    }
    // Kocka / paletta-elem húzásánál csak az alkalom-törzsek és az új-alkalom zóna a cél.
    const containers = args.droppableContainers.filter((c) => {
      const id = String(c.id);
      return id.startsWith('visitdrop:') || id === 'new-visit-zone';
    });
    const within = pointerWithin({ ...args, droppableContainers: containers });
    if (within.length > 0) return within;
    return rectIntersection({ ...args, droppableContainers: containers });
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragType(String(event.active.id).startsWith('visit:') ? 'visit' : 'item');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragType(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith('visit:')) {
      if (!overId.startsWith('visit:') || activeId === overId) return;
      const ids = board.visits.map((v) => v.id);
      const from = ids.indexOf(activeId.slice('visit:'.length));
      const to = ids.indexOf(overId.slice('visit:'.length));
      if (from < 0 || to < 0 || from === to) return;
      void board.reorderVisits(arrayMove(ids, from, to));
      return;
    }

    const target: VisitTarget | null =
      overId === 'new-visit-zone'
        ? 'new'
        : overId.startsWith('visitdrop:')
          ? overId.slice('visitdrop:'.length)
          : null;
    if (!target) return;

    if (activeId.startsWith('phase:')) {
      const stepId = activeId.slice('phase:'.length);
      const step = board.stepsById.get(stepId);
      if (!step) return;
      if (target !== 'new' && target === step.visitId) return;
      void board.moveStep(stepId, target);
      return;
    }
    if (activeId.startsWith('palette:')) {
      const code = activeId.slice('palette:'.length);
      const item = board.catalog.find((c) => c.stepCode === code);
      if (item) void board.addFromCatalog(item, target);
      return;
    }
    if (activeId.startsWith('tooth:')) {
      const id = activeId.slice('tooth:'.length);
      const tt = board.availableToothTreatments.find((t) => t.id === id);
      if (tt) void board.addToothTreatment(tt, target);
    }
  };

  const visitSortableIds = useMemo(() => board.visits.map((v) => `visit:${v.id}`), [board.visits]);

  // ─── Render helpers ──────────────────────────────────────────────────────

  const renderPill = (step: EpisodeStep) => {
    const primary = step.mergedIntoStepId ? board.stepsById.get(step.mergedIntoStepId) ?? null : null;
    return (
      <PhasePill
        key={step.id}
        step={step}
        label={getStepLabel(step)}
        displayStatus={effectiveStatus(step, board.stepsById)}
        isChild={!!step.mergedIntoStepId}
        primaryLabel={primary ? getStepLabel(primary) : null}
        isNext={step.id === nextPendingStepId}
        pending={board.pendingIds.has(step.id) || isTempId(step.id)}
        visits={board.visits}
        visitTitle={visitTitle}
        actions={{
          onMove: (target) => void board.moveStep(step.id, target),
          onDelete: () => void board.deleteStep(step.id),
          onSkip: (reason) => void board.skipStep(step.id, reason),
          onUnskip: () => void board.unskipStep(step.id),
          onReopen: (reason) => void board.reopenStep(step.id, reason),
          onScope: (patch) => void board.updateScope(step.id, patch),
          onDelegate: () => setDelegatePhaseId(step.id),
        }}
      />
    );
  };

  const renderDelegateFooter = (group: VisitGroup) => {
    if (!delegatePhaseId) return undefined;
    const step = group.phases.find((p) => p.id === delegatePhaseId);
    if (!step) return undefined;
    return (
      <WorkPhaseTaskDelegateBlock
        episodeId={episodeId}
        workPhaseId={step.id}
        phaseLabel={getStepLabel(step)}
        onClose={() => setDelegatePhaseId(null)}
      />
    );
  };

  const hasAnyPlanContent = board.visits.length > 0 || board.steps.length > 0;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      {/* Fejléc: cím (lenyitó) + a felelős orvos feltűnő chipje — a chip az
          epizód tulajdonsága, a sablontól független, lecsukott kártyán is látszik. */}
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex-1 min-w-[200px] flex items-center justify-between gap-2 text-left rounded-md -mx-1 px-1 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          aria-expanded={expanded}
        >
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Kezelési terv</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Az időpontok a váz, a kezelések a tartalom — bal oldalról pakolható, egy alkalom = egy időpont
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {primaries.length > 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {primaries.filter((s) => s.status === 'completed' || s.status === 'skipped').length}/{primaries.length} kész
              </span>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />}
          </div>
        </button>
        {showProvider && (
          <EpisodeProviderControl
            episodeId={episodeId}
            patientId={patientId ?? null}
            assignedProviderId={assignedProviderId}
            assignedProviderName={assignedProviderName}
            canEdit={canEditProvider}
            onChanged={onProviderChanged}
            compact
          />
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
          {board.loading ? (
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Betöltés…</span>
            </div>
          ) : (
            <>
              {/* ─── Terv-meta: sablon + sablon-beállítások (a felelős orvos a fejlécben) ── */}
              {(pathwayDisplayName || settingsPanel) && (
                <div className="mb-3 pb-3 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2 flex-wrap text-sm text-gray-700 dark:text-gray-300">
                    <Layers className="w-4 h-4 text-medical-primary shrink-0" />
                    <span className="text-gray-500 dark:text-gray-400">
                      Sablon:{' '}
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
                        Sablon módosítása
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
                        onSaved={() => {
                          void booking.refresh();
                          void board.loadProjections();
                          onStepChanged?.();
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ─── Foglalási állapot: hiba, lánc-ajánlat, üzenet, blokk ── */}
              {booking.enabled && (
                <div className="mb-3 empty:mb-0 empty:hidden space-y-2">
                  {booking.error && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Foglalási műveletek betöltése sikertelen.</span>
                      <button type="button" onClick={() => void booking.refresh()} className="underline font-medium">
                        Újra
                      </button>
                    </div>
                  )}
                  {booking.chainBookingRequired && (
                    <div className="flex items-center gap-3 flex-wrap rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 text-sm text-blue-900 dark:text-blue-200">
                      <span>
                        <strong>Több alkalom is foglalható egyszerre</strong> — a láncolást a rendszer számolja.
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleConvertAll()}
                        disabled={booking.convertAllBusy}
                        className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 bg-medical-primary text-white rounded-md text-xs font-semibold hover:bg-medical-primary-dark disabled:opacity-50"
                      >
                        {booking.convertAllBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                        {booking.convertAllBusy ? 'Lefoglalás…' : 'Összes időpont lefoglalása'}
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
                      <button type="button" onClick={booking.dismissConvertAllMessage} className="ml-2 underline">
                        Elrejt
                      </button>
                    </div>
                  )}
                  {booking.blockedItem?.blockedReason && booking.blockedItem.blockedCode !== 'NO_CARE_PATHWAY' && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Foglalás blokkolva: {booking.blockedItem.blockedReason}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ─── Haladás + becsült befejezés (egy sor) ─────────────── */}
              {board.projectionBlockedReason && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Nem tudunk ütemezést becsülni: {board.projectionBlockedReason}</span>
                </div>
              )}
              {primaries.length > 0 && (
                <div className="mb-3 flex items-center gap-3 flex-wrap">
                  <div className="h-1.5 flex-1 min-w-[120px] bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-medical-primary rounded-full transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  {(completionText || (board.projectionSummary?.nextStepWaitDays != null && board.projectionSummary.nextStepWaitDays > 0)) && (
                    <p className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 flex-wrap">
                      <CalendarDays className="w-3.5 h-3.5 text-medical-primary shrink-0" />
                      {completionText && (
                        <span>
                          Becsült befejezés: <strong className="text-gray-900 dark:text-gray-100">{completionText}</strong>
                        </span>
                      )}
                      {board.projectionSummary?.nextStepWaitDays != null && board.projectionSummary.nextStepWaitDays > 0 && (
                        <span>· következő alkalom {formatWaitDays(board.projectionSummary.nextStepWaitDays)}</span>
                      )}
                    </p>
                  )}
                  {showConvertAll && (
                    <button
                      type="button"
                      onClick={() => void handleConvertAll()}
                      disabled={booking.convertAllBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-gray-300 dark:border-gray-700 text-medical-primary rounded-md text-xs hover:border-medical-primary disabled:opacity-50 transition-colors"
                      title="A hátralévő alkalmak időpontjainak lefoglalása egy lépésben"
                    >
                      {booking.convertAllBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                      {booking.convertAllBusy ? 'Lefoglalás…' : 'Összes időpont lefoglalása'}
                    </button>
                  )}
                </div>
              )}

              {/* ─── Tábla: paletta | alkalmak ─────────────────────────── */}
              {mounted ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={collisionDetection}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setActiveDragType(null)}
                  modifiers={activeDragType === 'visit' ? [restrictToVerticalAxis] : []}
                >
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)] gap-3 items-start">
                    <PhasePalette
                      catalog={board.catalog}
                      toothTreatments={board.availableToothTreatments}
                      onAddCatalog={(item) => void board.addFromCatalog(item)}
                      onAddFreeText={(label, opts) => void board.addFreeText(label, undefined, opts)}
                      onAddTooth={(tt) => void board.addToothTreatment(tt)}
                      onUpdateCatalogItem={
                        canEditPalette ? (code, patch) => void board.updateCatalogItem(code, patch) : undefined
                      }
                      onApplyTemplate={hasPathways ? () => void board.applyTemplate() : undefined}
                      templateBusy={board.generating}
                      targetHint={paletteTargetHint}
                      dragEnabled
                    />

                    <div className="min-w-0 space-y-1" data-testid="visit-board">
                      {/* ─── A váz: alkalom nélküli foglalt időpontok ───────────── */}
                      {unattached.length > 0 && (
                        <div
                          className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 px-3 py-2 flex items-center gap-2 flex-wrap"
                          data-testid="unattached-appointments"
                        >
                          <CalendarCheck2 className="w-4 h-4 text-blue-600 dark:text-blue-300 shrink-0" />
                          <span className="text-xs font-medium text-blue-900 dark:text-blue-200">
                            Foglalt időpont alkalom nélkül:
                          </span>
                          {unattached.map((a) => (
                            <VisitPopover
                              key={a.id}
                              align="left"
                              widthClass="w-64"
                              triggerAriaLabel={`Időpont ${a.startTime ? formatShortDateTime(a.startTime) : a.id} hozzárendelése alkalomhoz`}
                              triggerClassName="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white dark:bg-gray-900 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                              trigger={
                                <>
                                  {a.startTime ? formatShortDateTime(a.startTime) : 'időpont'}
                                  <Link2 className="w-3 h-3" />
                                </>
                              }
                            >
                              {(close) => (
                                <div>
                                  <VisitMenuHeading>Melyik alkalomhoz?</VisitMenuHeading>
                                  {visitOptionsForAppointment.length === 0 && (
                                    <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                                      Minden alkalomnak van már időpontja.
                                    </p>
                                  )}
                                  {visitOptionsForAppointment.map((g) => (
                                    <VisitMenuItem
                                      key={g.visit.id}
                                      onClick={() => {
                                        void board.attachAppointment(g.visit.id, a.id);
                                        close();
                                      }}
                                    >
                                      {visitTitle(g.visit, board.visits.findIndex((v) => v.id === g.visit.id))}
                                    </VisitMenuItem>
                                  ))}
                                  <VisitMenuItem
                                    tone="primary"
                                    onClick={() => {
                                      void board.attachAppointment('new', a.id);
                                      close();
                                    }}
                                  >
                                    <Plus className="w-3.5 h-3.5" /> Új alkalom ezzel az időponttal
                                  </VisitMenuItem>
                                </div>
                              )}
                            </VisitPopover>
                          ))}
                        </div>
                      )}
                      {!hasAnyPlanContent && (
                        <p className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3 text-sm text-gray-600 dark:text-gray-400">
                          A kezelési terv még üres. Kattintson egy kezelésre a bal oldali palettán
                          (az első alkalom magától létrejön){hasPathways ? ', vagy töltse fel a tervet sablonból' : ''}.
                        </p>
                      )}
                      <SortableContext items={visitSortableIds} strategy={verticalListSortingStrategy}>
                        {board.groups.map((group, index) => {
                          const pending = board.pendingIds.has(group.visit.id) || isTempId(group.visit.id);
                          return (
                            <Fragment key={group.visit.id}>
                              {index > 0 && (
                                <VisitGap
                                  days={visitGapDays(group.visit)}
                                  onChange={(days) => void board.updateVisit(group.visit.id, { daysOffset: days })}
                                  disabled={pending}
                                />
                              )}
                              <VisitRow
                                visit={group.visit}
                                index={index}
                                visitCount={board.visits.length}
                                title={visitDisplayLabel(group.visit, group.phases, getStepLabel)}
                                statusSummary={summarizeVisitStatusV2(group.visit, group.primaries)}
                                totalMinutes={visitTotalMinutes(group.visit, group.primaries)}
                                dateInfo={visitDateInfoV2(group.visit, group.primaries, board.projectionByPhaseId)}
                                phaseCount={group.phases.length}
                                isActive={board.activeVisitId === group.visit.id}
                                pending={pending}
                                onActivate={() => board.setActiveVisitId(group.visit.id)}
                                onMoveUp={() => void board.moveVisit(group.visit.id, -1)}
                                onMoveDown={() => void board.moveVisit(group.visit.id, 1)}
                                onDeleteEmpty={() => void board.deleteEmptyVisit(group.visit.id)}
                                onRename={(label) => void board.updateVisit(group.visit.id, { label })}
                                onAttachAppointment={() => setAttachForVisitId(group.visit.id)}
                                unattachedCount={unattached.length}
                                onDetachAppointment={() => void board.detachAppointment(group.visit.id)}
                                bookingSlot={renderVisitBooking(group)}
                                footer={renderDelegateFooter(group)}
                              >
                                {group.phases.map(renderPill)}
                              </VisitRow>
                            </Fragment>
                          );
                        })}
                      </SortableContext>

                      {/* Vizit nélküli (backfill előtti) sorok — besorolhatók */}
                      {board.unassigned.length > 0 && (
                        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20">
                          <div className="px-3 py-1.5 border-b border-amber-100 dark:border-amber-900 text-xs font-medium text-amber-800 dark:text-amber-300">
                            Alkalomhoz nem rendelt kezelések — húzza egy alkalomba, vagy a kocka menüjéből helyezze át
                          </div>
                          <div className="flex flex-wrap gap-1.5 p-2">
                            {board.unassigned.map(renderPill)}
                          </div>
                        </div>
                      )}

                      {attachForVisitId && (
                        <div
                          className="rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 px-3 py-2"
                          role="dialog"
                          aria-label="Időpont hozzárendelése az alkalomhoz"
                          data-testid="attach-appointment-picker"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                              Időpont a(z){' '}
                              {visitTitle(
                                board.visits.find((v) => v.id === attachForVisitId) as EpisodeVisit,
                                board.visits.findIndex((v) => v.id === attachForVisitId)
                              )}{' '}
                              alkalomhoz:
                            </span>
                            {unattached.length === 0 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">nincs szabad, alkalom nélküli időpont.</span>
                            )}
                            {unattached.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => {
                                  void board.attachAppointment(attachForVisitId, a.id);
                                  setAttachForVisitId(null);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                              >
                                <CalendarCheck2 className="w-3 h-3" />
                                {a.startTime ? formatShortDateTime(a.startTime) : 'időpont'}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setAttachForVisitId(null)}
                              className="ml-auto text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                            >
                              Mégse
                            </button>
                          </div>
                        </div>
                      )}

                      <NewVisitZone
                        onCreate={() => void board.createEmptyVisit()}
                        disabled={board.visits.some((v) => isTempId(v.id))}
                      />
                    </div>
                  </div>
                </DndContext>
              ) : (
                <div className="animate-pulse grid grid-cols-1 md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)] gap-3">
                  <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-lg" />
                  <div className="space-y-2">
                    {(board.visits.length > 0 ? board.visits : [1, 2]).map((_, i) => (
                      <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                    ))}
                  </div>
                </div>
              )}

              {/* ─── Terv-validáció (WP-1.1) — csak ha van aktív lépés ──── */}
              {primaries.some((s) => s.status !== 'skipped') && (
                <div className="mt-3">
                  <PlanValidationPanel episodeId={episodeId} patientId={patientId} signature={planSignature} />
                </div>
              )}

              {/* ─── WP-2.2: „A terv változásai" — olvasható napló ────── */}
              <PlanHistoryLog episodeId={episodeId} />
            </>
          )}
        </div>
      )}
      {booking.enabled && <WorkPhaseBookingModals api={booking} />}
    </div>
  );
}
