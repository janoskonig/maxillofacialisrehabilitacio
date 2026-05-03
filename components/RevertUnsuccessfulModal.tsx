'use client';

/**
 * RevertUnsuccessfulModal — sikertelen-jelölés visszavonása.
 *
 * Migration 029 + PR 2. Ha az orvos tévedésből jelölt egy próbát
 * sikertelennek (vagy mégis kiderült, hogy értékelhető), ezzel a
 * modallal vissza tudja vonni — az appointment visszamegy NULL (pending)
 * állapotba, az audit mezők törlődnek, de az audit log megmarad
 * (`appointment_status_events` + `episode_work_phase_audit`).
 *
 * Az indok itt is kötelező — egyrészt audit, másrészt érdekes adat
 * (mennyiszer szoktunk tévedni a sikertelen-jelölésnél).
 */

import { useState } from 'react';
import { X, Undo2 } from 'lucide-react';

const MIN_REASON_LENGTH = 5;

export interface RevertUnsuccessfulModalProps {
  open: boolean;
  onClose: () => void;
  appointmentId: string;
  appointmentStart?: string | null;
  stepLabel?: string | null;
  attemptNumber?: number | null;
  /** Eredeti sikertelenség-indok megjelenítéshez (mit vonunk vissza). */
  originalFailedReason?: string | null;
  onConfirmed: (reason: string) => Promise<void> | void;
}

export function RevertUnsuccessfulModal({
  open,
  onClose,
  appointmentId,
  appointmentStart,
  stepLabel,
  attemptNumber,
  originalFailedReason,
  onConfirmed,
}: RevertUnsuccessfulModalProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();
  const isValid = trimmed.length >= MIN_REASON_LENGTH;

  const handleConfirm = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirmed(trimmed);
      setReason('');
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
      aria-labelledby="revert-unsuccessful-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2
            id="revert-unsuccessful-modal-title"
            className="text-lg font-semibold text-gray-900 flex items-center gap-2"
          >
            <Undo2 className="w-5 h-5 text-gray-600" />
            Sikertelen-jelölés visszavonása
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

        <div className="p-4 space-y-3">
          <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 p-3 rounded">
            <div className="font-medium text-gray-900">
              {stepLabel ?? 'Munkafázis'}
              {attemptNumber != null && (
                <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 align-middle">
                  {attemptNumber}. próba
                </span>
              )}
            </div>
            {appointmentStart && (
              <div className="text-xs text-gray-600 mt-1">
                {new Date(appointmentStart).toLocaleString('hu-HU', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            )}
            {originalFailedReason && (
              <div className="text-xs text-gray-700 mt-2 italic">
                Eredeti indok: „{originalFailedReason}"
              </div>
            )}
            <div className="text-xs text-gray-500 mt-1 font-mono opacity-70 break-all">
              ID: {appointmentId}
            </div>
          </div>

          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-2 rounded">
            A visszavonás után a próba újra <strong>pending</strong> állapotba
            kerül; ha közben már lefoglaltad a következő próbát, a sorszámok
            ahhoz képest értelmeződnek (újrahúzza a worklist a frissítés után).
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Indok (min {MIN_REASON_LENGTH} karakter) *
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="form-input w-full"
              rows={3}
              placeholder="Pl. Tévedésből jelöltem sikertelennek — a lenyomat mégis értékelhető."
              maxLength={500}
              autoFocus
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>
                {trimmed.length < MIN_REASON_LENGTH
                  ? `Még ${MIN_REASON_LENGTH - trimmed.length} karakter szükséges`
                  : `${trimmed.length} karakter`}
              </span>
              <span>{trimmed.length}/500</span>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded">
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
            {submitting ? 'Visszavonás…' : 'Visszavonás'}
          </button>
        </div>
      </div>
    </div>
  );
}
