'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Calendar, Clock } from 'lucide-react';
import { toBudapestStartOfDayISO } from '@/lib/datetime';

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
      if (providerId) params.set('providerId', providerId);
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
  }, [open, pool, durationMinutes, windowStart, windowEnd, providerId]);

  useEffect(() => {
    if (open) {
      fetchSlots();
    }
  }, [open, fetchSlots]);

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

        <div className="flex flex-wrap gap-2 p-4 border-b bg-gray-50">
          <span className="px-2 py-1 rounded text-xs font-medium bg-medical-primary/20 text-medical-primary">{pool}</span>
          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200">{durationMinutes} perc</span>
          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200">
            {windowStartISO} – {windowEndISO}
          </span>
          {providerId && <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200">Provider: {providerId}</span>}
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
          {!loading && !slotError && slots.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p className="font-medium">Nincs elérhető slot az ablakban.</p>
              <p className="text-sm mt-1">Próbáld a window tágítását vagy más provider-t.</p>
            </div>
          )}
          {!loading && !slotError && dayKeys.length > 0 && (
            <div className="space-y-4">
              {dayKeys.map((day) => (
                <div key={day}>
                  <div className="sticky top-0 bg-white py-2 font-medium text-gray-700 border-b">
                    {new Date(day).toLocaleDateString('hu-HU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
