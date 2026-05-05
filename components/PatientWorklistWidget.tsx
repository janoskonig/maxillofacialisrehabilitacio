'use client';

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { ClipboardList, CalendarCheck, Trash2, Undo2, CalendarClock, AlertTriangle, Shuffle } from 'lucide-react';
import {
  getWorklistItemKey,
  deriveWorklistRowState,
  type AppointmentAttemptSummary,
  type WorklistItemBackend,
  type WorklistLocalState,
} from '@/lib/worklist-types';
import { formatShortDateRange } from '@/lib/datetime';
import { SlotPickerModal } from './SlotPickerModal';
import { OverrideModal } from './OverrideModal';
import { WorklistMergedPhaseCell } from './WorklistMergedPhaseCell';
import {
  UnsuccessfulAttemptModal,
  type UnsuccessfulAttemptConfirmPayload,
} from './UnsuccessfulAttemptModal';
import { RevertUnsuccessfulModal } from './RevertUnsuccessfulModal';
import {
  MarkCompletedRetroModal,
  type MarkCompletedRetroPayload,
} from './MarkCompletedRetroModal';
import {
  ReassignStepModal,
  type ReassignStepCandidate,
  type ReassignStepPayload,
} from './ReassignStepModal';
import { EpisodeIntegrityBanner } from './EpisodeIntegrityBanner';

export interface PatientWorklistWidgetProps {
  patientId: string;
  patientName?: string | null;
  /** Ha false, nem jelenik meg a widget (pl. nincs jogosultság) */
  visible?: boolean;
}

/**
 * Beteg profilra szűrt munkalista – a beteg aktív kezeléseinek következő munkafázisai.
 * Csak admin, beutaló orvos, fogpótlástanász látja.
 */
export function PatientWorklistWidget({ patientId, patientName, visible = true }: PatientWorklistWidgetProps) {
  const [items, setItems] = useState<WorklistItemBackend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [local, setLocal] = useState<WorklistLocalState>({});
  const [slotPickerItem, setSlotPickerItem] = useState<WorklistItemBackend | null>(null);
  const [pathwayAssigningEpisodeId, setPathwayAssigningEpisodeId] = useState<string | null>(null);
  const [override429, setOverride429] = useState<{
    error: string;
    overrideHint?: string;
    expectedHardNext?: { stepCode: string; earliestStart: string; latestStart: string; durationMinutes: number };
    existingAppointment?: { id: string; startTime: string; providerName?: string };
    retryData: { patientId: string; episodeId?: string; slotId: string; pool: string; durationMinutes: number; nextStep: string; stepCode?: string; workPhaseId?: string | null; requiresPrecommit?: boolean };
  } | null>(null);
  const [convertAllEpisodeId, setConvertAllEpisodeId] = useState<string | null>(null);
  const [convertAllMessage, setConvertAllMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [chainBookingRequiredByEpisodeId, setChainBookingRequiredByEpisodeId] = useState<Record<string, boolean>>({});
  const [markCompleteKey, setMarkCompleteKey] = useState<string | null>(null);
  const [reopenKey, setReopenKey] = useState<string | null>(null);
  const [deleteAppointmentId, setDeleteAppointmentId] = useState<string | null>(null);
  /** Migration 029: sikertelen-jelölés modal állapotai. */
  const [unsuccessfulModalCtx, setUnsuccessfulModalCtx] = useState<{
    item: WorklistItemBackend;
    appointmentId: string;
    appointmentStart: string | null;
    attemptNumber: number;
  } | null>(null);
  const [revertModalCtx, setRevertModalCtx] = useState<{
    item: WorklistItemBackend;
    attempt: AppointmentAttemptSummary;
  } | null>(null);
  /**
   * Az „Elkészült (utólag)" gomb most modalt nyit, ahol a felhasználó megadhatja
   * mikor készült el ténylegesen a fázis (régebbi foglalt időpontból vagy egyéni
   * dátummal). A context tartja az item-et és az appointment-listából kihagyandó
   * id-ket (pl. már a fázishoz kötött jövőbeli foglalás vagy prior attempt-ek).
   */
  const [markCompleteRetroCtx, setMarkCompleteRetroCtx] = useState<{
    item: WorklistItemBackend;
    excludeAppointmentIds: string[];
  } | null>(null);
  /**
   * „Áthelyezés másik fázisra" modal kontextusa. A sourceItem a BOOKED sor,
   * amit át akarunk rendelni; a candidates lista ugyanennek az epizódnak a
   * többi pending/scheduled munkafázisa (azonos pool, nincs BOOKED foglalása).
   * A tényleges PATCH /api/appointments/:id/reassign-step hívást a modal
   * `onConfirm` callback-je küldi el, `handleConfirmReassignStep`-en keresztül.
   */
  const [reassignStepCtx, setReassignStepCtx] = useState<{
    item: WorklistItemBackend;
    candidates: ReassignStepCandidate[];
  } | null>(null);
  const [reassignStepSubmittingId, setReassignStepSubmittingId] = useState<string | null>(null);
  /**
   * Ha a SlotPickert sikertelen-jelölés UTÁN nyitjuk meg, ezzel adjuk át az
   * előző próba kontextusát a modal fejlécének és bannerének. Reset-elődik
   * minden alkalommal, amikor a SlotPicker bezárul.
   */
  const [slotPickerRetryContext, setSlotPickerRetryContext] = useState<{
    nextAttemptNumber: number;
    previousAttemptNumber: number;
    previousFailedReason: string | null;
    previousAtISO: string | null;
    stepLabel: string | null;
  } | null>(null);

  const fetchWorklist = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/worklists/wip-next-appointments?patientId=${encodeURIComponent(patientId)}`, {
        credentials: 'include',
      });
      setStatus(res.status);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Hiba történt');
        setItems([]);
        setChainBookingRequiredByEpisodeId({});
        return;
      }
      setItems(data.items ?? []);
      setChainBookingRequiredByEpisodeId(data.chainBookingRequiredByEpisodeId ?? {});
    } catch (e) {
      setError('Hálózati hiba');
      setItems([]);
      setChainBookingRequiredByEpisodeId({});
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchWorklist();
  }, [fetchWorklist]);

  const sortedItems = [...items].sort((a, b) => {
    const epA = a.episodeOrder ?? 0;
    const epB = b.episodeOrder ?? 0;
    if (epA !== epB) return epA - epB;
    const seqA = a.stepSeq ?? 0;
    const seqB = b.stepSeq ?? 0;
    return seqA - seqB;
  });

  const episodeIdsWithReady = new Set(
    sortedItems
      .filter((item) => deriveWorklistRowState(item, local, getWorklistItemKey(item)).state === 'READY')
      .map((item) => item.episodeId)
  );

  // Stabil episodeIds — különben a banner minden render-en újra fetch-eli az
  // integrity-checket, ami N párhuzamos query-t indít a DB_POOL-on. Itt
  // számoljuk a hookot, hogy a korai return-ek (loading / 403 / üres lista)
  // után se sérüljön a hook-rendezési invariáns.
  const integrityEpisodeIds = useMemo(
    () => Array.from(new Set(items.map((i) => i.episodeId).filter(Boolean))),
    [items]
  );

  const handleBookNext = (item: WorklistItemBackend) => {
    setSlotPickerItem(item);
  };

  const handleAssignDefaultPathway = async (item: WorklistItemBackend) => {
    const episodeId = item.episodeId;
    if (!episodeId) return;
    setPathwayAssigningEpisodeId(episodeId);
    try {
      const pathwaysRes = await fetch('/api/care-pathways', { credentials: 'include' });
      const pathwaysData = await pathwaysRes.json();
      const pathways = pathwaysData.pathways ?? [];
      const defaultId = pathways[0]?.id;
      if (!defaultId) {
        throw new Error('Nincs kezelési út az adatbázisban');
      }
      const patchRes = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ carePathwayId: defaultId }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json();
        throw new Error(data.error ?? 'Hiba történt');
      }
      await fetchWorklist();
    } finally {
      setPathwayAssigningEpisodeId(null);
    }
  };

  const handleSelectSlot = async (slotId: string) => {
    if (!slotPickerItem) return;
    const { patientId: pid, episodeId, pool, durationMinutes, nextStep } = slotPickerItem;
    const windowStart = slotPickerItem.windowStart ? new Date(slotPickerItem.windowStart) : new Date();
    const windowEnd = slotPickerItem.windowEnd ? new Date(slotPickerItem.windowEnd) : new Date();

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
          patientId: pid,
          episodeId: episodeId ?? null,
          timeSlotId: slotId,
          pool: pool || 'work',
          requiresPrecommit: slotPickerItem.requiresPrecommit ?? false,
          stepCode: slotPickerItem.stepCode ?? nextStep,
          stepSeq: slotPickerItem.stepSeq,
          workPhaseId: slotPickerItem.workPhaseId ?? undefined,
          createdVia: 'worklist',
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setSlotPickerItem(null);
        setSlotPickerRetryContext(null);
        setItems((prev) => prev.filter((i) => getWorklistItemKey(i) !== key));
        setLocal((prev) => {
          const next = { ...prev };
          next.bookingInProgressKeys = new Set(prev.bookingInProgressKeys ?? []);
          next.bookingInProgressKeys.delete(key);
          return next;
        });
        fetchWorklist();
        return;
      }

      if (res.status === 409 && data.code === 'ONE_HARD_NEXT_VIOLATION') {
        setLocal((prev) => ({
          ...prev,
          bookingInProgressKeys: new Set(Array.from(prev.bookingInProgressKeys ?? []).filter((k) => k !== key)),
        }));
        setSlotPickerItem(null);
        const episodeIdForViolation = slotPickerItem.episodeId;
        const rowsForEpisode = items.filter((i) => i.episodeId === episodeIdForViolation);
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

      throw new Error(data.error ?? 'Hiba történt');
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
  };

  const handleConvertAllIntents = async (episodeId: string) => {
    setConvertAllEpisodeId(episodeId);
    setConvertAllMessage(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/convert-all-intents`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setConvertAllMessage({ type: 'error', text: data.error ?? 'Hiba történt' });
        return;
      }
      const { converted, skipped } = data as {
        converted: number;
        skipped: Array<{ intentId: string; reason: string; code?: string; stepCode?: string }>;
      };
      if (skipped?.length > 0) {
        // Slot-gap detection: if EVERY skip is a "no free slot" outcome (window
        // exhausted + no nearest match), treat it as a calendar-availability
        // problem rather than per-step noise. The chain-anchor in convert-all-intents
        // pushes lowerBound forward when an earlier step lands far past its
        // suggested date — combined with a sparse calendar this leaves
        // subsequent steps with nothing to choose from. Surface that as a
        // single, actionable message so the operator knows to add slots.
        const allNoFreeSlot = skipped.every((s) => s.reason?.includes('Nincs szabad'));
        if (allNoFreeSlot) {
          const stepList = skipped
            .map((s) => s.stepCode)
            .filter(Boolean)
            .join(', ');
          setConvertAllMessage({
            type: converted > 0 ? 'success' : 'error',
            text:
              `${converted} időpont lefoglalva. Nem volt elég szabad időpont a sorozat lefoglalásához ` +
              `(${skipped.length} lépés kihagyva${stepList ? `: ${stepList}` : ''}). ` +
              `Hozz létre több szabad slotot a kijelölt orvos naptárában a hiányzó lépések ablakaiban, majd próbáld újra.`,
          });
          fetchWorklist();
          return;
        }
        const reasonSummary = skipped.map((s) => {
          const step = s.stepCode ? `${s.stepCode}: ` : '';
          if (s.code === 'STEP_ALREADY_DONE') return `${step}már teljesítve`;
          if (s.code === 'STEP_ALREADY_BOOKED') return `${step}már foglalva`;
          if (s.code === 'SLOT_ALREADY_BOOKED') return `${step}az ajánlott slot időközben elkelt`;
          if (s.reason?.includes('Nincs szabad')) return `${step}nincs szabad slot`;
          return `${step}${s.reason?.slice(0, 40) ?? 'kihagyva'}`;
        }).join('; ');
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
      fetchWorklist();
    } catch (e) {
      setConvertAllMessage({ type: 'error', text: 'Hálózati hiba' });
    } finally {
      setConvertAllEpisodeId(null);
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    if (!confirm('Biztosan törölni szeretnéd ezt az időpontot? A slot újra foglalhatóvá válik.')) return;
    setDeleteAppointmentId(appointmentId);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, { method: 'DELETE', credentials: 'include' });
      const data = res.ok ? null : await res.json();
      if (!res.ok) {
        alert(data?.error ?? 'Törlés sikertelen');
        return;
      }
      await fetchWorklist();
    } catch (e) {
      alert('Hálózati hiba');
    } finally {
      setDeleteAppointmentId(null);
    }
  };

  /**
   * Modal megnyitása: egy meglévő (BOOKED) foglalás áthelyezése ugyanazon
   * epizód MÁSIK pending munkafázisára. Csak azokat a fázisokat kínáljuk
   * fel, amelyek:
   *   - ugyanehhez az epizódhoz tartoznak,
   *   - ugyanabban a pool-ban vannak (control/work/consult nem keveredhet),
   *   - még nincs BOOKED foglalásuk,
   *   - nem completed / skipped,
   *   - van `workPhaseId`-juk (backing episode_work_phases sor).
   *
   * A fejléc és a warning szöveg a ReassignStepModal-ban van. A tényleges
   * PATCH hívás `handleConfirmReassignStep`-ben történik.
   */
  const handleOpenReassignStep = (item: WorklistItemBackend) => {
    if (!item.bookedAppointmentId || !item.workPhaseId) return;
    const candidates: ReassignStepCandidate[] = items
      .filter(
        (i) =>
          i.episodeId === item.episodeId &&
          i.pool === item.pool &&
          i.workPhaseId &&
          i.workPhaseId !== item.workPhaseId &&
          i.stepStatus !== 'completed' &&
          i.stepStatus !== 'skipped' &&
          !i.bookedAppointmentId
      )
      .map((i) => ({
        workPhaseId: i.workPhaseId as string,
        stepCode: i.stepCode ?? i.nextStep,
        stepLabel: i.stepLabel ?? i.nextStep,
        pool: i.pool,
        windowStart: i.windowStart,
        windowEnd: i.windowEnd,
        stepSeq: i.stepSeq ?? null,
        bookableWindowStart: i.bookableWindowStart ?? null,
        bookableWindowEnd: i.bookableWindowEnd ?? null,
        status: i.stepStatus ?? null,
      }));
    setReassignStepCtx({ item, candidates });
  };

  const handleConfirmReassignStep = async (
    appointmentId: string,
    payload: ReassignStepPayload
  ) => {
    setReassignStepSubmittingId(appointmentId);
    try {
      const res = await fetch(
        `/api/appointments/${appointmentId}/reassign-step`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            targetWorkPhaseId: payload.targetWorkPhaseId,
            reason: payload.reason,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? 'Átrendezés sikertelen');
      }
      if (data?.cleanedStaleLink) {
        console.info(
          '[reassign-step] cél fázison stale appointment_id volt (appointment %s, status %s) — takarítva az átrendezéssel',
          data.staleLinkedAppointmentId ?? 'n/a',
          data.staleLinkedAppointmentStatus ?? 'n/a'
        );
      }
      await fetchWorklist();
    } finally {
      setReassignStepSubmittingId(null);
    }
  };

  /**
   * „Elkészült (utólag)" gomb — nem PATCH-ol azonnal, hanem modalt nyit, ahol
   * a felhasználó kiválaszthatja, hogy a fázis mikor készült el ténylegesen
   * (régebbi foglalt időpontból vagy egyéni dátummal). A tényleges PATCH-et
   * a modal `onConfirm` callback-jén keresztül `handleConfirmMarkCompleteRetro`
   * indítja.
   */
  const handleMarkStepComplete = (item: WorklistItemBackend) => {
    if (!item.workPhaseId || !item.episodeId) return;
    const exclude: string[] = [];
    if (item.bookedAppointmentId) exclude.push(item.bookedAppointmentId);
    if (item.currentAppointmentId) exclude.push(item.currentAppointmentId);
    for (const att of item.priorAttempts ?? []) {
      if (att.appointmentId) exclude.push(att.appointmentId);
    }
    setMarkCompleteRetroCtx({ item, excludeAppointmentIds: exclude });
  };

  const handleConfirmMarkCompleteRetro = async (
    item: WorklistItemBackend,
    payload: MarkCompletedRetroPayload
  ) => {
    const workPhaseId = item.workPhaseId;
    const episodeId = item.episodeId;
    if (!workPhaseId || !episodeId) return;
    const key = getWorklistItemKey(item);
    setMarkCompleteKey(key);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/${workPhaseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          status: 'completed',
          reason: payload.reason,
          completedAt: payload.completedAt,
          appointmentId: payload.appointmentId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Hiba történt');
      }
      await fetchWorklist();
    } finally {
      setMarkCompleteKey(null);
    }
  };

  const handleReopenStep = async (item: WorklistItemBackend) => {
    const workPhaseId = item.workPhaseId;
    const episodeId = item.episodeId;
    if (!workPhaseId || !episodeId) return;
    const rawReason = window.prompt(
      'Miért vonod vissza a „kész” jelölést? (legalább 5 karakter)',
      'Tévedésből jelölve késznek'
    );
    if (rawReason === null) return;
    const reason = rawReason.trim();
    if (reason.length < 5) {
      alert('Az indoklás legalább 5 karakter kell legyen.');
      return;
    }
    const key = getWorklistItemKey(item);
    setReopenKey(key);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/work-phases/${workPhaseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'pending', reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? 'Hiba történt');
        return;
      }
      await fetchWorklist();
    } catch (e) {
      alert('Hálózati hiba');
    } finally {
      setReopenKey(null);
    }
  };

  const handleOverrideConfirm = async (overrideReason: string) => {
    if (!override429) return;
    const { retryData } = override429;
    const matchKey = (i: WorklistItemBackend) => i.episodeId === retryData.episodeId && i.nextStep === retryData.nextStep;
    const removedItem = items.find(matchKey);
    const removedKey = removedItem ? getWorklistItemKey(removedItem) : null;
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
      setItems((prev) => prev.filter((i) => !matchKey(i)));
      setLocal((prev) => ({
        ...prev,
        overrideRequiredKeys: removedKey
          ? new Set(Array.from(prev.overrideRequiredKeys ?? []).filter((k) => k !== removedKey))
          : prev.overrideRequiredKeys,
      }));
      fetchWorklist();
    } catch (e) {
      setOverride429(null);
      throw e;
    }
  };

  /**
   * Migration 029: sikertelen-jelölés. A modal `onConfirmed`-jén keresztül
   * jön ide. A backend (PATCH /api/appointments/:id/attempt-outcome) maga
   * gondoskodik:
   *   • appointment status -> 'unsuccessful'
   *   • episode_work_phases visszamegy 'pending'-be
   *   • slot_intents reproject (downstream fázisok auto-shift)
   * Ha a felhasználó bejelölte a "Következő próba foglalása most" checkboxot,
   * itt rögtön nyitjuk a SlotPickert a most pending fázishoz.
   */
  const handleMarkUnsuccessfulConfirmed = async (
    appointmentId: string,
    item: WorklistItemBackend,
    payload: UnsuccessfulAttemptConfirmPayload,
    contextForRetry: {
      previousAttemptNumber: number;
      previousFailedAtISO: string | null;
    }
  ) => {
    const res = await fetch(`/api/appointments/${appointmentId}/attempt-outcome`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'mark_unsuccessful', reason: payload.reason }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error ?? 'Sikertelen-jelölés nem sikerült.');
    }

    // Frissítjük a worklist-et — most a step pending lesz, és a most-sikertelen
    // appointment a priorAttempts közé kerül.
    await fetchWorklist();

    if (payload.shouldOpenSlotPicker) {
      // Az `item` régi snapshot — a friss adatok még nem frissültek a state-ben.
      // A SlotPicker windowStart/End-jét az item-ből vesszük (a backend a
      // projector-rel már új window-ot adott, de UI-szinten az item.windowStart
      // még a régi). Ez tanácsadó — a SlotPicker a tényleges szabad slot-ok
      // alapján mutatja az opciókat, így a kis eltérés nem zavar.
      setSlotPickerRetryContext({
        nextAttemptNumber: contextForRetry.previousAttemptNumber + 1,
        previousAttemptNumber: contextForRetry.previousAttemptNumber,
        previousFailedReason: payload.reason,
        previousAtISO: contextForRetry.previousFailedAtISO,
        stepLabel: item.stepLabel ?? item.nextStep ?? null,
      });
      setSlotPickerItem(item);
    }
  };

  /** Migration 029: sikertelen-jelölés visszavonása. */
  const handleRevertUnsuccessfulConfirmed = async (
    appointmentId: string,
    reason: string
  ) => {
    const res = await fetch(`/api/appointments/${appointmentId}/attempt-outcome`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'revert', reason }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error ?? 'Visszavonás nem sikerült.');
    }
    await fetchWorklist();
  };

  if (!visible) return null;

  if (loading && items.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-medical-primary/20 border-t-medical-primary" />
          <span className="ml-2 text-sm text-gray-600">Következő munkafázis betöltése…</span>
        </div>
      </div>
    );
  }

  if (status === 403) {
    return (
      <div className="card border-amber-200 bg-amber-50">
        <p className="text-amber-800 text-center py-3 text-sm">Nincs hozzáférés a munkalistához.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50">
        <p className="text-red-800 text-center py-3 text-sm">
          Hiba történt – <button onClick={fetchWorklist} className="underline font-medium">Újra</button>
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-8">
          <ClipboardList className="w-10 h-10 text-gray-400 mx-auto mb-2" />
          <h3 className="text-base font-medium text-gray-900 mb-1">Nincs foglalni való következő munkafázis</h3>
          <p className="text-sm text-gray-500">
            {patientName
              ? `${patientName} jelenleg nincs aktív kezelésben, vagy minden kezeléshez már van jövőbeli időpont.`
              : 'A beteg jelenleg nincs aktív kezelésben, vagy minden kezeléshez már van jövőbeli időpont.'}
          </p>
        </div>
      </div>
    );
  }

  const showChainMandatoryBanner = Object.keys(chainBookingRequiredByEpisodeId).some(
    (eid) =>
      chainBookingRequiredByEpisodeId[eid] && sortedItems.some((i) => i.episodeId === eid)
  );

  return (
    <div className="space-y-3">
      {showChainMandatoryBanner && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">Teljes sorozat lefoglalása kötelező lépés</p>
          <p className="mt-1 text-amber-900/90">
            Ha az epizódhoz több munkafázis tartozik, az első sorban az „Összes szükséges időpont lefoglalása”
            gombbal foglald le egyszerre a szükséges időpontokat — ne csak az első lépést egyenként.
          </p>
        </div>
      )}
      {convertAllMessage && (
        <p
          className={`text-sm px-3 py-2 rounded ${
            convertAllMessage.type === 'success'
              ? 'bg-green-50 text-green-800'
              : 'bg-red-50 text-red-800'
          }`}
        >
          {convertAllMessage.text}
          <button
            type="button"
            onClick={() => setConvertAllMessage(null)}
            className="ml-2 underline"
          >
            Elrejt
          </button>
        </p>
      )}
      <EpisodeIntegrityBanner
        episodeIds={integrityEpisodeIds}
        onRepaired={fetchWorklist}
      />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Epizód / Stage</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Következő munkafázis</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Késés a tervhez képest</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Ablak (terv szerint)</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Státusz</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-24">Művelet</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item, index) => {
              const key = getWorklistItemKey(item);
              const { state } = deriveWorklistRowState(item, local, key);
              const isFirstRowOfEpisode =
                index === 0 || sortedItems[index - 1].episodeId !== item.episodeId;
              const showConvertAll =
                isFirstRowOfEpisode && episodeIdsWithReady.has(item.episodeId);
              const isConvertingAll = convertAllEpisodeId === item.episodeId;
              const ablakStart = item.bookableWindowStart ?? item.windowStart;
              const ablakEnd = item.bookableWindowEnd ?? item.windowEnd;
              const priorAttempts = item.priorAttempts ?? [];
              const currentAttempt = item.currentAttemptNumber ?? (priorAttempts.length + 1);
              const stepLabelForModal = item.stepLabel ?? item.nextStep ?? 'Munkafázis';

              return (
                <Fragment key={key}>
                  {priorAttempts.map((att) => {
                    const isUnsuccessful = att.status === 'unsuccessful';
                    const isNoShow = att.status === 'no_show';
                    const isCompleted = att.status === 'completed';
                    return (
                      <tr
                        key={`${key}::attempt-${att.appointmentId}`}
                        className={`border-b text-gray-700 ${
                          isUnsuccessful
                            ? 'bg-orange-50/40'
                            : isNoShow
                              ? 'bg-gray-50/60'
                              : 'bg-gray-50/30'
                        }`}
                      >
                        <td className="px-3 py-2 text-xs text-gray-500">
                          <span className="opacity-60">↳ előzmény</span>
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-700">{stepLabelForModal}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                              {att.attemptNumber}. próba
                            </span>
                          </div>
                          {isUnsuccessful && att.failedReason && (
                            <div
                              className="text-xs text-orange-800 mt-0.5 italic line-clamp-2"
                              title={att.failedReason}
                            >
                              „{att.failedReason}"
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-400">–</td>
                        <td className="px-3 py-2 text-sm text-gray-600">
                          {att.startTime
                            ? new Date(att.startTime).toLocaleString('hu-HU', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '–'}
                          {att.providerEmail && (
                            <span className="block text-xs text-gray-500 truncate">
                              {att.providerEmail}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded w-fit inline-flex items-center gap-1 ${
                              isUnsuccessful
                                ? 'bg-orange-100 text-orange-800'
                                : isNoShow
                                  ? 'bg-gray-200 text-gray-700'
                                  : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {isUnsuccessful && (
                              <>
                                <AlertTriangle className="w-3 h-3" />
                                SIKERTELEN
                              </>
                            )}
                            {isNoShow && 'NEM JELENT MEG'}
                            {isCompleted && '✓ KÉSZ (régebbi)'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {isUnsuccessful ? (
                            <button
                              type="button"
                              onClick={() => setRevertModalCtx({ item, attempt: att })}
                              className="text-xs text-gray-600 hover:text-gray-900 hover:underline font-medium text-left flex items-center gap-0.5"
                              title="Sikertelen-jelölés visszavonása (tévedés esetén)"
                            >
                              <Undo2 className="w-3 h-3" />
                              Visszavonás
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr
                    className={`border-b ${item.overdueByDays > 0 && state !== 'COMPLETED' && state !== 'SKIPPED' ? 'bg-red-50/50' : ''} ${state === 'BLOCKED' ? 'opacity-70' : ''} ${state === 'COMPLETED' ? 'opacity-60' : ''} ${state === 'SKIPPED' ? 'opacity-40' : ''}`}
                  >
                  <td className="px-3 py-2 text-sm text-gray-600">
                    {item.currentStage}
                    <span className="ml-1 text-xs text-gray-400">#{item.episodeId.slice(0, 8)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <WorklistMergedPhaseCell item={item} />
                    {priorAttempts.length > 0 && (
                      <span
                        className="ml-1 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 align-middle"
                        title={`${priorAttempts.length} korábbi próba (sikertelen vagy meg nem jelent)`}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {currentAttempt}. próba
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {item.overdueByDays > 0 ? (
                      <span className="text-red-600 font-medium">+{item.overdueByDays} nap</span>
                    ) : (
                      <span className="text-gray-600">–</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600">
                    {ablakStart && ablakEnd ? formatShortDateRange(ablakStart, ablakEnd) : '–'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded w-fit ${
                          state === 'COMPLETED'
                            ? 'bg-gray-100 text-gray-600'
                            : state === 'SKIPPED'
                              ? 'bg-gray-100 text-gray-500 line-through'
                              : state === 'BOOKED'
                                ? 'bg-blue-100 text-blue-800'
                                : state === 'READY'
                                  ? 'bg-green-100 text-green-800'
                                  : state === 'BLOCKED'
                                    ? 'bg-gray-200 text-gray-700'
                                    : state === 'NEEDS_REVIEW'
                                      ? 'bg-amber-100 text-amber-800'
                                      : state === 'BOOKING_IN_PROGRESS'
                                        ? 'bg-blue-100 text-blue-800'
                                        : 'bg-orange-100 text-orange-800'
                        }`}
                      >
                        {state === 'COMPLETED' ? '✓ KÉSZ' : state === 'SKIPPED' ? 'KIHAGYVA' : state === 'BOOKED' ? 'LEFOGLALVA' : state}
                        {state === 'BLOCKED' && item.blockedReason && (
                          <span className="ml-1 truncate max-w-[100px] inline-block" title={item.blockedReason}>
                            {item.blockedReason.slice(0, 15)}…
                          </span>
                        )}
                      </span>
                      {state === 'COMPLETED' && item.windowStart && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <CalendarCheck className="w-3 h-3" />
                          {new Date(item.windowStart).toLocaleString('hu-HU', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                      {state === 'BOOKED' && item.bookedAppointmentStartTime && (
                        <span className="text-xs text-blue-700 flex items-center gap-1">
                          <CalendarCheck className="w-3 h-3" />
                          {new Date(item.bookedAppointmentStartTime).toLocaleString('hu-HU', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {item.bookedAppointmentProviderEmail && (
                            <span className="text-gray-500 ml-1">· {item.bookedAppointmentProviderEmail}</span>
                          )}
                        </span>
                      )}
                      {state === 'BLOCKED' && item.blockedCode === 'NO_CARE_PATHWAY' && item.suggestedTreatmentTypeLabel && (
                        <span className="text-xs text-gray-600">
                          Javasolt kezeléstípus: {item.suggestedTreatmentTypeLabel}
                          {item.suggestedTreatmentTypeCode && (
                            <span className="text-gray-500"> ({item.suggestedTreatmentTypeCode})</span>
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      {state === 'COMPLETED' && (
                        <>
                          {item.currentAppointmentId && (
                            <button
                              type="button"
                              onClick={() =>
                                setUnsuccessfulModalCtx({
                                  item,
                                  appointmentId: item.currentAppointmentId!,
                                  appointmentStart: item.windowStart ?? null,
                                  attemptNumber: currentAttempt,
                                })
                              }
                              className="text-xs text-orange-700 hover:underline font-medium text-left flex items-center gap-0.5"
                              title="Mégis sikertelen volt (pl. labor visszaszólt) — új próba szükséges"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              Mégis sikertelen
                            </button>
                          )}
                          {item.workPhaseId ? (
                            <button
                              type="button"
                              onClick={() => handleReopenStep(item)}
                              disabled={reopenKey === key}
                              className="text-xs text-gray-600 hover:text-gray-900 hover:underline font-medium disabled:opacity-50 text-left flex items-center gap-0.5"
                              title="Mégsem kész — visszaállítás várakozóra (indoklás szükséges)"
                            >
                              <Undo2 className="w-3 h-3" />
                              {reopenKey === key ? 'Visszaállítás…' : 'Mégsem kész'}
                            </button>
                          ) : (
                            !item.currentAppointmentId && <span className="text-xs text-gray-400">—</span>
                          )}
                        </>
                      )}
                      {state === 'SKIPPED' && (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                      {showConvertAll && (
                        <button
                          onClick={() => handleConvertAllIntents(item.episodeId)}
                          disabled={!!isConvertingAll}
                          className={`text-xs font-medium disabled:opacity-50 text-left ${
                            chainBookingRequiredByEpisodeId[item.episodeId]
                              ? 'text-amber-900 font-semibold ring-1 ring-amber-400 rounded px-1.5 py-0.5 bg-amber-50'
                              : 'text-medical-primary hover:underline'
                          }`}
                        >
                          {isConvertingAll ? 'Lefoglalás…' : 'Összes szükséges időpont lefoglalása'}
                        </button>
                      )}
                      {state === 'READY' && (
                        <>
                          <button
                            onClick={() => handleBookNext(item)}
                            className="text-sm text-medical-primary hover:underline font-medium"
                          >
                            Foglalás
                          </button>
                          {item.workPhaseId && (
                            <button
                              type="button"
                              onClick={() => handleMarkStepComplete(item)}
                              disabled={markCompleteKey === key}
                              className="text-xs text-gray-600 hover:underline font-medium disabled:opacity-50 text-left"
                              title="A munkafázis elkészült, nem itt foglalt időponttal"
                            >
                              {markCompleteKey === key ? 'Mentés…' : 'Elkészült (utólag)'}
                            </button>
                          )}
                        </>
                      )}
                      {state === 'BOOKED' && (
                        <>
                          <span className="text-xs text-blue-600 font-medium">✓ Foglalva</span>
                          {item.bookedAppointmentId && (
                            <button
                              type="button"
                              onClick={() => handleBookNext(item)}
                              className="text-xs text-medical-primary hover:underline font-medium text-left flex items-center gap-0.5"
                              title="Áthelyezés másik időpontra (a jelenlegi foglalás automatikusan törlődik)"
                            >
                              <CalendarClock className="w-3 h-3" />
                              Áthelyezés
                            </button>
                          )}
                          {item.bookedAppointmentId && item.workPhaseId && (() => {
                            const hasCandidate = items.some(
                              (i) =>
                                i.episodeId === item.episodeId &&
                                i.pool === item.pool &&
                                i.workPhaseId &&
                                i.workPhaseId !== item.workPhaseId &&
                                i.stepStatus !== 'completed' &&
                                i.stepStatus !== 'skipped' &&
                                !i.bookedAppointmentId
                            );
                            if (!hasCandidate) return null;
                            const isSubmitting = reassignStepSubmittingId === item.bookedAppointmentId;
                            return (
                              <button
                                type="button"
                                onClick={() => handleOpenReassignStep(item)}
                                disabled={isSubmitting}
                                className="text-xs text-purple-700 hover:underline font-medium text-left flex items-center gap-0.5 disabled:opacity-50"
                                title="A foglalás átrendezése az epizód másik munkafázisára (az időpont nem változik, csak a fázis-hovatartozás)"
                              >
                                <Shuffle className="w-3 h-3" />
                                {isSubmitting ? 'Átrendezés…' : 'Másik fázisra'}
                              </button>
                            );
                          })()}
                          {item.bookedAppointmentId && (
                            <button
                              type="button"
                              onClick={() =>
                                setUnsuccessfulModalCtx({
                                  item,
                                  appointmentId: item.bookedAppointmentId!,
                                  appointmentStart: item.bookedAppointmentStartTime ?? null,
                                  attemptNumber: currentAttempt,
                                })
                              }
                              className="text-xs text-orange-700 hover:underline font-medium text-left flex items-center gap-0.5"
                              title="A próba sikertelen volt — új próba szükséges"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              Sikertelen próba
                            </button>
                          )}
                          {item.bookedAppointmentId && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAppointment(item.bookedAppointmentId!)}
                              disabled={deleteAppointmentId === item.bookedAppointmentId}
                              className="text-xs text-red-600 hover:underline font-medium disabled:opacity-50 text-left flex items-center gap-0.5"
                              title="Időpont törlése (slot felszabadul)"
                            >
                              <Trash2 className="w-3 h-3" />
                              {deleteAppointmentId === item.bookedAppointmentId ? 'Törlés…' : 'Törlés'}
                            </button>
                          )}
                          {item.workPhaseId && (
                            <button
                              type="button"
                              onClick={() => handleMarkStepComplete(item)}
                              disabled={markCompleteKey === key}
                              className="text-xs text-gray-600 hover:underline font-medium disabled:opacity-50 text-left"
                              title="A munkafázis elkészült (nem itt foglalt), utólag jelölés"
                            >
                              {markCompleteKey === key ? 'Mentés…' : 'Elkészült (utólag)'}
                            </button>
                          )}
                        </>
                      )}
                      {state === 'BLOCKED' && item.blockedCode === 'NO_CARE_PATHWAY' && (
                        <button
                          onClick={() => handleAssignDefaultPathway(item)}
                          disabled={pathwayAssigningEpisodeId === item.episodeId}
                          className="text-sm text-medical-primary hover:underline font-medium disabled:opacity-50"
                        >
                          {pathwayAssigningEpisodeId === item.episodeId ? 'Beállítás…' : 'Kezelési út beállítása'}
                        </button>
                      )}
                      {state === 'BOOKING_IN_PROGRESS' && (
                        <span className="text-sm text-gray-500">Foglalás…</span>
                      )}
                    </div>
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {override429 && (
        <OverrideModal
          open={!!override429}
          onClose={() => setOverride429(null)}
          error={override429.error}
          overrideHint={override429.overrideHint}
          expectedHardNext={override429.expectedHardNext}
          existingAppointment={override429.existingAppointment}
          onConfirm={handleOverrideConfirm}
        />
      )}

      {slotPickerItem && (
        <SlotPickerModal
          open={!!slotPickerItem}
          onClose={() => {
            setSlotPickerItem(null);
            setSlotPickerRetryContext(null);
          }}
          pool={(slotPickerItem.pool as 'work' | 'consult' | 'control') || 'work'}
          durationMinutes={slotPickerItem.durationMinutes || 30}
          windowStart={
            slotPickerItem.windowStart ? new Date(slotPickerItem.windowStart) : new Date()
          }
          windowEnd={
            slotPickerItem.windowEnd ? new Date(slotPickerItem.windowEnd) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          }
          patientId={slotPickerItem.patientId}
          episodeId={slotPickerItem.episodeId}
          providerId={slotPickerItem.assignedProviderId ?? undefined}
          patientName={slotPickerItem.patientName ?? undefined}
          rescheduleFromIso={
            // Retry context elnyomja a "reschedule" bannert — egyértelmű, hogy
            // ez ÚJ próba, nem a régi áthelyezése.
            slotPickerRetryContext
              ? null
              : slotPickerItem.bookedAppointmentId
                ? slotPickerItem.bookedAppointmentStartTime ?? null
                : null
          }
          retryContext={slotPickerRetryContext}
          onSelectSlot={handleSelectSlot}
        />
      )}

      {unsuccessfulModalCtx && (
        <UnsuccessfulAttemptModal
          open
          onClose={() => setUnsuccessfulModalCtx(null)}
          appointmentId={unsuccessfulModalCtx.appointmentId}
          appointmentStart={unsuccessfulModalCtx.appointmentStart}
          stepLabel={unsuccessfulModalCtx.item.stepLabel ?? unsuccessfulModalCtx.item.nextStep}
          attemptNumber={unsuccessfulModalCtx.attemptNumber}
          onConfirmed={async (payload) => {
            await handleMarkUnsuccessfulConfirmed(
              unsuccessfulModalCtx.appointmentId,
              unsuccessfulModalCtx.item,
              payload,
              {
                previousAttemptNumber: unsuccessfulModalCtx.attemptNumber,
                previousFailedAtISO: unsuccessfulModalCtx.appointmentStart,
              }
            );
          }}
        />
      )}

      {revertModalCtx && (
        <RevertUnsuccessfulModal
          open
          onClose={() => setRevertModalCtx(null)}
          appointmentId={revertModalCtx.attempt.appointmentId}
          appointmentStart={revertModalCtx.attempt.startTime}
          stepLabel={revertModalCtx.item.stepLabel ?? revertModalCtx.item.nextStep}
          attemptNumber={revertModalCtx.attempt.attemptNumber}
          originalFailedReason={revertModalCtx.attempt.failedReason}
          onConfirmed={async (reason) => {
            await handleRevertUnsuccessfulConfirmed(
              revertModalCtx.attempt.appointmentId,
              reason
            );
          }}
        />
      )}

      {markCompleteRetroCtx && (
        <MarkCompletedRetroModal
          open
          onClose={() => setMarkCompleteRetroCtx(null)}
          patientId={markCompleteRetroCtx.item.patientId}
          stepLabel={markCompleteRetroCtx.item.stepLabel ?? markCompleteRetroCtx.item.nextStep}
          excludeAppointmentIds={markCompleteRetroCtx.excludeAppointmentIds}
          onConfirm={async (payload) => {
            await handleConfirmMarkCompleteRetro(markCompleteRetroCtx.item, payload);
          }}
        />
      )}

      {reassignStepCtx && (
        <ReassignStepModal
          open
          onClose={() => setReassignStepCtx(null)}
          sourceItem={reassignStepCtx.item}
          candidates={reassignStepCtx.candidates}
          onConfirm={async (payload) => {
            const apptId = reassignStepCtx.item.bookedAppointmentId;
            if (!apptId) return;
            await handleConfirmReassignStep(apptId, payload);
          }}
        />
      )}
    </div>
  );
}
