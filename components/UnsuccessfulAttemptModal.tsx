'use client';

/**
 * UnsuccessfulAttemptModal — appointment sikertelennek jelölése.
 *
 * Migration 029 + PR 2 (UI). A modal:
 *   • Quick-chip-eket kínál a leggyakoribb okokra (gyors kitöltés, de mindig
 *     szabad szöveg is megy — az orvos átírhatja).
 *   • Indok kötelező (≥5 karakter) — a backend `attempt_outcome` endpoint is
 *     ezt érvényesíti, későbbi klinikai elemzéshez.
 *   • Checkbox: „Következő próba foglalása most" (default: bekapcsolva).
 *     Ha be van pipálva, a hívó a `onConfirmed` callback-jén keresztül
 *     azonnal megnyitja a SlotPickert a következő (most pending-be visszament)
 *     fázishoz.
 *
 * A modal NEM hív API-t közvetlenül — `onConfirmed`-en keresztül a hívó
 * oldal kontrollálja a fetch-et és az UI flow-t (worklist refresh +
 * SlotPicker chain-elés).
 */

import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { UNSUCCESSFUL_REASON_TEMPLATES } from '@/lib/unsuccessful-attempt-templates';

const QUICK_REASONS = UNSUCCESSFUL_REASON_TEMPLATES;

const MIN_REASON_LENGTH = 5;

export interface UnsuccessfulAttemptConfirmPayload {
  reason: string;
  shouldOpenSlotPicker: boolean;
}

export interface UnsuccessfulAttemptModalProps {
  open: boolean;
  onClose: () => void;
  /** A `bookedAppointmentId` vagy `currentAppointmentId` — csak megjelenítéshez. */
  appointmentId: string;
  /** Az időpont kezdete (megjelenítéshez), ha ismert. ISO string. */
  appointmentStart?: string | null;
  /** A munkafázis emberi neve, pl. „Lenyomatvétel". */
  stepLabel?: string | null;
  /** Hányadik próba ez a sorban — csak megjelenítéshez. */
  attemptNumber?: number | null;
  /** Hívó oldal végzi a backend hívást + UI frissítést. */
  onConfirmed: (payload: UnsuccessfulAttemptConfirmPayload) => Promise<void> | void;
}

export function UnsuccessfulAttemptModal({
  open,
  onClose,
  appointmentId,
  appointmentStart,
  stepLabel,
  attemptNumber,
  onConfirmed,
}: UnsuccessfulAttemptModalProps) {
  const [reason, setReason] = useState('');
  const [openNextPicker, setOpenNextPicker] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();
  const isValid = trimmed.length >= MIN_REASON_LENGTH;

  const handleQuickReason = (text: string) => {
    setReason(text);
  };

  const handleConfirm = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirmed({ reason: trimmed, shouldOpenSlotPicker: openNextPicker });
      setReason('');
      setOpenNextPicker(true);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba történt — próbáld újra.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsuccessful-modal-title"
    >
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2
            id="unsuccessful-modal-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2"
          >
            <AlertTriangle className="w-5 h-5 text-orange-500 dark:text-orange-400" />
            Sikertelen próba — ismétlés szükséges
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1"
            aria-label="Bezárás"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-700 dark:text-gray-300 bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 p-3 rounded">
            <div className="font-medium text-orange-900 dark:text-orange-200 mb-1">
              Mit jelentesz sikertelennek?
            </div>
            <div className="text-orange-900/90">
              {stepLabel ?? 'Munkafázis'}
              {attemptNumber != null && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300 align-middle">
                  {attemptNumber}. próba
                </span>
              )}
            </div>
            {appointmentStart && (
              <div className="text-xs text-orange-800 dark:text-orange-300 mt-1">
                Időpont: {new Date(appointmentStart).toLocaleString('hu-HU', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            )}
            <div className="text-xs text-orange-800 dark:text-orange-300 mt-1 font-mono opacity-70 break-all">
              ID: {appointmentId}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Indok (min {MIN_REASON_LENGTH} karakter) *
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleQuickReason(r)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="form-input w-full"
              rows={3}
              placeholder="Pl. Lenyomat alsó molárisnál torzult, beteg öklendezett. Új lenyomat kell."
              maxLength={500}
              autoFocus
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>
                {trimmed.length < MIN_REASON_LENGTH
                  ? `Még ${MIN_REASON_LENGTH - trimmed.length} karakter szükséges`
                  : `${trimmed.length} karakter`}
              </span>
              <span>{trimmed.length}/500</span>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={openNextPicker}
              onChange={(e) => setOpenNextPicker(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Következő próba foglalása most</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                A jelölés után azonnal megnyílik az időpont-választó az új próbához.
              </span>
            </span>
          </label>

          {error && (
            <div className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-2 rounded">
              {error}
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
            disabled={!isValid || submitting}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
          >
            {submitting ? 'Mentés…' : 'Sikertelen — ismétlés kérése'}
          </button>
        </div>
      </div>
    </div>
  );
}
