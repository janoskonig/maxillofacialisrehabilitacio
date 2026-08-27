'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getWorklistItemKey,
  deriveWorklistRowState,
  type WorklistItemBackend,
  type WorklistLocalState,
  type WorklistRowState,
} from '@/lib/worklist-types';
import { formatApiErrorParts } from '@/lib/extract-api-error';
import type { UnsuccessfulAttemptConfirmPayload } from '@/components/UnsuccessfulAttemptModal';
import type { MarkCompletedRetroPayload } from '@/components/MarkCompletedRetroModal';

/**
 * Egy epizódra szűkített munkafázis-foglalási motor — a PatientWorklistWidget
 * foglalási logikája hookként, hogy a Kezelési terv kártya (EpisodeStepsManager)
 * sorai közvetlenül foglalhassanak. A worklist-elemeket a kanonikus
 * `workPhaseId`-n (episode_work_phases.id) párosítjuk a terv-sorokhoz.
 *
 * A modalokat a WorkPhaseBookingModals komponens rendereli ebből az API-ból.
 */

export interface WorkPhaseBookingRetryContext {
  nextAttemptNumber: number;
  previousAttemptNumber: number;
  previousFailedReason: string | null;
  previousAtISO: string | null;
  stepLabel: string | null;
}

export interface WorkPhaseBookingOverride429 {
  error: string;
  overrideHint?: string;
  expectedHardNext?: { stepCode: string; earliestStart: string; latestStart: string; durationMinutes: number };
  existingAppointment?: { id: string; startTime: string; providerName?: string };
  /** A 409-et kapó sor kulcsa — a modal bezárásakor ezzel takarítjuk a lokális lockot. */
  rowKey: string;
  retryData: {
    patientId: string;
    episodeId?: string;
    slotId: string;
    pool: string;
    durationMinutes: number;
    nextStep: string;
    stepCode?: string;
    workPhaseId?: string | null;
    requiresPrecommit?: boolean;
  };
}

export interface UnsuccessfulModalCtx {
  item: WorklistItemBackend;
  appointmentId: string;
  appointmentStart: string | null;
  attemptNumber: number;
}

export interface MarkCompleteRetroCtx {
  item: WorklistItemBackend;
  excludeAppointmentIds: string[];
}

export interface UseWorkPhaseBookingOptions {
  patientId: string | null | undefined;
  episodeId: string;
  /**
   * Munkafázis-státuszt érintő sikeres művelet után hívjuk (foglalás,
   * kész-jelölés, sikertelen-jelölés, lánc-foglalás) — a terv-kártya ebből
   * tölti újra a lépéslistát.
   */
  onChanged?: () => void;
}

export interface WorkPhaseBookingApi {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;

  /** Az epizód worklist-elemei workPhaseId szerint (terv-sor párosításhoz). */
  itemByWorkPhaseId: Map<string, WorklistItemBackend>;
  rowStateFor: (item: WorklistItemBackend) => WorklistRowState;
  /** Epizód-szintű blokk (episode_blocks) — a terv-kártya tetején jelezzük. */
  blockedItem: WorklistItemBackend | null;
  /** Lánc-foglalási ajánlat az epizódra: több lépés egy menetben foglalható. */
  chainBookingRequired: boolean;
  /** Van-e azonnal foglalható (READY) fázis az epizódban. */
  hasReady: boolean;
  /** Van-e egyáltalán worklist-elem az epizódra (ha nincs: a foglalási vezérlők rejtendők). */
  hasItems: boolean;
  planStartDate: string | null;
  /** A worklist ténylegesen szolgáltatott plan_start_date mezőt — enélkül a
      kezdődátum-kontroll nem renderelhető (üres mentés törölné a tárolt dátumot). */
  planStartDateKnown: boolean;

  openSlotPicker: (item: WorklistItemBackend) => void;
  closeSlotPicker: () => void;
  slotPickerItem: WorklistItemBackend | null;
  slotPickerRetryContext: WorkPhaseBookingRetryContext | null;
  handleSelectSlot: (slotId: string) => Promise<void>;

  override429: WorkPhaseBookingOverride429 | null;
  closeOverride: () => void;
  handleOverrideConfirm: (overrideReason: string) => Promise<void>;

  convertAll: () => Promise<void>;
  convertAllBusy: boolean;
  convertAllMessage: { type: 'success' | 'error'; text: string } | null;
  dismissConvertAllMessage: () => void;

  linkAppointmentItem: WorklistItemBackend | null;
  openLinkAppointment: (item: WorklistItemBackend) => void;
  closeLinkAppointment: () => void;
  confirmLinkAppointment: (appointmentId: string, reason: string) => Promise<void>;

  markCompleteRetroCtx: MarkCompleteRetroCtx | null;
  openMarkCompleteRetro: (item: WorklistItemBackend) => void;
  closeMarkCompleteRetro: () => void;
  confirmMarkCompleteRetro: (payload: MarkCompletedRetroPayload) => Promise<void>;

  unsuccessfulModalCtx: UnsuccessfulModalCtx | null;
  openMarkUnsuccessful: (item: WorklistItemBackend) => void;
  closeMarkUnsuccessful: () => void;
  confirmMarkUnsuccessful: (payload: UnsuccessfulAttemptConfirmPayload) => Promise<void>;
}

/**
 * Kereszt-komponens értesítés: a beteg oldalán élő időpontlista
 * (useAppointmentBooking) erre az eseményre tölti újra a foglalásait.
 */
function notifyAppointmentsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('appointments-changed'));
  }
}

export function useWorkPhaseBooking({
  patientId,
  episodeId,
  onChanged,
}: UseWorkPhaseBookingOptions): WorkPhaseBookingApi {
  const enabled = !!patientId;
  const [items, setItems] = useState<WorklistItemBackend[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<WorklistLocalState>({});
  const [chainMap, setChainMap] = useState<Record<string, boolean>>({});
  const [slotPickerItem, setSlotPickerItem] = useState<WorklistItemBackend | null>(null);
  const [slotPickerRetryContext, setSlotPickerRetryContext] =
    useState<WorkPhaseBookingRetryContext | null>(null);
  const [override429, setOverride429] = useState<WorkPhaseBookingOverride429 | null>(null);
  const [convertAllBusy, setConvertAllBusy] = useState(false);
  const [convertAllMessage, setConvertAllMessage] =
    useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [linkAppointmentItem, setLinkAppointmentItem] = useState<WorklistItemBackend | null>(null);
  const [markCompleteRetroCtx, setMarkCompleteRetroCtx] = useState<MarkCompleteRetroCtx | null>(null);
  const [unsuccessfulModalCtx, setUnsuccessfulModalCtx] = useState<UnsuccessfulModalCtx | null>(null);

  const fetchWorklist = useCallback(async () => {
    if (!patientId) {
      setItems([]);
      setChainMap({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/worklists/wip-next-appointments?patientId=${encodeURIComponent(patientId)}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Hiba történt');
        setItems([]);
        setChainMap({});
        return;
      }
      setItems(data.items ?? []);
      setChainMap(data.chainBookingRequiredByEpisodeId ?? {});
    } catch {
      setError('Hálózati hiba');
      setItems([]);
      setChainMap({});
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchWorklist();
  }, [fetchWorklist]);

  const episodeItems = useMemo(
    () => items.filter((i) => i.episodeId === episodeId),
    [items, episodeId]
  );

  const itemByWorkPhaseId = useMemo(() => {
    const m = new Map<string, WorklistItemBackend>();
    for (const item of episodeItems) {
      if (item.workPhaseId) m.set(String(item.workPhaseId), item);
    }
    return m;
  }, [episodeItems]);

  const rowStateFor = useCallback(
    (item: WorklistItemBackend): WorklistRowState =>
      deriveWorklistRowState(item, local, getWorklistItemKey(item)).state,
    [local]
  );

  const blockedItem = useMemo(
    () => episodeItems.find((i) => i.status === 'blocked') ?? null,
    [episodeItems]
  );

  const chainBookingRequired = !!chainMap[episodeId] && episodeItems.length > 0;

  const hasReady = useMemo(
    () => episodeItems.some((i) => rowStateFor(i) === 'READY'),
    [episodeItems, rowStateFor]
  );

  const hasItems = episodeItems.length > 0;

  const planStartDate = useMemo(() => {
    for (const item of episodeItems) {
      if (item.planStartDate !== undefined) return item.planStartDate ?? null;
    }
    return null;
  }, [episodeItems]);

  const planStartDateKnown = useMemo(
    () => episodeItems.some((i) => i.planStartDate !== undefined),
    [episodeItems]
  );

  const openSlotPicker = useCallback((item: WorklistItemBackend) => {
    setSlotPickerItem(item);
  }, []);

  const closeSlotPicker = useCallback(() => {
    setSlotPickerItem(null);
    setSlotPickerRetryContext(null);
  }, []);

  const handleSelectSlot = useCallback(
    async (slotId: string) => {
      if (!slotPickerItem) return;
      const key = getWorklistItemKey(slotPickerItem);
      setLocal((prev) => ({
        ...prev,
        bookingInProgressKeys: new Set([...Array.from(prev.bookingInProgressKeys ?? []), key]),
      }));

      try {
        const res = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            patientId: slotPickerItem.patientId,
            episodeId: slotPickerItem.episodeId ?? null,
            timeSlotId: slotId,
            pool: slotPickerItem.pool || 'work',
            requiresPrecommit: slotPickerItem.requiresPrecommit ?? false,
            stepCode: slotPickerItem.stepCode ?? slotPickerItem.nextStep,
            stepSeq: slotPickerItem.stepSeq,
            workPhaseId: slotPickerItem.workPhaseId ?? undefined,
            createdVia: 'worklist',
          }),
        });
        const data = await res.json();

        if (res.ok) {
          setSlotPickerItem(null);
          setSlotPickerRetryContext(null);
          // A lockot csak a friss worklist megérkezése UTÁN oldjuk fel — a
          // refetch alatt a sor „Foglalás…" maradjon, ne aktív Foglalás gomb
          // (dupla foglalás ablaka).
          await fetchWorklist();
          setLocal((prev) => {
            const next = { ...prev };
            next.bookingInProgressKeys = new Set(prev.bookingInProgressKeys ?? []);
            next.bookingInProgressKeys.delete(key);
            return next;
          });
          onChanged?.();
          notifyAppointmentsChanged();
          return;
        }

        if (res.status === 409 && data.code === 'ONE_HARD_NEXT_VIOLATION') {
          setLocal((prev) => ({
            ...prev,
            bookingInProgressKeys: new Set(
              Array.from(prev.bookingInProgressKeys ?? []).filter((k) => k !== key)
            ),
          }));
          setSlotPickerItem(null);
          const rowsForEpisode = items.filter((i) => i.episodeId === slotPickerItem.episodeId);
          if (rowsForEpisode.length > 1) {
            setConvertAllMessage({
              type: 'error',
              text: 'Ehhez az epizódhoz több munkafázis tartozik. Az „Összes szükséges időpont lefoglalása” gombbal egyszerre foglalhatod őket.',
            });
            return;
          }
          setLocal((prev) => ({
            ...prev,
            overrideRequiredKeys: new Set([...Array.from(prev.overrideRequiredKeys ?? []), key]),
          }));
          setOverride429({
            error: data.error ?? 'Epizódnak már van jövőbeli munkafoglalása',
            overrideHint: data.overrideHint,
            expectedHardNext: data.expectedHardNext,
            existingAppointment: data.existingAppointment,
            rowKey: key,
            retryData: {
              patientId: slotPickerItem.patientId,
              episodeId: slotPickerItem.episodeId,
              slotId,
              pool: slotPickerItem.pool || 'work',
              durationMinutes: slotPickerItem.durationMinutes || 30,
              nextStep: slotPickerItem.nextStep,
              stepCode: slotPickerItem.stepCode,
              workPhaseId: slotPickerItem.workPhaseId,
              requiresPrecommit: slotPickerItem.requiresPrecommit,
            },
          });
          return;
        }

        if (res.status === 409 && (data.code === 'SLOT_ALREADY_BOOKED' || data.error?.includes('foglalt'))) {
          setSlotPickerItem(null);
          alert('A slot már foglalt. Válassz másikat.');
          fetchWorklist();
          return;
        }

        throw new Error(formatApiErrorParts(data, res, 'Hiba történt'));
      } catch (e) {
        setLocal((prev) => {
          const next = { ...prev };
          next.bookingInProgressKeys = new Set(prev.bookingInProgressKeys ?? []);
          next.bookingInProgressKeys.delete(key);
          return next;
        });
        setSlotPickerItem(null);
        throw e;
      }
    },
    [slotPickerItem, items, fetchWorklist, onChanged]
  );

  /** A modal bezárása (Mégse is): az OVERRIDE_REQUIRED lock takarítása, hogy a sor visszakapja a Foglalás gombot. */
  const clearOverrideKey = useCallback((rowKey: string | undefined) => {
    if (!rowKey) return;
    setLocal((prev) => ({
      ...prev,
      overrideRequiredKeys: new Set(
        Array.from(prev.overrideRequiredKeys ?? []).filter((k) => k !== rowKey)
      ),
    }));
  }, []);

  const closeOverride = useCallback(() => {
    clearOverrideKey(override429?.rowKey);
    setOverride429(null);
  }, [clearOverrideKey, override429]);

  const handleOverrideConfirm = useCallback(
    async (overrideReason: string) => {
      if (!override429) return;
      const { retryData, rowKey } = override429;
      try {
        const res = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            patientId: retryData.patientId,
            episodeId: retryData.episodeId ?? null,
            timeSlotId: retryData.slotId,
            pool: retryData.pool,
            overrideReason,
            requiresPrecommit: retryData.requiresPrecommit ?? false,
            stepCode: retryData.stepCode ?? retryData.nextStep,
            workPhaseId: retryData.workPhaseId ?? undefined,
            createdVia: 'worklist',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Hiba');
        setOverride429(null);
        // A lockot a friss worklist után oldjuk — addig a sor ne kínáljon újra foglalást.
        await fetchWorklist();
        clearOverrideKey(rowKey);
        onChanged?.();
        notifyAppointmentsChanged();
      } catch (e) {
        setOverride429(null);
        clearOverrideKey(rowKey);
        throw e;
      }
    },
    [override429, fetchWorklist, onChanged, clearOverrideKey]
  );

  const convertAll = useCallback(async () => {
    setConvertAllBusy(true);
    setConvertAllMessage(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/convert-all-intents`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setConvertAllMessage({ type: 'error', text: data.error ?? 'Hiba történt' });
        // Audit #09 (WP-0.8): hibás válasznál is frissítünk — a köteg egy
        // része addigra már COMMIT-olhatott, és e nélkül a felület elrejtené
        // a ténylegesen létrejött foglalásokat.
        await fetchWorklist();
        onChanged?.();
        notifyAppointmentsChanged();
        return;
      }
      const { converted, skipped } = data as {
        converted: number;
        skipped: Array<{ intentId: string; reason: string; code?: string; stepCode?: string }>;
      };
      if (skipped?.length > 0) {
        // Ha MINDEN kihagyás "nincs szabad slot", az naptár-kapacitási probléma —
        // egy akcionálható üzenet, nem lépésenkénti zaj.
        const allNoFreeSlot = skipped.every((s) => s.reason?.includes('Nincs szabad'));
        if (allNoFreeSlot) {
          const stepList = skipped.map((s) => s.stepCode).filter(Boolean).join(', ');
          setConvertAllMessage({
            type: converted > 0 ? 'success' : 'error',
            text:
              `${converted} időpont lefoglalva. Nem volt elég szabad időpont a sorozat lefoglalásához ` +
              `(${skipped.length} lépés kihagyva${stepList ? `: ${stepList}` : ''}). ` +
              `Hozz létre több szabad slotot a kijelölt orvos naptárában a hiányzó lépések ablakaiban, majd próbáld újra.`,
          });
          await fetchWorklist();
          onChanged?.();
          notifyAppointmentsChanged();
          return;
        }
        const reasonSummary = skipped
          .map((s) => {
            const step = s.stepCode ? `${s.stepCode}: ` : '';
            if (s.code === 'STEP_ALREADY_DONE') return `${step}már teljesítve`;
            if (s.code === 'STEP_ALREADY_BOOKED') return `${step}már foglalva`;
            if (s.code === 'SLOT_ALREADY_BOOKED') return `${step}az ajánlott slot időközben elkelt`;
            if (s.reason?.includes('Nincs szabad')) return `${step}nincs szabad slot`;
            return `${step}${s.reason?.slice(0, 40) ?? 'kihagyva'}`;
          })
          .join('; ');
        setConvertAllMessage({
          type: converted > 0 ? 'success' : 'error',
          text: `${converted} időpont lefoglalva, ${skipped.length} kihagyva: ${reasonSummary}`,
        });
      } else {
        setConvertAllMessage({
          type: 'success',
          text: converted === 1 ? '1 időpont lefoglalva.' : `${converted} időpont lefoglalva.`,
        });
      }
      await fetchWorklist();
      onChanged?.();
      notifyAppointmentsChanged();
    } catch {
      setConvertAllMessage({ type: 'error', text: 'Hálózati hiba' });
    } finally {
      setConvertAllBusy(false);
    }
  }, [episodeId, fetchWorklist, onChanged]);

  const dismissConvertAllMessage = useCallback(() => setConvertAllMessage(null), []);

  const openLinkAppointment = useCallback((item: WorklistItemBackend) => {
    setLinkAppointmentItem(item);
  }, []);

  const closeLinkAppointment = useCallback(() => setLinkAppointmentItem(null), []);

  const confirmLinkAppointment = useCallback(
    async (appointmentId: string, reason: string) => {
      if (!linkAppointmentItem) return;
      const res = await fetch(`/api/appointments/${appointmentId}/link-work-phase`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targetWorkPhaseId: linkAppointmentItem.workPhaseId,
          episodeId: linkAppointmentItem.episodeId,
          reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? 'Hozzárendelés sikertelen');
      }
      await fetchWorklist();
      onChanged?.();
      notifyAppointmentsChanged();
    },
    [linkAppointmentItem, fetchWorklist, onChanged]
  );

  const openMarkCompleteRetro = useCallback((item: WorklistItemBackend) => {
    if (!item.workPhaseId || !item.episodeId) return;
    const exclude: string[] = [];
    if (item.bookedAppointmentId) exclude.push(item.bookedAppointmentId);
    if (item.currentAppointmentId) exclude.push(item.currentAppointmentId);
    for (const att of item.priorAttempts ?? []) {
      if (att.appointmentId) exclude.push(att.appointmentId);
    }
    setMarkCompleteRetroCtx({ item, excludeAppointmentIds: exclude });
  }, []);

  const closeMarkCompleteRetro = useCallback(() => setMarkCompleteRetroCtx(null), []);

  const confirmMarkCompleteRetro = useCallback(
    async (payload: MarkCompletedRetroPayload) => {
      const ctx = markCompleteRetroCtx;
      if (!ctx?.item.workPhaseId || !ctx.item.episodeId) return;
      const res = await fetch(
        `/api/episodes/${ctx.item.episodeId}/work-phases/${ctx.item.workPhaseId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            status: 'completed',
            reason: payload.reason,
            completedAt: payload.completedAt,
            appointmentId: payload.appointmentId,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Hiba történt');
      }
      await fetchWorklist();
      onChanged?.();
      notifyAppointmentsChanged();
    },
    [markCompleteRetroCtx, fetchWorklist, onChanged]
  );

  const openMarkUnsuccessful = useCallback((item: WorklistItemBackend) => {
    const appointmentId = item.bookedAppointmentId ?? item.currentAppointmentId;
    if (!appointmentId) return;
    const attemptNumber = item.currentAttemptNumber ?? (item.priorAttempts?.length ?? 0) + 1;
    setUnsuccessfulModalCtx({
      item,
      appointmentId,
      appointmentStart: item.bookedAppointmentStartTime ?? item.windowStart ?? null,
      attemptNumber,
    });
  }, []);

  const closeMarkUnsuccessful = useCallback(() => setUnsuccessfulModalCtx(null), []);

  const confirmMarkUnsuccessful = useCallback(
    async (payload: UnsuccessfulAttemptConfirmPayload) => {
      const ctx = unsuccessfulModalCtx;
      if (!ctx) return;
      const res = await fetch(`/api/appointments/${ctx.appointmentId}/attempt-outcome`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'mark_unsuccessful', reason: payload.reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(formatApiErrorParts(data, res, 'Sikertelen-jelölés nem sikerült.'));
      }
      await fetchWorklist();
      onChanged?.();
      notifyAppointmentsChanged();
      if (payload.shouldOpenSlotPicker) {
        // Az item régi snapshot — a window tanácsadó jellegű, a SlotPicker a
        // tényleges szabad slotok alapján mutatja az opciókat.
        setSlotPickerRetryContext({
          nextAttemptNumber: ctx.attemptNumber + 1,
          previousAttemptNumber: ctx.attemptNumber,
          previousFailedReason: payload.reason,
          previousAtISO: ctx.appointmentStart,
          stepLabel: ctx.item.stepLabel ?? ctx.item.nextStep ?? null,
        });
        setSlotPickerItem(ctx.item);
      }
    },
    [unsuccessfulModalCtx, fetchWorklist, onChanged]
  );

  return {
    enabled,
    loading,
    error,
    refresh: fetchWorklist,
    itemByWorkPhaseId,
    rowStateFor,
    blockedItem,
    chainBookingRequired,
    hasReady,
    hasItems,
    planStartDate,
    planStartDateKnown,
    openSlotPicker,
    closeSlotPicker,
    slotPickerItem,
    slotPickerRetryContext,
    handleSelectSlot,
    override429,
    closeOverride,
    handleOverrideConfirm,
    convertAll,
    convertAllBusy,
    convertAllMessage,
    dismissConvertAllMessage,
    linkAppointmentItem,
    openLinkAppointment,
    closeLinkAppointment,
    confirmLinkAppointment,
    markCompleteRetroCtx,
    openMarkCompleteRetro,
    closeMarkCompleteRetro,
    confirmMarkCompleteRetro,
    unsuccessfulModalCtx,
    openMarkUnsuccessful,
    closeMarkUnsuccessful,
    confirmMarkUnsuccessful,
  };
}
