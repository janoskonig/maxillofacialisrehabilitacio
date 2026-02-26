'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Calendar, Clock, Users, Plus } from 'lucide-react';
import { toBudapestStartOfDayISO } from '@/lib/datetime';

interface Doctor {
  id: string;
  email: string;
  name: string;
  intezmeny?: string | null;
}

interface Slot {
  id: string;
  startTime: string;
  durationMinutes?: number;
  slotPurpose?: string | null;
  dentistEmail?: string;
  dentistName?: string | null;
  dentistUserId?: string;
}

export interface SlotPickerModalProps {
  open: boolean;
  onClose: () => void;
  pool: 'work' | 'consult' | 'control';
  durationMinutes: number;
  windowStart: Date;
  windowEnd: Date;
  providerId?: string;
  patientId: string;
  episodeId?: string | null;
  patientName?: string;
  onSelectSlot: (slotId: string) => void | Promise<void>;
}

export function SlotPickerModal({
  open,
  onClose,
  pool,
  durationMinutes,
  windowStart,
  windowEnd,
  providerId,
  patientId,
  episodeId,
  patientName,
  onSelectSlot,
}: SlotPickerModalProps) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [queryEcho, setQueryEcho] = useState<Record<string, unknown> | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const slotsRef = useRef<HTMLDivElement>(null);
  const [weeklyDemand, setWeeklyDemand] = useState<Map<string, number>>(new Map());
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>(undefined);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDate, setCreateDate] = useState('');
  const [createTime, setCreateTime] = useState('09:00');
  const [createProviderId, setCreateProviderId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const windowStartISO = toBudapestStartOfDayISO(windowStart);
  const windowEndISO = toBudapestStartOfDayISO(windowEnd);

  const fetchSlots = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setSlotError(null);
    try {
      const params = new URLSearchParams({
        pool,
        durationMinutes: String(durationMinutes),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        limit: '50',
      });
      const effectiveProviderId = selectedProviderId ?? providerId;
      if (effectiveProviderId) params.set('providerId', effectiveProviderId);
      const res = await fetch(`/api/worklists/slots-for-booking?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        setSlotError(data.error ?? 'Hiba történt');
        setSlots([]);
        return;
      }
      setSlots(data.slots ?? []);
      setQueryEcho(data.queryEcho ?? null);
    } catch (e) {
      setSlotError('Hálózati hiba');
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [open, pool, durationMinutes, windowStart, windowEnd, providerId, selectedProviderId]);

  useEffect(() => {
    if (open) {
      setSelectedProviderId(providerId ?? undefined);
      setCreateDate(windowStartISO.slice(0, 10));
      setCreateProviderId(providerId ?? '');
    }
  }, [open, providerId, windowStartISO]);

  useEffect(() => {
    if (open && doctors.length > 0 && !createProviderId) setCreateProviderId(doctors[0].id);
  }, [open, doctors, createProviderId]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/users/doctors?forSlotPicker=1', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setDoctors(data.doctors ?? []);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (open) {
      fetchSlots();
    }
  }, [open, fetchSlots]);

  // Fetch intent density for week labels
  useEffect(() => {
    if (!open) return;
    fetch(`/api/capacity-forecast?pool=${pool}&weeks=12`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const map = new Map<string, number>();
        for (const w of data.weeks ?? []) {
          const ws = new Date(w.weekStart);
          const key = `${ws.getFullYear()}-W${String(getISOWeek(ws)).padStart(2, '0')}`;
          map.set(key, w.softDemand ?? 0);
        }
        setWeeklyDemand(map);
      })
      .catch(() => {});
  }, [open, pool]);

  const handleSelectSlot = async (slotId: string) => {
    if (posting) return;
    setSelectedSlotId(slotId);
    setPosting(true);
    setSlotError(null);
    try {
      await onSelectSlot(slotId);
      onClose();
    } catch (e) {
      setSlotError(e instanceof Error ? e.message : 'Hiba történt');
      setSelectedSlotId(null);
    } finally {
      setPosting(false);
    }
  };

  const handleCreateAndBook = async () => {
    if (!createDate || !createTime || !createProviderId || creating) return;
    const startTime = new Date(`${createDate}T${createTime}:00`);
    if (startTime <= new Date()) {
      setCreateError('Csak jövőbeli időpont adható meg.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/time-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startTime: startTime.toISOString(),
          userId: createProviderId,
          slotPurpose: pool,
          durationMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? 'Hiba történt');
        return;
      }
      const newSlotId = data.timeSlot?.id;
      if (!newSlotId) {
        setCreateError('Hiba: nincs slot id a válaszban');
        return;
      }
      await handleSelectSlot(newSlotId);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Hálózati hiba');
    } finally {
      setCreating(false);
    }
  };

  function getISOWeek(d: Date): number {
    const date = new Date(d.valueOf());
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  }

  function getDemandForDay(dayStr: string): number {
    const d = new Date(dayStr);
    const key = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, '0')}`;
    return weeklyDemand.get(key) ?? 0;
  }

  const groupedByDay = slots.reduce<Record<string, Slot[]>>((acc, slot) => {
    const d = slot.startTime.split('T')[0];
    if (!acc[d]) acc[d] = [];
    acc[d].push(slot);
    return acc;
  }, {});
  const dayKeys = Object.keys(groupedByDay).sort();

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="slot-picker-title">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 id="slot-picker-title" className="text-lg font-semibold text-gray-900">
            Időpont választás{patientName ? ` – ${patientName}` : ''}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-1" aria-label="Bezárás">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 p-4 border-b bg-gray-50 items-center">
          <span className="px-2 py-1 rounded text-xs font-medium bg-medical-primary/20 text-medical-primary">{pool}</span>
          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200">{durationMinutes} perc</span>
          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200">
            {windowStartISO} – {windowEndISO}
          </span>
          <label className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-600">Orvos:</span>
            <select
              value={selectedProviderId ?? ''}
              onChange={(e) => setSelectedProviderId(e.target.value || undefined)}
              className="text-xs rounded border border-gray-300 bg-white px-2 py-1.5 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-medical-primary/50"
              aria-label="Orvos szűrő"
            >
              <option value="">Összes orvos</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div ref={slotsRef} className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-medical-primary/20 border-t-medical-primary" />
              <span className="ml-3 text-sm">Időpontok betöltése...</span>
            </div>
          )}
          {slotError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm" role="alert">
              {slotError}
            </div>
          )}
          {!loading && !slotError && slots.length === 0 && !showCreateForm && (
            <div className="text-center py-8 text-gray-500">
              <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p className="font-medium">Csak a kiírt szabad időpontok jelennek meg.</p>
              <p className="text-sm mt-1">Nincs ilyen slot az ablakban. Kiírhatsz újat alább, és rögtön lefoglalod.</p>
            </div>
          )}

          <div className="mb-4">
            {!showCreateForm ? (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-medical-primary border border-medical-primary rounded-lg hover:bg-medical-primary/5"
              >
                <Plus className="w-4 h-4" />
                Új szabad időpont kiírása és lefoglalása
              </button>
            ) : (
              <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-3">
                <p className="text-sm font-medium text-gray-700">Új szabad időpont kiírása és lefoglalása</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-gray-600">Dátum</span>
                    <input
                      type="date"
                      value={createDate}
                      onChange={(e) => setCreateDate(e.target.value)}
                      min={windowStartISO.slice(0, 10)}
                      className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-600">Idő</span>
                    <input
                      type="time"
                      value={createTime}
                      onChange={(e) => setCreateTime(e.target.value)}
                      className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs text-gray-600">Orvos</span>
                  <select
                    value={createProviderId}
                    onChange={(e) => setCreateProviderId(e.target.value)}
                    className="mt-0.5 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
                  >
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
                {createError && (
                  <p className="text-sm text-red-600" role="alert">{createError}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCreateAndBook}
                    disabled={creating || !createDate || !createTime || !createProviderId}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-medical-primary rounded-lg hover:bg-medical-primary/90 disabled:opacity-50"
                  >
                    {creating ? 'Létrehozás...' : 'Kiírás és lefoglalás'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreateForm(false); setCreateError(null); }}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Mégse
                  </button>
                </div>
              </div>
            )}
          </div>
          {!loading && !slotError && dayKeys.length > 0 && (
            <div className="space-y-4">
              {dayKeys.map((day) => {
                const demand = getDemandForDay(day);
                return (
                <div key={day}>
                  <div className="sticky top-0 bg-white py-2 font-medium text-gray-700 border-b flex items-center justify-between">
                    <span>{new Date(day).toLocaleDateString('hu-HU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                    {demand > 0 && (
                      <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full" title="Erre a hétre ennyi beteg demand projection-je esik">
                        <Users className="w-3 h-3" />
                        {demand} tervezett
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                    {groupedByDay[day].map((slot) => {
                      const time = slot.startTime.split('T')[1]?.slice(0, 5) ?? slot.startTime;
                      const isSelected = selectedSlotId === slot.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => handleSelectSlot(slot.id)}
                          disabled={posting}
                          className={`flex flex-col items-start p-3 rounded-lg border text-left transition-colors ${
                            isSelected ? 'border-medical-primary bg-medical-primary/10' : 'border-gray-200 hover:border-medical-primary/50 hover:bg-gray-50'
                          } ${posting ? 'opacity-70' : ''}`}
                        >
                          <span className="text-lg font-semibold text-gray-900">{time}</span>
                          <span className="text-xs text-gray-600 mt-0.5 truncate w-full">
                            {slot.dentistName ?? slot.dentistEmail ?? '–'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
