'use client';

/**
 * Kezelési terv kártya — WP-4.3 óta vizit-alapú („puzzle") nézet:
 * a terv alkalom-kártyák (VisitCard) függőleges sora, egy kártya = egy vizit
 * (episode_visits). A kártyákban a munkafázisok kezelés-kockákként
 * (VisitPhaseTile) jelennek meg; a kockák drag-droppal ÉS menüből is
 * áthelyezhetők másik alkalomba, az alkalmak átrendezhetők (drag + fel/le
 * gombok). A sablon másodlagos művelet: „Feltöltés sablonból" (explicit
 * generate — a WP-0.7 óta automatikus újragenerálás nincs).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useToast } from '@/contexts/ToastContext';
import {
  Loader2, ChevronDown, ChevronUp, ChevronRight,
  Plus, Search, FileText, Layers, PenLine, Merge,
  AlertTriangle, CalendarDays, UserRound,
} from 'lucide-react';
import { PlanValidationPanel } from './PlanValidationPanel';
import { useWorkPhaseBooking } from '@/hooks/useWorkPhaseBooking';
import { WorkPhaseBookingModals } from './WorkPhaseBookingModals';
import { PlanStartDateControl } from './PlanStartDateControl';
import { PlanHistoryLog } from './PlanHistoryLog';
import {
  DndContext, closestCenter, pointerWithin, rectIntersection,
  KeyboardSensor, PointerSensor, useSensor, useSensors, useDroppable,
  type CollisionDetection, type DragEndEvent, type DragStartEvent, type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable';
import {
  type ConfirmAction,
  type EpisodeStep,
  type EpisodeVisit,
  type StepProjectionInfo,
  formatShortDate,
  formatWaitDays,
  mapVisitsResponse,
  mapWorkPhaseApiToEpisodeStep,
  mapWorkPhasesResponse,
  summarizeVisitStatus,
  visitDateInfo,
  visitDisplayLabel,
  visitTotalMinutes,
} from './visit-plan/visit-plan-types';
import { VisitCard } from './visit-plan/VisitCard';
import { VisitPhaseTile, type RowBookingActions } from './visit-plan/VisitPhaseTile';

const restrictToVerticalAxis: Modifier = (args) => ({
  ...args.transform,
  x: 0,
});

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

interface StepProjectionSummary {
  completedCount: number;
  remainingCount: number;
  estimatedCompletionEarliest: string | null;
  estimatedCompletionLatest: string | null;
  nextStepWaitDays: number | null;
}

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

const PATHWAY_COLORS = [
  'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300',
  'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300',
  'bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300',
  'bg-pink-100 dark:bg-pink-950/50 text-pink-700 dark:text-pink-300',
  'bg-cyan-100 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300',
];

type AdderTab = 'catalog' | 'freetext' | 'tooth';

// ─── „Új alkalom" zóna: droppable + kattintható (nem-drag alternatíva) ───────

function NewVisitZone({ onCreate, saving }: { onCreate: () => void; saving: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'new-visit-zone' });
  return (
    <div
      ref={setNodeRef}
      data-testid="new-visit-zone"
      className={`rounded-xl border-2 border-dashed px-3 py-3 flex items-center gap-2 flex-wrap transition-colors ${
        isOver
          ? 'border-medical-primary bg-medical-primary/5'
          : 'border-gray-300 dark:border-gray-700'
      }`}
    >
      <button
        type="button"
        onClick={onCreate}
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-medical-primary rounded-md hover:bg-medical-primary/10 transition-colors disabled:opacity-50"
      >
        <Plus className="w-4 h-4" />
        Új alkalom
      </button>
      <span className="text-xs text-gray-400 dark:text-gray-500">
        Kezelés-kockát ide ejtve a kocka új alkalomba kerül.
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
  episodePathways: initialEpisodePathways,
  onStepChanged,
  assignedProviderName,
  settingsPanel,
  refreshTrigger,
}: EpisodeStepsManagerProps) {
  const { showToast } = useToast();
  const [steps, setSteps] = useState<EpisodeStep[]>([]);
  const [visits, setVisits] = useState<EpisodeVisit[]>([]);
  const [stepLabels, setStepLabels] = useState<Map<string, string>>(new Map());
  const [catalogItems, setCatalogItems] = useState<StepCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [confirmStepId, setConfirmStepId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [episodePathways, setEpisodePathways] = useState<EpisodePathwayInfo[]>(initialEpisodePathways ?? []);
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeDragType, setActiveDragType] = useState<'visit' | 'phase' | null>(null);

  // Tervezett ütemezés (vetítés) — az alkalom-kártyákba és a kockákba fésülve
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
  /** Cél-alkalom az új kockának: 'new' = új alkalom a terv végére (alapérték). */
  const [adderTargetVisitId, setAdderTargetVisitId] = useState<string>('new');

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
      // dolga; ez itt csak GET. WP-4.3: a válasz visits[] metaadata adja az
      // alkalom-kártyákat.
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
      setVisits(mapVisitsResponse(data.visits));
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

  /** „Feltöltés sablonból" — az explicit generate hívás (WP-0.7 óta csak így ír). */
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/generate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json().catch(() => ({}));
      await loadSteps();
      showToast(
        typeof data.message === 'string' && data.message ? data.message : 'Sablon betöltve',
        'success'
      );
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Nem sikerült a sablon betöltése', 'error');
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
      // A kiürült alkalmat a szerver törli; az unmerge-elt gyerekek vizitje is
      // ott dől el — teljes újratöltés tartja szinkronban a kártyákat.
      await loadSteps();
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a törlésnél', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Vizit-műveletek (WP-4.3) ───────────────────────────────────────────

  /** Alkalom-sorrend mentése (optimista; hibánál visszatöltés). */
  const persistVisitOrder = useCallback(async (ordered: EpisodeVisit[]) => {
    const prevVisits = visits;
    setVisits(ordered);
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/visits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderedVisitIds: ordered.map((v) => v.id) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.visits)) setVisits(mapVisitsResponse(data.visits));
      // A vizit-átrendezés a fázis-seq-eket is átszámozza a szerveren.
      await loadSteps();
      void loadProjections();
      showToast('Alkalmak átrendezve', 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba az átrendezésnél', 'error');
      setVisits(prevVisits);
      void loadSteps();
    } finally {
      setSaving(false);
    }
  }, [visits, episodeId, loadSteps, loadProjections, notifyPlanChanged, showToast]);

  /** Fel/le gombos átrendezés — a drag-drop nem-drag alternatívája. */
  const handleMoveVisit = (visitId: string, direction: -1 | 1) => {
    const from = visits.findIndex((v) => v.id === visitId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= visits.length) return;
    void persistVisitOrder(arrayMove(visits, from, to));
  };

  /** Új üres alkalom a lista végére. Visszaadja az új vizitet (vagy null-t hibánál). */
  const createVisit = useCallback(async (): Promise<EpisodeVisit | null> => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/visits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json();
      const visit = data.visit ? mapVisitsResponse([data.visit])[0] : null;
      if (visit) setVisits((prev) => [...prev, visit]);
      return visit;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Nem sikerült új alkalmat létrehozni', 'error');
      return null;
    }
  }, [episodeId, showToast]);

  const handleAddEmptyVisit = async () => {
    setSaving(true);
    try {
      const visit = await createVisit();
      if (visit) {
        showToast('Új alkalom létrehozva', 'success');
        notifyPlanChanged();
      }
    } finally {
      setSaving(false);
    }
  };

  /** Kocka (merge-csoporttal együtt) áthelyezése egy meglévő alkalomba. */
  const moveTileToVisit = useCallback(async (step: EpisodeStep, targetVisitId: string) => {
    if (step.visitId === targetVisitId) return;
    const prevSteps = steps;
    const prevVisits = visits;
    // Optimista frissítés: a csoport együtt mozog, a kiürült forrás-alkalom
    // eltűnik (a szerver is így viselkedik — deleteEpisodeVisitsIfEmpty).
    const groupIds = new Set<string>([
      step.id,
      ...steps.filter((s) => s.mergedIntoStepId === step.id).map((s) => s.id),
    ]);
    setSteps((prev) =>
      prev.map((s) => (groupIds.has(s.id) ? { ...s, visitId: targetVisitId } : s))
    );
    if (step.visitId) {
      const sourceStillUsed = steps.some(
        (s) => !groupIds.has(s.id) && s.visitId === step.visitId
      );
      if (!sourceStillUsed) {
        setVisits((prev) => prev.filter((v) => v.id !== step.visitId));
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/${step.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ visitId: targetVisitId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      showToast('Áthelyezve másik alkalomba', 'success');
      await loadSteps();
      void loadProjections();
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba az áthelyezésnél', 'error');
      setSteps(prevSteps);
      setVisits(prevVisits);
      void loadSteps();
    } finally {
      setSaving(false);
    }
  }, [steps, visits, episodeId, loadSteps, loadProjections, notifyPlanChanged, showToast]);

  /** „Áthelyezés másik alkalomba" (menü + drag): meglévő vizit vagy új alkalom. */
  const handleMoveTile = useCallback(async (step: EpisodeStep, target: string | 'new') => {
    if (target === 'new') {
      setSaving(true);
      let visit: EpisodeVisit | null = null;
      try {
        visit = await createVisit();
      } finally {
        setSaving(false);
      }
      if (!visit) return;
      await moveTileToVisit(step, visit.id);
      return;
    }
    await moveTileToVisit(step, target);
  }, [createVisit, moveTileToVisit]);

  /** Üres alkalom törlése (csak üresre engedett — a szerver is őrzi). */
  const handleDeleteEmptyVisit = async (visitId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/visits/${visitId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      setVisits((prev) => prev.filter((v) => v.id !== visitId));
      showToast('Üres alkalom törölve', 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a törlésnél', 'error');
      void loadSteps();
    } finally {
      setSaving(false);
    }
  };

  /** Alkalom címke + eltolás mentése (PATCH /visits/:visitId). */
  const handleSaveVisitMeta = async (
    visitId: string,
    patch: { label: string | null; daysOffset: number | null }
  ): Promise<boolean> => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/visits/${visitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Hiba');
      const data = await res.json().catch(() => ({}));
      if (data.visit) {
        const mapped = mapVisitsResponse([data.visit])[0];
        setVisits((prev) => prev.map((v) => (v.id === visitId ? mapped : v)));
      }
      showToast('Alkalom frissítve', 'success');
      // A days_offset a vizit-tudatos forecast bemenete — a becslés frissül.
      void loadProjections();
      notifyPlanChanged();
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a mentésnél', 'error');
      return false;
    }
  };

  // ─── DnD: kockák vizitek közé, alkalmak átrendezése ─────────────────────

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const activeId = String(args.active.id);
    if (activeId.startsWith('phase:')) {
      // Kocka-húzásnál csak az alkalom-törzsek és az új-alkalom zóna a cél.
      const containers = args.droppableContainers.filter((c) => {
        const id = String(c.id);
        return id.startsWith('visitdrop:') || id === 'new-visit-zone';
      });
      const within = pointerWithin({ ...args, droppableContainers: containers });
      if (within.length > 0) return within;
      return rectIntersection({ ...args, droppableContainers: containers });
    }
    // Alkalom-átrendezésnél a sortable kártyák egymás közt.
    const containers = args.droppableContainers.filter((c) =>
      String(c.id).startsWith('visit:')
    );
    return closestCenter({ ...args, droppableContainers: containers });
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragType(String(event.active.id).startsWith('phase:') ? 'phase' : 'visit');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragType(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    if (activeId.startsWith('visit:')) {
      if (!overId.startsWith('visit:') || activeId === overId) return;
      const from = visits.findIndex((v) => `visit:${v.id}` === activeId);
      const to = visits.findIndex((v) => `visit:${v.id}` === overId);
      if (from < 0 || to < 0 || from === to) return;
      void persistVisitOrder(arrayMove(visits, from, to));
      return;
    }

    if (activeId.startsWith('phase:')) {
      const stepId = activeId.slice('phase:'.length);
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;
      if (overId === 'new-visit-zone') {
        void handleMoveTile(step, 'new');
        return;
      }
      if (overId.startsWith('visitdrop:')) {
        const targetVisitId = overId.slice('visitdrop:'.length);
        if (targetVisitId !== step.visitId) void handleMoveTile(step, targetVisitId);
      }
    }
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
      // Az összevonás a viziteket is átrendezi (a csoport egy alkalomba kerül).
      await loadSteps();
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
      await loadSteps();
      showToast('Összevonás felbontva', 'success');
      notifyPlanChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba a szétbontásnál', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Add tooth treatment to steps ──────────────────────────────────────

  /** Új kocka a cél-alkalomba: a POST mindig új egyfős vizitet készít, a
      cél-alkalom választásnál egy második PATCH viszi át (a kiürült auto-vizitet
      a szerver takarítja). */
  const moveNewPhaseToAdderTarget = async (newPhaseId: string | null) => {
    if (!newPhaseId || adderTargetVisitId === 'new') return;
    const res = await fetch(`/api/episodes/${episodeId}/work-phases/${newPhaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ visitId: adderTargetVisitId }),
    });
    if (!res.ok) {
      showToast('A munkafázis hozzáadva, de a cél-alkalomba helyezés nem sikerült', 'error');
    }
  };

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
      const rows: Array<Record<string, unknown>> = data.workPhases ?? [];
      const newRow = rows.find((r) => String(r.toothTreatmentId ?? '') === tt.id);
      await moveNewPhaseToAdderTarget(newRow ? String(newRow.id) : null);
      await loadSteps();
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
      await moveNewPhaseToAdderTarget(row ? String(row.id) : null);
      await loadSteps();
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
      await moveNewPhaseToAdderTarget(row ? String(row.id) : null);
      await loadSteps();
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

  // ─── Alkalom-csoportosítás (WP-4.3) ─────────────────────────────────────
  const visitGroups = useMemo(() => {
    const known = new Set(visits.map((v) => v.id));
    const byVisit = new Map<string, EpisodeStep[]>();
    const unassigned: EpisodeStep[] = [];
    for (const s of primarySteps) {
      if (s.visitId && known.has(s.visitId)) {
        const arr = byVisit.get(s.visitId) ?? [];
        arr.push(s);
        byVisit.set(s.visitId, arr);
      } else {
        // Vizit nélküli sor (backfill előtti / hibás adat) — külön szakaszban
        // jelenik meg, az áthelyezés-menüvel besorolható.
        unassigned.push(s);
      }
    }
    return {
      groups: visits.map((v) => ({ visit: v, phases: byVisit.get(v.id) ?? [] })),
      unassigned,
    };
  }, [primarySteps, visits]);

  /** A kockák globális sorszáma és a „Következő" jelölés az alkalom-sorrendben. */
  const orderedPrimarySteps = useMemo(
    () => [...visitGroups.groups.flatMap((g) => g.phases), ...visitGroups.unassigned],
    [visitGroups]
  );
  const globalIdxByStepId = useMemo(() => {
    const m = new Map<string, number>();
    orderedPrimarySteps.forEach((s, i) => m.set(s.id, i));
    return m;
  }, [orderedPrimarySteps]);
  const nextPendingStepId = useMemo(
    () =>
      orderedPrimarySteps.find((s) => s.status === 'pending' || s.status === 'scheduled')?.id ??
      null,
    [orderedPrimarySteps]
  );

  const visitSortableIds = useMemo(() => visits.map((v) => `visit:${v.id}`), [visits]);

  const hasPathways = carePathwayId || (episodePathways && episodePathways.length > 0);
  const availableToothTreatments = useMemo(
    () => linkedTreatments.filter((t) => !(t.inWorkPhases ?? t.inSteps)),
    [linkedTreatments]
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  // Re-validate the plan whenever a step's identity, status, pool, duration or
  // offset changes (az offset a vetítési ablakokat tolja el).
  const planSignature = useMemo(
    () => steps.map((s) => `${s.id}:${s.status}:${s.pool}:${s.durationMinutes}:${s.defaultDaysOffset}:${s.visitId ?? ''}`).join('|'),
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

  /** Terv-kocka → worklist-akciók (workPhaseId-n párosítva). */
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

  const visitOptionLabel = useCallback(
    (visit: EpisodeVisit, index: number): string => {
      const group = visitGroups.groups.find((g) => g.visit.id === visit.id);
      const title = visitDisplayLabel(visit, group?.phases ?? [], getStepLabel);
      return `${index + 1}. alkalom — ${title}`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visitGroups, stepLabels]
  );

  const pendingCount = primarySteps.filter((s) => s.status === 'pending').length;
  const showConvertAllInAdder =
    booking.enabled && booking.hasReady && pendingCount >= 2 && !booking.chainBookingRequired;

  /** Egy kocka (+ inline megerősítő) kirenderelése — kártyán belül és a
      besorolatlan szakaszban is ugyanez. */
  const renderTile = (step: EpisodeStep) => (
    <VisitPhaseTile
      key={step.id}
      step={step}
      idx={globalIdxByStepId.get(step.id) ?? 0}
      isNext={step.id === nextPendingStepId}
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
      visits={visits}
      visitOptionLabel={visitOptionLabel}
      onMoveToVisit={(s, target) => void handleMoveTile(s, target)}
      dragDisabled={mergeMode}
    />
  );

  const hasAnyPlanContent = visits.length > 0 || primarySteps.length > 0;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Kezelési terv</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Az epizód alkalmai és munkafázisai, állapotuk és tervezett ütemezésük
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
                    <button
                      onClick={() => { setAdderTab('catalog'); setAdderOpen(true); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-md text-sm hover:border-medical-primary hover:text-medical-primary transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Munkafázis hozzáadása
                    </button>
                    {/* A sablon másodlagos művelet (WP-4.3): explicit feltöltés,
                        utána a terv szabadon alakítható — automatikus
                        újragenerálás nincs (WP-0.7). */}
                    {hasPathways && (
                      <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-md text-sm hover:border-medical-primary hover:text-medical-primary transition-colors disabled:opacity-50"
                        title="A kiválasztott sablon munkafázisainak beszúrása — a terv utána szabadon alakítható"
                      >
                        {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                        Feltöltés sablonból
                      </button>
                    )}
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

                    {/* Cél-alkalom választó — az új kocka ide kerül */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <label
                        htmlFor="adder-target-visit"
                        className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap"
                      >
                        Cél-alkalom:
                      </label>
                      <select
                        id="adder-target-visit"
                        value={adderTargetVisitId}
                        onChange={(e) => setAdderTargetVisitId(e.target.value)}
                        className="text-sm border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 max-w-full"
                      >
                        <option value="new">Új alkalom (a terv végére)</option>
                        {visits.map((v, i) => (
                          <option key={v.id} value={v.id}>
                            {visitOptionLabel(v, i)}
                          </option>
                        ))}
                      </select>
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

              {/* ─── Alkalom-kártyák (WP-4.3) ────────────────────────── */}
              {!hasAnyPlanContent ? (
                <div className="mb-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3 text-sm text-gray-600 dark:text-gray-400">
                  A kezelési terv még üres. Vegyen fel munkafázist a „Munkafázis
                  hozzáadása" gombbal, hozzon létre alkalmat az „Új alkalom"
                  gombbal{hasPathways ? ', vagy töltse fel a tervet sablonból' : ''}.
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Egy kártya = egy betegvizit-alkalom. A kezelés-kockák húzással
                  vagy az „Áthelyezés" menüvel vihetők másik alkalomba; az
                  alkalmak sorrendje húzással vagy a fel/le gombokkal módosítható.
                </p>
              )}

              {mounted ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={collisionDetection}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setActiveDragType(null)}
                  modifiers={activeDragType === 'visit' ? [restrictToVerticalAxis] : []}
                >
                  <div className="space-y-2">
                    <SortableContext items={visitSortableIds} strategy={verticalListSortingStrategy}>
                      {visitGroups.groups.map(({ visit, phases }, index) => (
                        <VisitCard
                          key={visit.id}
                          visit={visit}
                          index={index}
                          visitCount={visits.length}
                          title={visitDisplayLabel(visit, phases, getStepLabel)}
                          statusSummary={summarizeVisitStatus(phases)}
                          totalMinutes={visitTotalMinutes(visit, phases)}
                          dateInfo={visitDateInfo(phases, projectionByPhaseId)}
                          phaseCount={phases.length}
                          saving={saving}
                          onMoveUp={() => handleMoveVisit(visit.id, -1)}
                          onMoveDown={() => handleMoveVisit(visit.id, 1)}
                          onDeleteEmpty={() => void handleDeleteEmptyVisit(visit.id)}
                          onSaveMeta={(patch) => handleSaveVisitMeta(visit.id, patch)}
                        >
                          {phases.map((step) => renderTile(step))}
                        </VisitCard>
                      ))}
                    </SortableContext>

                    {/* Vizit nélküli (backfill előtti) sorok — besorolhatók */}
                    {visitGroups.unassigned.length > 0 && (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20">
                        <div className="px-3 py-2 border-b border-amber-100 dark:border-amber-900 text-sm font-medium text-amber-800 dark:text-amber-300">
                          Alkalomhoz nem rendelt munkafázisok — az „Áthelyezés"
                          menüvel sorolhatók be
                        </div>
                        <div className="p-2 space-y-1">
                          {visitGroups.unassigned.map((step) => renderTile(step))}
                        </div>
                      </div>
                    )}

                    {/* Új alkalom: gomb + ejtő-zóna */}
                    <NewVisitZone onCreate={() => void handleAddEmptyVisit()} saving={saving} />
                  </div>
                </DndContext>
              ) : (
                <div className="animate-pulse space-y-2">
                  {(visits.length > 0 ? visits : [1, 2]).map((_, i) => (
                    <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl" />
                  ))}
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
