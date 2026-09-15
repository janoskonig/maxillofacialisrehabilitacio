'use client';

/**
 * CancelAppointmentDialog — időpont lemondása, opcionálisan új ajánlattal.
 *
 * Két mód:
 *   • „Csak lemondás": a meglévő DELETE /api/appointments/:id folyamat (a beteg
 *     és a fogpótlástanász értesítést kap, az időpont felszabadul).
 *   • „Lemondás és új időpont ajánlása": POST /api/appointments/:id/cancel-and-offer
 *     — a régi időpont lemondva, a beteg EGY levélben kapja a lemondást és az
 *     új, jóváhagyásra váró ajánlatot (Elfogadom / Elvetem — a feltételes
 *     időpont mintája). Alternatív időpontok is megadhatók: elvetésnél a
 *     rendszer automatikusan a következőt ajánlja.
 *
 * A dialógus nem hív API-t közvetlenül a lemondáshoz — a hívó adja az
 * `onPlainCancel` / `onCancelWithOffer` műveleteket (useAppointmentBooking),
 * így a lista-frissítés és a terv-kártya értesítése egy helyen marad. Az „Új
 * időpont létrehozása" (POST /api/time-slots) itt történik, mert ez csak a
 * dialógus belső segédlépése.
 */

import { useEffect, useMemo, useState } from 'react';
import { X, XCircle, Mail, Plus, AlertCircle, CalendarPlus } from 'lucide-react';
import { formatDateTime, toLocalISOString, digitsOnly } from '@/lib/dateUtils';
import { DateTimePicker } from './DateTimePicker';
import { useModalA11y } from '@/hooks/useModalA11y';
import { APPOINTMENT_TYPE_OPTIONS, getAppointmentTypeLabel } from '@/lib/appointment-constants';
import type {
  Appointment,
  AppointmentType,
  CancelWithOfferParams,
  OperationResult,
  TimeSlot,
} from '@/hooks/useAppointmentBooking';

export type CancelMode = 'plain' | 'offer';

export interface CancelAppointmentDialogProps {
  appointment: Appointment;
  /** A hook által betöltött szabad időpontok (a pool szerint szűrve). */
  availableSlots: TimeSlot[];
  /** Csak admin / fogpótlástanász küldhet ajánlatot (a szerver is ezt kéri). */
  canOffer: boolean;
  /** Új slot létrehozásához (POST /api/time-slots) — csak fogpótlástanász / admin. */
  canCreateSlot: boolean;
  defaultCim: string;
  pool?: 'consult' | 'work' | 'control';
  onClose: () => void;
  onPlainCancel: () => Promise<OperationResult>;
  onCancelWithOffer: (params: CancelWithOfferParams) => Promise<OperationResult>;
  /** Sikeres művelet után (a hívó pl. alert-et mutat). */
  onDone?: (mode: CancelMode) => void;
}

const MAX_ALTERNATIVES = 3;

function slotLabel(slot: TimeSlot, defaultCim: string): string {
  const parts = [formatDateTime(slot.startTime)];
  if (slot.dentistName) parts.push(slot.dentistName);
  parts.push(slot.cim || defaultCim);
  if (slot.teremszam) parts.push(`Terem: ${slot.teremszam}`);
  return parts.join(' - ');
}

export function CancelAppointmentDialog({
  appointment,
  availableSlots,
  canOffer,
  canCreateSlot,
  defaultCim,
  pool,
  onClose,
  onPlainCancel,
  onCancelWithOffer,
  onDone,
}: CancelAppointmentDialogProps) {
  const hasPatientEmail = Boolean(appointment.patientEmail && appointment.patientEmail.trim() !== '');
  const offerAvailable = canOffer && hasPatientEmail;

  const [mode, setMode] = useState<CancelMode>('plain');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [appointmentType, setAppointmentType] = useState<AppointmentType | null>(
    appointment.appointmentType ?? null,
  );
  const [createdSlots, setCreatedSlots] = useState<TimeSlot[]>([]);
  const [showNewSlotForm, setShowNewSlotForm] = useState(false);
  const [newSlotDateTime, setNewSlotDateTime] = useState<Date | null>(null);
  const [newSlotTeremszam, setNewSlotTeremszam] = useState('');
  const [creatingSlot, setCreatingSlot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modalRef = useModalA11y({ onClose: submitting ? undefined : onClose });

  // Recall-időponthoz kötött foglalás csak recall típusú ajánlattal helyettesíthető.
  const typeLocked = appointment.appointmentType === 'recall';

  useEffect(() => {
    if (!offerAvailable && mode === 'offer') setMode('plain');
  }, [offerAvailable, mode]);

  const slotOptions = useMemo(() => {
    const now = Date.now();
    const merged = [...createdSlots, ...availableSlots];
    const seen = new Set<string>();
    return merged
      .filter((slot) => {
        if (seen.has(slot.id)) return false;
        seen.add(slot.id);
        return (
          slot.status === 'available' &&
          slot.id !== appointment.timeSlotId &&
          new Date(slot.startTime).getTime() > now
        );
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [availableSlots, createdSlots, appointment.timeSlotId]);

  const handleCreateSlot = async () => {
    if (!newSlotDateTime) {
      setError('Válasszon dátumot és időt az új időponthoz!');
      return;
    }
    if (newSlotDateTime <= new Date()) {
      setError('Az új időpont csak jövőbeli dátum lehet.');
      return;
    }
    setCreatingSlot(true);
    setError(null);
    try {
      const response = await fetch('/api/time-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startTime: toLocalISOString(newSlotDateTime),
          cim: defaultCim,
          teremszam: newSlotTeremszam.trim() || null,
          slotPurpose: pool ?? 'consult',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Hiba történt az időpont létrehozásakor');
        return;
      }
      const created: TimeSlot = {
        id: data.timeSlot.id,
        startTime: data.timeSlot.startTime,
        status: 'available',
        cim: data.timeSlot.cim ?? defaultCim,
        teremszam: data.timeSlot.teremszam ?? null,
        dentistName: data.timeSlot.dentistName ?? null,
      };
      setCreatedSlots((prev) => [created, ...prev]);
      setSelectedSlot(created.id);
      setShowNewSlotForm(false);
      setNewSlotDateTime(null);
      setNewSlotTeremszam('');
    } catch {
      setError('Hiba történt az időpont létrehozásakor (hálózati hiba)');
    } finally {
      setCreatingSlot(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setError(null);
    if (mode === 'offer' && !selectedSlot) {
      setError('Válassza ki az ajánlott új időpontot!');
      return;
    }
    setSubmitting(true);
    try {
      const result =
        mode === 'offer'
          ? await onCancelWithOffer({
              timeSlotId: selectedSlot,
              alternativeTimeSlotIds: alternatives.filter((id) => id && id !== selectedSlot),
              appointmentType: typeLocked ? 'recall' : appointmentType,
            })
          : await onPlainCancel();
      if (result.success) {
        onDone?.(mode);
        onClose();
      } else {
        setError(result.error || 'Hiba történt a lemondáskor');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const optionClass = (active: boolean, disabled = false) =>
    `block w-full text-left p-3 rounded-lg border transition-colors ${
      disabled
        ? 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 opacity-60 cursor-not-allowed'
        : active
          ? 'border-medical-primary bg-blue-50 dark:bg-blue-950/40 ring-1 ring-medical-primary'
          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60'
    }`;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-appointment-title"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto outline-none"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2
            id="cancel-appointment-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2"
          >
            <XCircle className="w-5 h-5 text-red-500 dark:text-red-400" />
            Időpont lemondása
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1"
            aria-label="Bezárás"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3 rounded">
            <div>
              <span className="font-medium">Időpont:</span> {formatDateTime(appointment.startTime)}
            </div>
            {appointment.appointmentType && (
              <div>
                <span className="font-medium">Típus:</span> {getAppointmentTypeLabel(appointment.appointmentType)}
              </div>
            )}
            {(appointment.stepLabel || appointment.stepCode) && (
              <div>
                <span className="font-medium">Munkafázis:</span> {appointment.stepLabel || appointment.stepCode}
              </div>
            )}
          </div>

          <div className="space-y-2" role="radiogroup" aria-label="Lemondás módja">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'plain'}
              onClick={() => setMode('plain')}
              disabled={submitting}
              className={optionClass(mode === 'plain')}
            >
              <div className="font-medium text-gray-900 dark:text-gray-100">Csak lemondás</div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                A beteg és a fogpótlástanász e-mail értesítést kap, az időpont felszabadul.
              </div>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'offer'}
              onClick={() => offerAvailable && setMode('offer')}
              disabled={submitting || !offerAvailable}
              className={optionClass(mode === 'offer', !offerAvailable)}
              title={
                !canOffer
                  ? 'Új ajánlatot csak admin vagy fogpótlástanász küldhet'
                  : !hasPatientEmail
                    ? 'A betegnek nincs e-mail címe'
                    : undefined
              }
            >
              <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                Lemondás és új időpont ajánlása
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                A beteg egy e-mailben kapja a lemondást és az új javaslatot, amit elfogadhat vagy elvethet
                (feltételes időpont). A munkafázis-kötés az ajánlatra kerül át.
              </div>
              {canOffer && !hasPatientEmail && (
                <div className="text-xs text-amber-700 dark:text-amber-300 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  A betegnek nincs rögzített e-mail címe — az ajánlat nem küldhető.
                </div>
              )}
            </button>
          </div>

          {mode === 'offer' && (
            <div className="space-y-4 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="cancel-offer-slot" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Ajánlott új időpont
                  </label>
                  {canCreateSlot && (
                    <button
                      type="button"
                      onClick={() => setShowNewSlotForm((v) => !v)}
                      disabled={submitting || creatingSlot}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/40"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      {showNewSlotForm ? 'Mégse' : 'Új időpont létrehozása'}
                    </button>
                  )}
                </div>
                {showNewSlotForm && (
                  <div className="mb-3 p-3 bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-800 rounded space-y-2">
                    <DateTimePicker
                      selected={newSlotDateTime}
                      onChange={(date: Date | null) => setNewSlotDateTime(date)}
                      minDate={new Date()}
                      placeholder="Válasszon dátumot és időt"
                      className="form-input w-full"
                      disabled={creatingSlot}
                    />
                    <input
                      type="text"
                      value={newSlotTeremszam}
                      onChange={(e) => setNewSlotTeremszam(digitsOnly(e.target.value))}
                      placeholder="Teremszám (opcionális)"
                      className="form-input w-full"
                      disabled={creatingSlot}
                    />
                    <button
                      type="button"
                      onClick={handleCreateSlot}
                      disabled={!newSlotDateTime || creatingSlot}
                      className="btn-secondary w-full text-sm"
                    >
                      {creatingSlot ? 'Létrehozás…' : 'Időpont létrehozása és kiválasztása'}
                    </button>
                  </div>
                )}
                <select
                  id="cancel-offer-slot"
                  value={selectedSlot}
                  onChange={(e) => setSelectedSlot(e.target.value)}
                  className="form-input w-full"
                  disabled={submitting}
                >
                  <option value="">Válasszon időpontot…</option>
                  {slotOptions.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slotLabel(slot, defaultCim)}
                    </option>
                  ))}
                </select>
                {slotOptions.length === 0 && !showNewSlotForm && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Jelenleg nincs szabad időpont{canCreateSlot ? ' — hozzon létre újat.' : '.'}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="cancel-offer-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Időpont típusa
                </label>
                <select
                  id="cancel-offer-type"
                  value={typeLocked ? 'recall' : appointmentType || ''}
                  onChange={(e) => setAppointmentType((e.target.value as AppointmentType) || null)}
                  className="form-input w-full"
                  disabled={submitting || typeLocked}
                >
                  <option value="">Nincs megadva</option>
                  {APPOINTMENT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {typeLocked && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Recall-feladathoz kötött időpont csak recall típusú ajánlattal helyettesíthető.
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Alternatív időpontok (opcionális)
                  </span>
                  <button
                    type="button"
                    onClick={() => setAlternatives((prev) => [...prev, ''])}
                    disabled={submitting || alternatives.length >= MAX_ALTERNATIVES}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Hozzáadás
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Ha a beteg elveti az ajánlatot, automatikusan a következő alternatívát kapja.
                </p>
                {alternatives.map((altId, index) => (
                  <div key={index} className="flex items-center gap-2 mb-2">
                    <select
                      aria-label={`${index + 1}. alternatív időpont`}
                      value={altId}
                      onChange={(e) =>
                        setAlternatives((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))
                      }
                      className="form-input flex-1"
                      disabled={submitting}
                    >
                      <option value="">Válasszon alternatív időpontot…</option>
                      {slotOptions
                        .filter(
                          (slot) =>
                            slot.id === altId ||
                            (slot.id !== selectedSlot && !alternatives.includes(slot.id)),
                        )
                        .map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {slotLabel(slot, defaultCim)}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setAlternatives((prev) => prev.filter((_, i) => i !== index))}
                      className="p-2 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/40 rounded"
                      aria-label="Alternatíva törlése"
                      disabled={submitting}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="text-sm text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-2 rounded"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary">
            Mégse
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || (mode === 'offer' && !selectedSlot)}
            className="btn-primary bg-red-600 hover:bg-red-700 border-red-600 disabled:opacity-50"
          >
            {submitting
              ? 'Folyamatban…'
              : mode === 'offer'
                ? 'Lemondás és ajánlat küldése'
                : 'Lemondás'}
          </button>
        </div>
      </div>
    </div>
  );
}
