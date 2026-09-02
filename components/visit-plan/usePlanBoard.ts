'use client';

/**
 * A vizit-alapú kezelési terv kliens-állapota — OPTIMISTA mutációkkal.
 *
 * Elv: minden szerkesztés azonnal látszik (ideiglenes `tmp…` azonosítóval,
 * ha még nincs szerver-id), a kérés a háttérben megy; siker esetén a választ
 * befésüljük (nincs teljes újratöltés), hiba esetén visszaállunk a művelet
 * előtti pillanatképre és hibát jelzünk. Sikeres rutin-műveletről (hozzáadás,
 * áthelyezés, törlés, vizitköz) NEM megy toast — ez a „lomha" érzés egyik
 * forrása volt, a másik a karton-szintű kaszkád-újratöltés, amit csak a
 * státuszt érintő változásoknál indítunk (`onStatusChanged`).
 *
 * A megjelenítési sorrend a `steps` tömb sorrendje (vizit → azon belül tömb-
 * sorrend); a szerver ugyanígy számoz át (vizit, azon belül a mai sorrend, az
 * áthelyezett/új sor az alkalom végén), így a visszatöltés nem ugráltat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import {
  DEFAULT_VISIT_GAP_DAYS,
  buildVisitGroups,
  isTempId,
  mapCatalogResponse,
  mapVisitsResponse,
  mapWorkPhaseApiToEpisodeStep,
  mapWorkPhasesResponse,
  type EpisodeStep,
  type EpisodeVisit,
  type LinkedToothTreatment,
  type PaletteItem,
  type StepProjectionInfo,
  type VisitTarget,
} from './visit-plan-types';

export type ShowToastFn = (message: string, type?: 'success' | 'error' | 'info') => unknown;
export type ConfirmFn = (
  message: string,
  options?: { type?: 'danger' | 'warning' | 'info'; confirmText?: string; cancelText?: string; title?: string }
) => Promise<boolean>;

export interface StepProjectionSummary {
  completedCount: number;
  remainingCount: number;
  estimatedCompletionEarliest: string | null;
  estimatedCompletionLatest: string | null;
  nextStepWaitDays: number | null;
}

export interface UsePlanBoardOptions {
  episodeId: string;
  showToast: ShowToastFn;
  confirm: ConfirmFn;
  /** Státuszt érintő változás (átugrás, újranyitás, törlés, sablon) — a karton felsőbb szintje erre frissít. */
  onStatusChanged?: () => void;
  /** Bármely terv-mutáció után (a foglalási motor worklistje erre frissül). */
  onPlanChanged?: () => void;
  /** Külső frissítő kulcs (pl. beállítás-mentés) — változásra teljes újratöltés. */
  refreshTrigger?: number;
}

interface BoardState {
  steps: EpisodeStep[];
  visits: EpisodeVisit[];
}

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string; code?: string };
}

async function apiJson<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; json?: unknown } = {}
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { method: init.method ?? 'GET', credentials: 'include', headers, body });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  return { ok: res.ok, status: res.status, data };
}

function errorMessage(result: ApiResult<unknown>, fallback: string): string {
  const err = (result.data as { error?: unknown } | null)?.error;
  return typeof err === 'string' && err.trim() ? err : fallback;
}

// A katalógus ritkán változik — modulszintű cache, hogy epizódváltás /
// újracsatolás ne kérje le újra (a szerver is 5 percre cache-el).
const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache: { at: number; items: PaletteItem[] } | null = null;
export function _resetPlanBoardCachesForTests(): void {
  catalogCache = null;
}

export interface PlanBoardApi {
  steps: EpisodeStep[];
  visits: EpisodeVisit[];
  groups: ReturnType<typeof buildVisitGroups>['groups'];
  unassigned: EpisodeStep[];
  stepsById: Map<string, EpisodeStep>;
  catalog: PaletteItem[];
  catalogLabelByCode: Map<string, string>;
  linkedTreatments: LinkedToothTreatment[];
  availableToothTreatments: LinkedToothTreatment[];
  projectionByPhaseId: Map<string, StepProjectionInfo>;
  projectionSummary: StepProjectionSummary | null;
  projectionBlockedReason: string | null;
  loading: boolean;
  generating: boolean;
  pendingIds: Set<string>;
  activeVisitId: string | null;
  setActiveVisitId: (id: string | null) => void;

  reload: () => Promise<boolean>;
  loadProjections: () => Promise<void>;

  addFromCatalog: (item: PaletteItem, target?: VisitTarget) => Promise<void>;
  addFreeText: (label: string, target?: VisitTarget) => Promise<void>;
  addToothTreatment: (tt: LinkedToothTreatment, target?: VisitTarget) => Promise<void>;
  moveStep: (stepId: string, target: VisitTarget) => Promise<void>;
  deleteStep: (stepId: string) => Promise<void>;
  skipStep: (stepId: string, reason?: string) => Promise<void>;
  unskipStep: (stepId: string) => Promise<void>;
  reopenStep: (stepId: string, reason: string) => Promise<void>;
  updateScope: (
    stepId: string,
    patch: { jaw?: EpisodeStep['jaw']; teeth?: string[]; durationMinutes?: number; customLabel?: string }
  ) => Promise<void>;

  updateVisit: (visitId: string, patch: { label?: string | null; daysOffset?: number }) => Promise<void>;
  reorderVisits: (orderedIds: string[]) => Promise<void>;
  moveVisit: (visitId: string, direction: -1 | 1) => Promise<void>;
  createEmptyVisit: () => Promise<string | null>;
  deleteEmptyVisit: (visitId: string) => Promise<void>;

  applyTemplate: () => Promise<void>;
  /** Alkalom egy foglalható blokkba vonása; a primary fázis id-ját adja (null = hiba). */
  prepareVisitBooking: (visitId: string) => Promise<string | null>;
}

export function usePlanBoard({
  episodeId,
  showToast,
  confirm,
  onStatusChanged,
  onPlanChanged,
  refreshTrigger,
}: UsePlanBoardOptions): PlanBoardApi {
  // A callback-propok ref-en át hívódnak, hogy a mutációs closure-ök ne
  // ragadjanak be egy régi példányra (a szülő minden rendernél újat adhat).
  const onStatusChangedRef = useRef(onStatusChanged);
  onStatusChangedRef.current = onStatusChanged;
  const onPlanChangedRef = useRef(onPlanChanged);
  onPlanChangedRef.current = onPlanChanged;

  const [board, setBoardState] = useState<BoardState>({ steps: [], visits: [] });
  const boardRef = useRef<BoardState>(board);
  /** Szinkron ref + state: az async műveletek mindig a legfrissebb állapotból indulnak. */
  const setBoard = useCallback((updater: (prev: BoardState) => BoardState) => {
    boardRef.current = updater(boardRef.current);
    setBoardState(boardRef.current);
  }, []);

  const [catalog, setCatalog] = useState<PaletteItem[]>([]);
  const [linkedTreatments, setLinkedTreatments] = useState<LinkedToothTreatment[]>([]);
  const [projections, setProjections] = useState<StepProjectionInfo[]>([]);
  const [projectionSummary, setProjectionSummary] = useState<StepProjectionSummary | null>(null);
  const [projectionBlockedReason, setProjectionBlockedReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [activeVisitId, setActiveVisitIdState] = useState<string | null>(null);
  const activeVisitRef = useRef<string | null>(null);
  const setActiveVisitId = useCallback((id: string | null) => {
    activeVisitRef.current = id;
    setActiveVisitIdState(id);
  }, []);

  const tmpCounter = useRef(0);
  const tmpStepId = () => `tmp:${++tmpCounter.current}`;
  const tmpVisitId = () => `tmpv:${++tmpCounter.current}`;

  const markPending = useCallback((ids: Iterable<string>, on: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of Array.from(ids)) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  // ─── Betöltés ───────────────────────────────────────────────────────────

  const reload = useCallback(async (): Promise<boolean> => {
    const result = await apiJson<{
      workPhases?: unknown[];
      steps?: unknown[];
      visits?: unknown[];
      lostAppointmentWorkPhaseIds?: unknown[];
    }>(`/api/episodes/${episodeId}/work-phases`);
    if (!result.ok) return false;
    setBoard(() => ({
      steps: mapWorkPhasesResponse(
        result.data.workPhases ?? result.data.steps,
        result.data.lostAppointmentWorkPhaseIds
      ),
      visits: mapVisitsResponse(result.data.visits),
    }));
    return true;
  }, [episodeId, setBoard]);

  const loadCatalog = useCallback(async () => {
    if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
      setCatalog(catalogCache.items);
      return;
    }
    try {
      const result = await apiJson<{ items?: unknown[]; steps?: unknown[] }>('/api/step-catalog');
      if (!result.ok) return;
      const items = mapCatalogResponse(result.data.items ?? result.data.steps);
      catalogCache = { at: Date.now(), items };
      setCatalog(items);
    } catch {
      /* non-critical — a címkék a kódból is olvashatók */
    }
  }, []);

  const loadLinkedTreatments = useCallback(async () => {
    try {
      const result = await apiJson<{ treatments?: LinkedToothTreatment[] }>(
        `/api/episodes/${episodeId}/linked-tooth-treatments`
      );
      if (result.ok) setLinkedTreatments(result.data.treatments ?? []);
    } catch {
      /* non-critical */
    }
  }, [episodeId]);

  const projectionsInFlightRef = useRef<Promise<void> | null>(null);
  const loadProjections = useCallback(async () => {
    if (projectionsInFlightRef.current) return projectionsInFlightRef.current;
    const run = (async () => {
      try {
        const result = await apiJson<{
          blocked?: boolean;
          blockedReason?: string;
          steps?: StepProjectionInfo[];
          summary?: StepProjectionSummary | null;
        }>(`/api/episodes/${episodeId}/step-projections`);
        if (!result.ok) return;
        if (result.data.blocked) {
          setProjections([]);
          setProjectionSummary(null);
          setProjectionBlockedReason(result.data.blockedReason ?? 'Ismeretlen ok');
          return;
        }
        setProjections(result.data.steps ?? []);
        setProjectionSummary(result.data.summary ?? null);
        setProjectionBlockedReason(null);
      } catch {
        /* nem kritikus — a tábla dátumok nélkül is használható */
      }
    })();
    projectionsInFlightRef.current = run.finally(() => {
      projectionsInFlightRef.current = null;
    });
    return projectionsInFlightRef.current;
  }, [episodeId]);

  // A vetítés drága (motor-futás) — mutáció után összevonva, késleltetve kérjük.
  const projTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleProjections = useCallback(
    (delayMs = 400) => {
      if (projTimer.current) clearTimeout(projTimer.current);
      projTimer.current = setTimeout(() => {
        projTimer.current = null;
        void loadProjections();
      }, delayMs);
    },
    [loadProjections]
  );
  useEffect(() => () => {
    if (projTimer.current) clearTimeout(projTimer.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([reload(), loadCatalog(), loadLinkedTreatments()]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    void loadProjections();
    return () => {
      cancelled = true;
    };
  }, [reload, loadCatalog, loadLinkedTreatments, loadProjections, refreshTrigger]);

  // Külső mutációk (foglalási modalok, időpontlista) → teljes újratöltés.
  useEffect(() => {
    const handler = () => {
      void reload();
      void loadProjections();
      onPlanChangedRef.current?.();
    };
    window.addEventListener('episode-work-phases-reload', handler);
    return () => window.removeEventListener('episode-work-phases-reload', handler);
  }, [reload, loadProjections]);

  // ─── Származtatott nézetek ──────────────────────────────────────────────

  const { groups, unassigned } = useMemo(
    () => buildVisitGroups(board.steps, board.visits),
    [board.steps, board.visits]
  );
  const stepsById = useMemo(() => new Map(board.steps.map((s) => [s.id, s])), [board.steps]);
  const catalogLabelByCode = useMemo(
    () => new Map(catalog.map((c) => [c.stepCode, c.labelHu])),
    [catalog]
  );
  const availableToothTreatments = useMemo(
    () => linkedTreatments.filter((t) => !(t.inWorkPhases ?? t.inSteps)),
    [linkedTreatments]
  );
  const projectionByPhaseId = useMemo(() => {
    const m = new Map<string, StepProjectionInfo>();
    for (const p of projections) if (p.workPhaseId) m.set(String(p.workPhaseId), p);
    return m;
  }, [projections]);

  // Aktív alkalom: ha megszűnt / nincs, az utolsó még nyitott alkalom.
  useEffect(() => {
    const current = activeVisitRef.current;
    if (current && board.visits.some((v) => v.id === current)) return;
    let fallback: string | null = null;
    for (const g of groups) {
      const closed =
        g.primaries.length > 0 &&
        g.primaries.every((p) => p.status === 'completed' || p.status === 'skipped');
      if (!closed) fallback = g.visit.id;
    }
    if (!fallback && board.visits.length > 0) fallback = board.visits[board.visits.length - 1].id;
    setActiveVisitId(fallback);
  }, [board.visits, groups, setActiveVisitId]);

  // ─── Belső segédek ──────────────────────────────────────────────────────

  /**
   * Cél-alkalom feloldása optimista módon: meglévő id → az; 'new' / nincs
   * ilyen → ideiglenes alkalom a lista végére (a szerver-id a válaszból jön).
   */
  const resolveTarget = (target: VisitTarget | undefined): { visitId: string; created: EpisodeVisit | null } => {
    const b = boardRef.current;
    const wanted = target ?? activeVisitRef.current ?? 'new';
    if (wanted !== 'new' && b.visits.some((v) => v.id === wanted)) {
      return { visitId: wanted, created: null };
    }
    const created: EpisodeVisit = {
      id: tmpVisitId(),
      seq: b.visits.length,
      label: null,
      daysOffset: DEFAULT_VISIT_GAP_DAYS,
      plannedDurationMinutes: null,
    };
    setBoard((prev) => ({ ...prev, visits: [...prev.visits, created] }));
    return { visitId: created.id, created };
  };

  /** Az ideiglenes alkalom lecserélése a szerver által adott sorra (sorokban is). */
  const replaceVisit = (tempId: string, real: EpisodeVisit) => {
    setBoard((prev) => ({
      steps: prev.steps.map((s) => (s.visitId === tempId ? { ...s, visitId: real.id } : s)),
      visits: prev.visits.map((v) => (v.id === tempId ? real : v)),
    }));
    if (activeVisitRef.current === tempId) setActiveVisitId(real.id);
  };

  const removeTempVisit = (tempId: string) => {
    setBoard((prev) => ({ ...prev, visits: prev.visits.filter((v) => v.id !== tempId) }));
  };

  const restore = (snapshot: BoardState) => setBoard(() => snapshot);

  /** Közös hozzáadási út: ideiglenes kocka → POST → befésülés. */
  const addStep = async (
    tempStep: Omit<EpisodeStep, 'id' | 'visitId' | 'episodeId'>,
    target: VisitTarget | undefined,
    request: (visitBody: { visitId?: string; daysOffset?: number }) => Promise<
      ApiResult<{ workPhase?: Record<string, unknown>; workPhases?: Record<string, unknown>[]; workPhaseId?: string; visit?: unknown }>
    >,
    fallbackError: string
  ): Promise<{ id: string } | null> => {
    const snapshot = boardRef.current;
    const tId = tmpStepId();
    const { visitId, created } = resolveTarget(target);
    const optimistic: EpisodeStep = { ...tempStep, id: tId, episodeId, visitId };
    setBoard((prev) => ({ ...prev, steps: [...prev.steps, optimistic] }));
    setActiveVisitId(visitId);
    markPending([tId, ...(created ? [created.id] : [])], true);
    try {
      const result = await request(
        created ? { daysOffset: DEFAULT_VISIT_GAP_DAYS } : { visitId }
      );
      if (!result.ok) {
        restore(snapshot);
        showToast(errorMessage(result, fallbackError), 'error');
        return null;
      }
      const rawRow =
        result.data.workPhase ??
        (result.data.workPhaseId
          ? result.data.workPhases?.find((r) => String(r.id) === String(result.data.workPhaseId))
          : undefined);
      const newVisit = result.data.visit ? mapVisitsResponse([result.data.visit])[0] : null;
      if (created) {
        if (newVisit) replaceVisit(created.id, newVisit);
        else {
          // Nem várt válasz-alak — a biztos út a teljes újratöltés.
          await reload();
          return null;
        }
      }
      if (rawRow) {
        const row = mapWorkPhaseApiToEpisodeStep(rawRow);
        setBoard((prev) => ({
          ...prev,
          steps: prev.steps.map((s) => (s.id === tId ? { ...row, visitId: row.visitId ?? s.visitId } : s)),
        }));
        return { id: row.id };
      }
      await reload();
      return null;
    } catch {
      restore(snapshot);
      showToast(fallbackError, 'error');
      return null;
    } finally {
      markPending([tId, ...(created ? [created.id] : [])], false);
      scheduleProjections();
      onPlanChangedRef.current?.();
    }
  };

  const baseTempStep = (partial: Partial<EpisodeStep>): Omit<EpisodeStep, 'id' | 'visitId' | 'episodeId'> => ({
    stepCode: partial.stepCode ?? 'adhoc',
    pathwayOrderIndex: 0,
    pool: partial.pool ?? 'work',
    durationMinutes: partial.durationMinutes ?? 30,
    defaultDaysOffset: DEFAULT_VISIT_GAP_DAYS,
    status: 'pending',
    appointmentId: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    sourceEpisodePathwayId: null,
    seq: null,
    customLabel: partial.customLabel ?? null,
    toothTreatmentId: partial.toothTreatmentId ?? null,
    mergedIntoStepId: null,
    toothNumber: partial.toothNumber ?? null,
    treatmentLabel: partial.treatmentLabel ?? null,
    jaw: null,
    teeth: [],
  });

  // ─── Hozzáadás ──────────────────────────────────────────────────────────

  const addFromCatalog = useCallback(
    async (item: PaletteItem, target?: VisitTarget) => {
      await addStep(
        baseTempStep({
          stepCode: item.stepCode,
          pool: item.defaultPool ?? 'work',
          durationMinutes: item.defaultDurationMinutes ?? 30,
        }),
        target,
        (visitBody) =>
          apiJson(`/api/episodes/${episodeId}/work-phases`, {
            method: 'POST',
            json: { workPhaseCode: item.stepCode, ...visitBody },
          }),
        'Nem sikerült a munkafázis hozzáadása'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  const addFreeText = useCallback(
    async (label: string, target?: VisitTarget) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      await addStep(
        baseTempStep({ stepCode: 'adhoc', customLabel: trimmed, durationMinutes: 30, pool: 'work' }),
        target,
        (visitBody) =>
          apiJson(`/api/episodes/${episodeId}/work-phases`, {
            method: 'POST',
            json: { label: trimmed, pool: 'work', durationMinutes: 30, ...visitBody },
          }),
        'Nem sikerült az egyedi munkafázis hozzáadása'
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  const addToothTreatment = useCallback(
    async (tt: LinkedToothTreatment, target?: VisitTarget) => {
      const added = await addStep(
        baseTempStep({
          stepCode: `tooth_${tt.treatmentCode}`,
          customLabel: `${tt.labelHu} – ${tt.toothNumber}`,
          toothTreatmentId: tt.id,
          toothNumber: tt.toothNumber,
          treatmentLabel: tt.labelHu,
        }),
        target,
        (visitBody) =>
          apiJson(`/api/episodes/${episodeId}/work-phases/from-tooth-treatment`, {
            method: 'POST',
            json: { toothTreatmentId: tt.id, ...visitBody },
          }),
        'Nem sikerült a fogkezelés hozzáadása'
      );
      if (added) {
        setLinkedTreatments((prev) =>
          prev.map((t) => (t.id === tt.id ? { ...t, inWorkPhases: true, inSteps: true } : t))
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  // ─── Áthelyezés / törlés ────────────────────────────────────────────────

  const moveStep = useCallback(
    async (stepId: string, target: VisitTarget) => {
      const b0 = boardRef.current;
      const step = b0.steps.find((s) => s.id === stepId);
      if (!step || isTempId(stepId)) return;
      if (target !== 'new' && target === step.visitId) return;
      const snapshot = b0;
      // Primary → a rejtett összevont gyerekei is mennek; gyerek → kilép a
      // csoportból és önállóan költözik (a szerver ugyanígy).
      const groupIds = new Set<string>([
        stepId,
        ...b0.steps.filter((s) => s.mergedIntoStepId === stepId).map((s) => s.id),
      ]);
      const { visitId: targetId, created } = resolveTarget(target);
      const sourceVisitId = step.visitId;
      setBoard((prev) => {
        const moved = prev.steps
          .filter((s) => groupIds.has(s.id))
          .map((s) => ({
            ...s,
            visitId: targetId,
            mergedIntoStepId: s.id === stepId ? null : s.mergedIntoStepId,
          }));
        const rest = prev.steps.filter((s) => !groupIds.has(s.id));
        const steps = [...rest, ...moved];
        const sourceStillUsed = sourceVisitId ? steps.some((s) => s.visitId === sourceVisitId) : true;
        return {
          steps,
          visits: sourceStillUsed ? prev.visits : prev.visits.filter((v) => v.id !== sourceVisitId),
        };
      });
      markPending([...Array.from(groupIds), ...(created ? [created.id] : [])], true);
      let createdRealId: string | null = null;
      try {
        let realTargetId = targetId;
        if (created) {
          const vr = await apiJson<{ visit?: unknown }>(`/api/episodes/${episodeId}/visits`, {
            method: 'POST',
            json: { daysOffset: DEFAULT_VISIT_GAP_DAYS },
          });
          if (!vr.ok || !vr.data.visit) throw new Error(errorMessage(vr, 'Nem sikerült új alkalmat létrehozni'));
          const real = mapVisitsResponse([vr.data.visit])[0];
          createdRealId = real.id;
          realTargetId = real.id;
          replaceVisit(created.id, real);
        }
        const pr = await apiJson(`/api/episodes/${episodeId}/work-phases/${stepId}`, {
          method: 'PATCH',
          json: { visitId: realTargetId },
        });
        if (!pr.ok) {
          if (createdRealId) {
            // Az üresen maradt új alkalom ne maradjon szemétként.
            void apiJson(`/api/episodes/${episodeId}/visits/${createdRealId}`, { method: 'DELETE' });
          }
          throw new Error(errorMessage(pr, 'Hiba az áthelyezésnél'));
        }
        setActiveVisitId(realTargetId);
      } catch (e) {
        restore(snapshot);
        showToast(e instanceof Error ? e.message : 'Hiba az áthelyezésnél', 'error');
        void reload();
      } finally {
        markPending([...Array.from(groupIds), ...(created ? [created.id] : [])], false);
        scheduleProjections();
        onPlanChangedRef.current?.();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  const deleteStep = useCallback(
    async (stepId: string) => {
      const b0 = boardRef.current;
      const step = b0.steps.find((s) => s.id === stepId);
      if (!step || isTempId(stepId)) return;
      const label = step.customLabel ?? catalogLabelByCode.get(step.stepCode) ?? step.stepCode;
      if (step.status === 'scheduled') {
        const ok = await confirm(
          `A(z) „${label}" fázishoz foglalt időpont tartozik — az elhagyással a jövőbeli időpont is lemondásra kerül.`,
          { type: 'danger', confirmText: 'Elhagyom', cancelText: 'Mégse', title: 'Fázis elhagyása' }
        );
        if (!ok) return;
      } else if (step.status === 'completed') {
        const ok = await confirm(
          `A(z) „${label}" fázis teljesítettként van jelölve — elhagyással a terv előzményéből is eltűnik.`,
          { type: 'danger', confirmText: 'Elhagyom', cancelText: 'Mégse', title: 'Fázis elhagyása' }
        );
        if (!ok) return;
      }
      const snapshot = b0;
      setBoard((prev) => {
        const steps = prev.steps
          .filter((s) => s.id !== stepId)
          // Összevont csoport szülőjének törlésekor a gyerekek önálló sorrá válnak (FK SET NULL).
          .map((s) => (s.mergedIntoStepId === stepId ? { ...s, mergedIntoStepId: null } : s));
        // A kiürült alkalmat a szerver is törli (deleteEpisodeVisitsIfEmpty).
        const stillUsed = step.visitId ? steps.some((s) => s.visitId === step.visitId) : true;
        return { steps, visits: stillUsed ? prev.visits : prev.visits.filter((v) => v.id !== step.visitId) };
      });
      const result = await apiJson<{ cancelledAppointments?: number }>(
        `/api/episodes/${episodeId}/work-phases/${stepId}`,
        { method: 'DELETE' }
      );
      if (!result.ok) {
        restore(snapshot);
        showToast(errorMessage(result, 'Hiba a törlésnél'), 'error');
        return;
      }
      const cancelled = result.data.cancelledAppointments ?? 0;
      if (cancelled > 0) showToast(`${cancelled} foglalt időpont lemondva`, 'info');
      if (step.status === 'scheduled' || step.status === 'completed') onStatusChangedRef.current?.();
      scheduleProjections();
      onPlanChangedRef.current?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId, catalogLabelByCode]
  );

  // ─── Státusz ────────────────────────────────────────────────────────────

  const patchStatus = async (
    stepId: string,
    body: { status: EpisodeStep['status']; reason: string },
    fallbackError: string
  ) => {
    const b0 = boardRef.current;
    const step = b0.steps.find((s) => s.id === stepId);
    if (!step || isTempId(stepId)) return;
    const snapshot = b0;
    setBoard((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === stepId ? { ...s, status: body.status } : s)),
    }));
    markPending([stepId], true);
    try {
      const result = await apiJson<{
        workPhase?: Record<string, unknown>;
        step?: Record<string, unknown>;
        cancelledAppointments?: number;
      }>(`/api/episodes/${episodeId}/work-phases/${stepId}`, { method: 'PATCH', json: body });
      if (!result.ok) {
        restore(snapshot);
        showToast(errorMessage(result, fallbackError), 'error');
        return;
      }
      const row = result.data.workPhase ?? result.data.step;
      if (row) {
        const mapped = mapWorkPhaseApiToEpisodeStep(row);
        setBoard((prev) => ({
          ...prev,
          steps: prev.steps.map((s) => (s.id === stepId ? { ...mapped, lostAppointment: false } : s)),
        }));
      }
      const cancelled = result.data.cancelledAppointments ?? 0;
      if (cancelled > 0) showToast(`${cancelled} jövőbeli foglalt időpont lemondva`, 'info');
      onStatusChangedRef.current?.();
    } catch {
      restore(snapshot);
      showToast(fallbackError, 'error');
    } finally {
      markPending([stepId], false);
      scheduleProjections();
      onPlanChangedRef.current?.();
    }
  };

  const skipStep = useCallback(
    (stepId: string, reason?: string) =>
      patchStatus(
        stepId,
        { status: 'skipped', reason: reason?.trim() || 'Manuálisan átugorva' },
        'Nem sikerült az átugrás'
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );
  const unskipStep = useCallback(
    (stepId: string) =>
      patchStatus(stepId, { status: 'pending', reason: 'Visszaállítva várakozóra' }, 'Nem sikerült a visszaállítás'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );
  const reopenStep = useCallback(
    (stepId: string, reason: string) =>
      patchStatus(stepId, { status: 'pending', reason: reason.trim() }, 'Nem sikerült az újranyitás'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  const updateScope = useCallback(
    async (
      stepId: string,
      patch: { jaw?: EpisodeStep['jaw']; teeth?: string[]; durationMinutes?: number; customLabel?: string }
    ) => {
      const b0 = boardRef.current;
      const step = b0.steps.find((s) => s.id === stepId);
      if (!step || isTempId(stepId)) return;
      const snapshot = b0;
      setBoard((prev) => ({
        ...prev,
        steps: prev.steps.map((s) =>
          s.id === stepId
            ? {
                ...s,
                jaw: patch.jaw !== undefined ? patch.jaw : s.jaw,
                teeth: patch.teeth ?? s.teeth,
                durationMinutes: patch.durationMinutes ?? s.durationMinutes,
                customLabel: patch.customLabel !== undefined ? patch.customLabel || null : s.customLabel,
              }
            : s
        ),
      }));
      const result = await apiJson<{ workPhase?: Record<string, unknown> }>(
        `/api/episodes/${episodeId}/work-phases/${stepId}`,
        { method: 'PATCH', json: patch }
      );
      if (!result.ok) {
        restore(snapshot);
        showToast(errorMessage(result, 'Nem sikerült a hatókör mentése'), 'error');
        return;
      }
      if (result.data.workPhase) {
        const mapped = mapWorkPhaseApiToEpisodeStep(result.data.workPhase);
        setBoard((prev) => ({ ...prev, steps: prev.steps.map((s) => (s.id === stepId ? mapped : s)) }));
      }
      if (patch.durationMinutes !== undefined) scheduleProjections();
      onPlanChangedRef.current?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  // ─── Alkalmak ───────────────────────────────────────────────────────────

  const updateVisit = useCallback(
    async (visitId: string, patch: { label?: string | null; daysOffset?: number }) => {
      if (isTempId(visitId)) return;
      const snapshot = boardRef.current;
      setBoard((prev) => ({
        ...prev,
        visits: prev.visits.map((v) =>
          v.id === visitId
            ? {
                ...v,
                label: patch.label !== undefined ? patch.label : v.label,
                daysOffset: patch.daysOffset !== undefined ? patch.daysOffset : v.daysOffset,
              }
            : v
        ),
      }));
      const result = await apiJson<{ visit?: unknown }>(`/api/episodes/${episodeId}/visits/${visitId}`, {
        method: 'PATCH',
        json: patch,
      });
      if (!result.ok) {
        restore(snapshot);
        showToast(errorMessage(result, 'Nem sikerült az alkalom mentése'), 'error');
        return;
      }
      if (result.data.visit) {
        const mapped = mapVisitsResponse([result.data.visit])[0];
        setBoard((prev) => ({ ...prev, visits: prev.visits.map((v) => (v.id === visitId ? mapped : v)) }));
      }
      if (patch.daysOffset !== undefined) scheduleProjections();
      onPlanChangedRef.current?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  const reorderVisits = useCallback(
    async (orderedIds: string[]) => {
      const snapshot = boardRef.current;
      if (orderedIds.some(isTempId)) return;
      const byId = new Map(snapshot.visits.map((v) => [v.id, v]));
      setBoard((prev) => ({
        ...prev,
        visits: orderedIds.map((id, i) => ({ ...(byId.get(id) as EpisodeVisit), seq: i })).filter(Boolean),
      }));
      const result = await apiJson<{ visits?: unknown[] }>(`/api/episodes/${episodeId}/visits`, {
        method: 'PATCH',
        json: { orderedVisitIds: orderedIds },
      });
      if (!result.ok) {
        restore(snapshot);
        showToast(errorMessage(result, 'Hiba az átrendezésnél'), 'error');
        void reload();
        return;
      }
      if (Array.isArray(result.data.visits)) {
        const visits = mapVisitsResponse(result.data.visits);
        setBoard((prev) => ({ ...prev, visits }));
      }
      scheduleProjections();
      onPlanChangedRef.current?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  const moveVisit = useCallback(
    async (visitId: string, direction: -1 | 1) => {
      const visits = boardRef.current.visits;
      const from = visits.findIndex((v) => v.id === visitId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= visits.length) return;
      await reorderVisits(arrayMove(visits, from, to).map((v) => v.id));
    },
    [reorderVisits]
  );

  const createEmptyVisit = useCallback(async (): Promise<string | null> => {
    const { visitId: tempId, created } = resolveTarget('new');
    if (!created) return tempId;
    setActiveVisitId(tempId);
    markPending([tempId], true);
    try {
      const result = await apiJson<{ visit?: unknown }>(`/api/episodes/${episodeId}/visits`, {
        method: 'POST',
        json: { daysOffset: DEFAULT_VISIT_GAP_DAYS },
      });
      if (!result.ok || !result.data.visit) {
        removeTempVisit(tempId);
        showToast(errorMessage(result, 'Nem sikerült új alkalmat létrehozni'), 'error');
        return null;
      }
      const real = mapVisitsResponse([result.data.visit])[0];
      replaceVisit(tempId, real);
      onPlanChangedRef.current?.();
      return real.id;
    } catch {
      removeTempVisit(tempId);
      showToast('Nem sikerült új alkalmat létrehozni', 'error');
      return null;
    } finally {
      markPending([tempId], false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  const deleteEmptyVisit = useCallback(
    async (visitId: string) => {
      if (isTempId(visitId)) return;
      const snapshot = boardRef.current;
      setBoard((prev) => ({ ...prev, visits: prev.visits.filter((v) => v.id !== visitId) }));
      const result = await apiJson(`/api/episodes/${episodeId}/visits/${visitId}`, { method: 'DELETE' });
      if (!result.ok) {
        restore(snapshot);
        showToast(errorMessage(result, 'Hiba a törlésnél'), 'error');
        void reload();
        return;
      }
      onPlanChangedRef.current?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  // ─── Sablon, foglalás-előkészítés ──────────────────────────────────────

  const applyTemplate = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await apiJson<{ message?: string }>(
        `/api/episodes/${episodeId}/work-phases/generate`,
        { method: 'POST' }
      );
      if (!result.ok) {
        showToast(errorMessage(result, 'Nem sikerült a sablon betöltése'), 'error');
        return;
      }
      await reload();
      showToast(
        typeof result.data.message === 'string' && result.data.message ? result.data.message : 'Sablon betöltve',
        'success'
      );
      scheduleProjections(0);
      onStatusChangedRef.current?.();
      onPlanChangedRef.current?.();
    } catch {
      showToast('Nem sikerült a sablon betöltése', 'error');
    } finally {
      setGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  const prepareVisitBooking = useCallback(
    async (visitId: string): Promise<string | null> => {
      if (isTempId(visitId)) return null;
      const result = await apiJson<{ primaryWorkPhaseId?: string; mergedCount?: number }>(
        `/api/episodes/${episodeId}/visits/${visitId}/prepare-booking`,
        { method: 'POST' }
      );
      if (!result.ok || !result.data.primaryWorkPhaseId) {
        showToast(errorMessage(result, 'Az alkalom nem készíthető elő foglalásra'), 'error');
        return null;
      }
      if ((result.data.mergedCount ?? 0) > 0) {
        await reload();
        scheduleProjections(0);
      }
      return String(result.data.primaryWorkPhaseId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [episodeId]
  );

  return {
    steps: board.steps,
    visits: board.visits,
    groups,
    unassigned,
    stepsById,
    catalog,
    catalogLabelByCode,
    linkedTreatments,
    availableToothTreatments,
    projectionByPhaseId,
    projectionSummary,
    projectionBlockedReason,
    loading,
    generating,
    pendingIds,
    activeVisitId,
    setActiveVisitId,
    reload,
    loadProjections,
    addFromCatalog,
    addFreeText,
    addToothTreatment,
    moveStep,
    deleteStep,
    skipStep,
    unskipStep,
    reopenStep,
    updateScope,
    updateVisit,
    reorderVisits,
    moveVisit,
    createEmptyVisit,
    deleteEmptyVisit,
    applyTemplate,
    prepareVisitBooking,
  };
}
