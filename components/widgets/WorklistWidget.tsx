'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ClipboardList, Calendar, CalendarCheck } from 'lucide-react';
import {
  getWorklistItemKey,
  deriveWorklistRowState,
  type WorklistItemBackend,
  type WorklistLocalState,
} from '@/lib/worklist-types';
import { formatShortDateRange } from '@/lib/datetime';
import { SlotPickerModal } from '../SlotPickerModal';
import { OverrideModal } from '../OverrideModal';
import { BookingQueueModal } from '../BookingQueueModal';

const CAN_SEE_WORKLIST_ROLES = ['admin', 'sebészorvos', 'fogpótlástanász'];

export function WorklistWidget() {
  const [items, setItems] = useState<WorklistItemBackend[]>([]);
  const [serverNowISO, setServerNowISO] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [local, setLocal] = useState<WorklistLocalState>({});
  const [slotPickerItem, setSlotPickerItem] = useState<WorklistItemBackend | null>(null);
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [pathwayAssigningEpisodeId, setPathwayAssigningEpisodeId] = useState<string | null>(null);
  const [override429, setOverride429] = useState<{
    error: string;
    overrideHint?: string;
    expectedHardNext?: { stepCode: string; earliestStart: string; latestStart: string; durationMinutes: number };
    existingAppointment?: { id: string; startTime: string; providerName?: string };
    retryData: { patientId: string; episodeId?: string; slotId: string; pool: string; durationMinutes: number; nextStep: string; stepCode?: string; requiresPrecommit?: boolean };
  } | null>(null);

  const fetchWorklist = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/worklists/wip-next-appointments', { credentials: 'include' });
      setStatus(res.status);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Hiba történt');
        setItems([]);
        setServerNowISO(null);
        return;
      }
      setItems(data.items ?? []);
      setServerNowISO(data.serverNowISO ?? new Date().toISOString());
    } catch (e) {
      setError('Hálózati hiba');
      setItems([]);
      setServerNowISO(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorklist();
  }, [fetchWorklist]);

  const serverNow = serverNowISO ? new Date(serverNowISO) : new Date();

  const sortedItems = [...items].sort((a, b) => {
    const keyA = getWorklistItemKey(a);
    const keyB = getWorklistItemKey(b);
    const { state: stateA } = deriveWorklistRowState(a, local, keyA);
    const { state: stateB } = deriveWorklistRowState(b, local, keyB);

    const priority = (state: string, overdue: number) => {
      if (state === 'READY' && overdue > 0) return 3;
      if (state === 'READY') return 2;
      if (state === 'BLOCKED') return 1;
      return 0;
    };
    const pA = priority(stateA, a.overdueByDays ?? 0);
    const pB = priority(stateB, b.overdueByDays ?? 0);
    if (pB !== pA) return pB - pA;
    const winEndA = a.windowEnd ?? '';
    const winEndB = b.windowEnd ?? '';
    if (winEndA !== winEndB) return winEndA.localeCompare(winEndB);
    const nameA = (a.patientName ?? '').toLowerCase();
    const nameB = (b.patientName ?? '').toLowerCase();
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return keyA.localeCompare(keyB);
  });

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

  const handleBatchBookNext = () => {
    if (selectedReady.length > 1) {
      setShowQueueModal(true);
    } else if (selectedReady.length === 1) {
      setSlotPickerItem(selectedReady[0]);
    }
  };

  const onBookItemForQueue = async (
    item: WorklistItemBackend,
    slotId: string,
    overrideReason?: string
  ): Promise<
    | { success: boolean }
    | { skip: boolean }
    | { needsOverride: { error: string; overrideHint?: string; expectedHardNext?: unknown; existingAppointment?: unknown } }
  > => {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        patientId: item.patientId,
        episodeId: item.episodeId ?? null,
        timeSlotId: slotId,
        pool: item.pool || 'work',
        requiresPrecommit: item.requiresPrecommit ?? false,
        stepCode: item.stepCode ?? item.nextStep,
        overrideReason: overrideReason || undefined,
        createdVia: 'worklist',
      }),
    });
    const data = await res.json();

    if (res.ok) return { success: true };
    if (res.status === 409 && data.code === 'ONE_HARD_NEXT_VIOLATION') {
      return {
        needsOverride: {
          error: data.error ?? 'Epizódnak már van jövőbeli munkafoglalása',
          overrideHint: data.overrideHint,
          expectedHardNext: data.expectedHardNext,
          existingAppointment: data.existingAppointment,
        },
      };
    }
    if (res.status === 409 && (data.code === 'SLOT_ALREADY_BOOKED' || data.error?.includes('foglalt'))) {
      return { skip: true };
    }
    throw new Error(data.error ?? 'Hiba történt');
  };

  const handleBatchComplete = (bookedKeys: string[], skippedKeys: string[]) => {
    setItems((prev) => prev.filter((i) => !bookedKeys.includes(getWorklistItemKey(i))));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      [...bookedKeys, ...skippedKeys].forEach((k) => next.delete(k));
      return next;
    });
    setLocal((prev) => {
      const progressArr = Array.from(prev.bookingInProgressKeys ?? []);
      const overrideArr = Array.from(prev.overrideRequiredKeys ?? []);
      return {
        ...prev,
        bookingInProgressKeys: new Set(progressArr.filter((k) => !bookedKeys.includes(k))),
        overrideRequiredKeys: new Set(overrideArr.filter((k) => !bookedKeys.includes(k))),
      };
    });
    setShowQueueModal(false);
    fetchWorklist();
  };

  const handleSelectSlot = async (slotId: string) => {
    if (!slotPickerItem) return;
    const { patientId, episodeId, pool, durationMinutes, nextStep, stepCode: itemStepCode } = slotPickerItem;
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
          patientId,
          episodeId: episodeId ?? null,
          timeSlotId: slotId,
          pool: pool || 'work',
          requiresPrecommit: slotPickerItem.requiresPrecommit ?? false,
          stepCode: itemStepCode ?? nextStep,
          createdVia: 'worklist',
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setSlotPickerItem(null);
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
          overrideRequiredKeys: new Set([...Array.from(prev.overrideRequiredKeys ?? []), key]),
          bookingInProgressKeys: new Set(Array.from(prev.bookingInProgressKeys ?? []).filter((k) => k !== key)),
        }));
        setSlotPickerItem(null);
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

  const handleOverrideConfirm = async (overrideReason: string) => {
    if (!override429) return;
    const { retryData } = override429;
    const matchKey = (i: WorklistItemBackend) => i.episodeId === retryData.episodeId && i.nextStep === retryData.nextStep;
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
          createdVia: 'worklist',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Hiba');
      const removedItem = items.find(matchKey);
      const removedKey = removedItem ? getWorklistItemKey(removedItem) : null;
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

  const canSelect = (item: WorklistItemBackend) => {
    const key = getWorklistItemKey(item);
    const { state } = deriveWorklistRowState(item, local, key);
    return state === 'READY';
  };

  const toggleSelect = (item: WorklistItemBackend) => {
    if (!canSelect(item)) return;
    const key = getWorklistItemKey(item);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading && items.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-medical-primary/20 border-t-medical-primary" />
          <span className="ml-3 text-body-sm">Munkalista betöltése...</span>
        </div>
      </div>
    );
  }

  if (status === 403) {
    return (
      <div className="card border-amber-200 bg-amber-50">
        <p className="text-amber-800 text-center py-4">Nincs hozzáférés a munkalistához.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50">
        <p className="text-red-800 text-center py-4">
          Hiba történt – <button onClick={fetchWorklist} className="underline font-medium">Retry</button>
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card">
        <div className="text-center py-12">
          <ClipboardList className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">Nincs foglalni való lépés</h3>
          <p className="text-sm text-gray-500">Jelenleg nincs foglalni való következő lépés.</p>
        </div>
      </div>
    );
  }

  const selectedReady = sortedItems.filter((i) => selectedKeys.has(getWorklistItemKey(i)) && canSelect(i));

  return (
    <div className="space-y-4">
      {selectedReady.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">
            {selectedReady.length} kiválasztva – Book next for selected
          </span>
          <button onClick={handleBatchBookNext} className="btn-primary text-sm">
            Következő foglalása
          </button>
        </div>
      )}

      {showQueueModal && (
        <BookingQueueModal
          open={showQueueModal}
          onClose={() => setShowQueueModal(false)}
          items={selectedReady}
          onBatchComplete={handleBatchComplete}
          onBookItem={onBookItemForQueue}
          getItemKey={getWorklistItemKey}
        />
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Betegnév</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Stage</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Next step</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">ETA</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Hátralévő</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">SLA / overdue</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Window</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-24">Művelet</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => {
              const key = getWorklistItemKey(item);
              const { state, reviewReason } = deriveWorklistRowState(item, local, key);
              const isExpanded = expandedKey === key;
              const isSelected = selectedKeys.has(key);
              const selectable = canSelect(item);

              return (
                <tr
                  key={key}
                  className={`border-b ${item.overdueByDays > 0 ? 'bg-red-50/50' : ''} ${state === 'BLOCKED' ? 'opacity-70' : ''}`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(item)}
                          className="form-checkbox"
                        />
                      )}
                      <Link
                        href={`/patients/${item.patientId}/view`}
                        className="text-medical-primary hover:underline font-medium"
                      >
                        {item.patientName ?? `#${item.patientId.slice(0, 8)}`}
                      </Link>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600">{item.currentStage}</td>
                  <td className="px-3 py-2">
                    <span className="text-sm font-medium">{item.nextStep}</span>
                    {item.durationMinutes > 0 && (
                      <span className="ml-1 text-xs text-gray-500">{item.durationMinutes} perc</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600">
                    {state !== 'BLOCKED' && item.forecastCompletionEndP80ISO ? (
                      (() => {
                        const d = new Date(item.forecastCompletionEndP80ISO);
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        return `~${m}.${day}`;
                      })()
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600">
                    {state !== 'BLOCKED' && (item.forecastRemainingP50 != null || item.forecastRemainingP80 != null) ? (
                      <span
                        title={`P50: ${item.forecastRemainingP50 ?? '–'} látogatás | P80: ${item.forecastRemainingP80 ?? '–'} látogatás`}
                      >
                        P50: {item.forecastRemainingP50 ?? '–'} | P80: {item.forecastRemainingP80 ?? '–'}
                      </span>
                    ) : (
                      '–'
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
                    {item.windowStart && item.windowEnd
                      ? formatShortDateRange(item.windowStart, item.windowEnd)
                      : '–'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded w-fit ${
                          state === 'BOOKED'
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
                        {state === 'BOOKED' ? 'LEFOGLALVA' : state}
                        {state === 'BLOCKED' && item.blockedReason && (
                          <span className="ml-1 truncate max-w-[120px] inline-block" title={item.blockedReason}>
                            {item.blockedReason.slice(0, 20)}…
                          </span>
                        )}
                      </span>
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
                    {state === 'READY' && (
                      <button
                        onClick={() => handleBookNext(item)}
                        className="text-sm text-medical-primary hover:underline font-medium"
                      >
                        Book next
                      </button>
                    )}
                    {state === 'BOOKED' && (
                      <span className="text-xs text-blue-600 font-medium">✓ Foglalva</span>
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
                  </td>
                </tr>
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
          onClose={() => setSlotPickerItem(null)}
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
          patientName={slotPickerItem.patientName ?? undefined}
          onSelectSlot={handleSelectSlot}
        />
      )}
    </div>
  );
}
