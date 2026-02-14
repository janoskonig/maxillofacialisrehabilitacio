'use client';

import { useState, useEffect, useCallback } from 'react';
import { ClipboardList } from 'lucide-react';
import {
  getWorklistItemKey,
  deriveWorklistRowState,
  type WorklistItemBackend,
  type WorklistLocalState,
} from '@/lib/worklist-types';
import { formatShortDateRange } from '@/lib/datetime';
import { SlotPickerModal } from './SlotPickerModal';
import { OverrideModal } from './OverrideModal';
import { EpisodePathwayModal } from './EpisodePathwayModal';

export interface PatientWorklistWidgetProps {
  patientId: string;
  patientName?: string | null;
  /** Ha false, nem jelenik meg a widget (pl. nincs jogosultság) */
  visible?: boolean;
}

/**
 * Beteg profilra szűrt munkalista – a beteg WIP epizódjainak következő lépései.
 * Csak admin, sebészorvos, fogpótlástanász látja.
 */
export function PatientWorklistWidget({ patientId, patientName, visible = true }: PatientWorklistWidgetProps) {
  const [items, setItems] = useState<WorklistItemBackend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [local, setLocal] = useState<WorklistLocalState>({});
  const [slotPickerItem, setSlotPickerItem] = useState<WorklistItemBackend | null>(null);
  const [pathwayModalItem, setPathwayModalItem] = useState<WorklistItemBackend | null>(null);
  const [override429, setOverride429] = useState<{
    error: string;
    overrideHint?: string;
    expectedHardNext?: { stepCode: string; earliestStart: string; latestStart: string; durationMinutes: number };
    existingAppointment?: { id: string; startTime: string; providerName?: string };
    retryData: { patientId: string; episodeId?: string; slotId: string; pool: string; durationMinutes: number; nextStep: string };
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
        return;
      }
      setItems(data.items ?? []);
    } catch (e) {
      setError('Hálózati hiba');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    fetchWorklist();
  }, [fetchWorklist]);

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
    return winEndA.localeCompare(winEndB);
  });

  const handleBookNext = (item: WorklistItemBackend) => {
    setSlotPickerItem(item);
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
          requiresPrecommit: false,
          stepCode: nextStep,
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
          requiresPrecommit: false,
          stepCode: retryData.nextStep,
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

  if (!visible) return null;

  if (loading && items.length === 0) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-medical-primary/20 border-t-medical-primary" />
          <span className="ml-2 text-sm text-gray-600">Következő lépés betöltése…</span>
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
          <h3 className="text-base font-medium text-gray-900 mb-1">Nincs foglalni való következő lépés</h3>
          <p className="text-sm text-gray-500">
            {patientName
              ? `${patientName} jelenleg nincs WIP epizódban, vagy minden epizódhoz már van jövőbeli időpont.`
              : 'A beteg jelenleg nincs WIP epizódban, vagy minden epizódhoz már van jövőbeli időpont.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Epizód / Stage</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Következő lépés</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">SLA / késés</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Ablak</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Státusz</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-24">Művelet</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => {
              const key = getWorklistItemKey(item);
              const { state } = deriveWorklistRowState(item, local, key);

              return (
                <tr
                  key={key}
                  className={`border-b ${item.overdueByDays > 0 ? 'bg-red-50/50' : ''} ${state === 'BLOCKED' ? 'opacity-70' : ''}`}
                >
                  <td className="px-3 py-2 text-sm text-gray-600">
                    {item.currentStage}
                    <span className="ml-1 text-xs text-gray-400">#{item.episodeId.slice(0, 8)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-sm font-medium">{item.nextStep}</span>
                    {item.durationMinutes > 0 && (
                      <span className="ml-1 text-xs text-gray-500">{item.durationMinutes} perc</span>
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
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        state === 'READY'
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
                      {state}
                      {state === 'BLOCKED' && item.blockedReason && (
                        <span className="ml-1 truncate max-w-[100px] inline-block" title={item.blockedReason}>
                          {item.blockedReason.slice(0, 15)}…
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {state === 'READY' && (
                      <button
                        onClick={() => handleBookNext(item)}
                        className="text-sm text-medical-primary hover:underline font-medium"
                      >
                        Foglalás
                      </button>
                    )}
                    {state === 'BLOCKED' && item.blockedCode === 'NO_CARE_PATHWAY' && (
                      <button
                        onClick={() => setPathwayModalItem(item)}
                        className="text-sm text-medical-primary hover:underline font-medium"
                      >
                        Kezelési út hozzárendelése
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

      {pathwayModalItem && (
        <EpisodePathwayModal
          open={!!pathwayModalItem}
          onClose={() => setPathwayModalItem(null)}
          episodeId={pathwayModalItem.episodeId}
          patientName={pathwayModalItem.patientName ?? patientName ?? null}
          onSaved={async () => {
            await fetchWorklist();
          }}
        />
      )}

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
