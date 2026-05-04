'use client';

/**
 * MarkCompletedRetroModal — utólagos teljesítés rögzítése.
 *
 * Akkor használjuk, amikor a felhasználó az „Elkészült (utólag)" gombra
 * kattint a worklist sorában: a munkafázis valójában már elkészült, csak
 * nem itt foglalt időponttal. A modal két opciót kínál:
 *
 *   1. Régebbi foglalt időpont kiválasztása — a beteg múltbeli appointment-jeit
 *      listázzuk, és a kiválasztott időpont start_time-ja lesz a `completed_at`,
 *      a kiválasztott appointment.id pedig az `episode_work_phases.appointment_id`
 *      mezőre kötjük (audit / nyomonkövetés).
 *
 *   2. Egyéni dátum megadása — ha a beteg nem ebben a rendszerben rögzített
 *      időpontban végezte el a fázist (pl. külső praxisban), szabadon
 *      választható dátumot is megadhatunk.
 *
 * A modal NEM hív API-t közvetlenül — a hívó oldal (PatientWorklistWidget)
 * az `onConfirm` callback-en keresztül futtatja a PATCH kérést.
 */

import { useEffect, useState } from 'react';
import { CalendarCheck, X } from 'lucide-react';

const MIN_REASON_LENGTH = 5;
const APPOINTMENTS_LIMIT = 100;

interface PastAppointment {
  id: string;
  startTime: string;
  stepCode: string | null;
  stepLabel: string | null;
  appointmentStatus: string | null;
  dentistEmail: string | null;
  episodeId: string | null;
}

interface AppointmentApiRow {
  id: string;
  startTime: string | null;
  stepCode?: string | null;
  stepLabel?: string | null;
  appointmentStatus?: string | null;
  dentistEmail?: string | null;
  episodeId?: string | null;
}

export interface MarkCompletedRetroPayload {
  completedAt: string;
  appointmentId: string | null;
  reason: string;
}

export interface MarkCompletedRetroModalProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  stepLabel?: string | null;
  /**
   * Appointment id-k, amelyeket NEM kínálunk fel a listában (pl. a fázishoz
   * már hozzárendelt jövőbeli foglalás vagy a már rögzített prior attempt-ek).
   */
  excludeAppointmentIds?: string[];
  onConfirm: (payload: MarkCompletedRetroPayload) => Promise<void> | void;
}

function todayIsoDate(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function MarkCompletedRetroModal({
  open,
  onClose,
  patientId,
  stepLabel,
  excludeAppointmentIds,
  onConfirm,
}: MarkCompletedRetroModalProps) {
  const [appointments, setAppointments] = useState<PastAppointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState<string>(todayIsoDate());
  const [reason, setReason] = useState<string>('Utólag jelölve késznek (nem itt foglalt)');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedAppointmentId(null);
    setCustomDate(todayIsoDate());
    setReason('Utólag jelölve késznek (nem itt foglalt)');
    setSubmitError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !patientId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/appointments?patientId=${encodeURIComponent(patientId)}&limit=${APPOINTMENTS_LIMIT}`,
          { credentials: 'include' }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? 'Nem sikerült lekérni a régebbi időpontokat');
        }
        if (cancelled) return;
        const excludeSet = new Set(excludeAppointmentIds ?? []);
        const now = Date.now();
        const past: PastAppointment[] = (data.appointments as AppointmentApiRow[] | undefined ?? [])
          .filter((row) => row?.startTime && new Date(row.startTime).getTime() < now)
          .filter((row) => !excludeSet.has(row.id))
          .map((row) => ({
            id: row.id,
            startTime: row.startTime as string,
            stepCode: row.stepCode ?? null,
            stepLabel: row.stepLabel ?? null,
            appointmentStatus: row.appointmentStatus ?? null,
            dentistEmail: row.dentistEmail ?? null,
            episodeId: row.episodeId ?? null,
          }))
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
        setAppointments(past);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Hálózati hiba');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patientId, excludeAppointmentIds]);

  if (!open) return null;

  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= MIN_REASON_LENGTH;

  const selectedAppointment = selectedAppointmentId
    ? appointments.find((a) => a.id === selectedAppointmentId) ?? null
    : null;

  const customDateValid = (() => {
    if (selectedAppointment) return true;
    if (!customDate) return false;
    const parsed = new Date(`${customDate}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.getTime() <= Date.now();
  })();

  const canSubmit = reasonValid && customDateValid && !submitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const completedAtISO = selectedAppointment
        ? new Date(selectedAppointment.startTime).toISOString()
        : new Date(`${customDate}T12:00:00`).toISOString();
      await onConfirm({
        completedAt: completedAtISO,
        appointmentId: selectedAppointment?.id ?? null,
        reason: trimmedReason,
      });
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Hiba történt — próbáld újra.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mark-completed-retro-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2
            id="mark-completed-retro-title"
            className="text-lg font-semibold text-gray-900 flex items-center gap-2"
          >
            <CalendarCheck className="w-5 h-5 text-medical-primary" />
            Utólagos teljesítés rögzítése
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
            aria-label="Bezárás"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 p-3 rounded">
            <div className="font-medium text-gray-900">
              {stepLabel ?? 'Munkafázis'}
            </div>
            <div className="text-xs text-gray-600 mt-1">
              Válaszd ki, hogy mikor készült el ténylegesen ez a munkafázis.
              Ha egy korábbi foglalt időpontnál történt, válaszd ki a listából
              — ekkor a fázist ahhoz az időponthoz kötjük. Egyébként adj meg
              egyéni dátumot.
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">
              Régebbi foglalt időpontok
            </div>
            {loading && (
              <div className="text-sm text-gray-500 py-3 text-center">
                Betöltés…
              </div>
            )}
            {loadError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded">
                {loadError}
              </div>
            )}
            {!loading && !loadError && appointments.length === 0 && (
              <div className="text-sm text-gray-500 italic py-2">
                Nincs régebbi foglalt időpont a betegnél — adj meg egyéni
                dátumot lent.
              </div>
            )}
            {!loading && !loadError && appointments.length > 0 && (
              <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {appointments.map((appt) => {
                  const isSelected = selectedAppointmentId === appt.id;
                  return (
                    <label
                      key={appt.id}
                      className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                        isSelected ? 'bg-medical-primary/5' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="retro-appointment"
                        className="mt-1"
                        checked={isSelected}
                        onChange={() => setSelectedAppointmentId(appt.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-900 font-medium">
                          {new Date(appt.startTime).toLocaleString('hu-HU', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div className="text-xs text-gray-600 truncate">
                          {appt.stepLabel ?? appt.stepCode ?? 'Időpont'}
                          {appt.appointmentStatus && (
                            <span className="ml-1 text-gray-500">
                              · {appt.appointmentStatus}
                            </span>
                          )}
                        </div>
                        {appt.dentistEmail && (
                          <div className="text-xs text-gray-500 truncate">
                            {appt.dentistEmail}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Egyéni dátum {selectedAppointment ? '(nem aktív)' : ''}
            </label>
            <input
              type="date"
              value={customDate}
              max={todayIsoDate()}
              onChange={(e) => {
                setCustomDate(e.target.value);
                if (selectedAppointmentId) setSelectedAppointmentId(null);
              }}
              disabled={!!selectedAppointment}
              className="form-input w-full disabled:bg-gray-100 disabled:text-gray-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Csak múltbeli vagy mai dátum választható.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Indok (min {MIN_REASON_LENGTH} karakter) *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="form-input w-full"
              rows={2}
              maxLength={500}
              placeholder="Pl. Külső praxisban végeztük el…"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>
                {trimmedReason.length < MIN_REASON_LENGTH
                  ? `Még ${MIN_REASON_LENGTH - trimmedReason.length} karakter szükséges`
                  : `${trimmedReason.length} karakter`}
              </span>
              <span>{trimmedReason.length}/500</span>
            </div>
          </div>

          {submitError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded">
              {submitError}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button
            onClick={onClose}
            className="btn-secondary"
            disabled={submitting}
            type="button"
          >
            Mégse
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
          >
            {submitting ? 'Mentés…' : 'Rögzítés'}
          </button>
        </div>
      </div>
    </div>
  );
}
