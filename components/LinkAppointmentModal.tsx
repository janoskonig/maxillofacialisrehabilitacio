'use client';

import { useEffect, useState } from 'react';
import { Link2, X } from 'lucide-react';
import type { WorklistItemBackend } from '@/lib/worklist-types';

const MIN_REASON_LENGTH = 5;

export interface UnlinkedAppointmentOption {
  id: string;
  startTime: string;
  dentistEmail: string | null;
  stepCode: string | null;
  episodeId: string | null;
  isPatientPortal: boolean;
  pool: string;
}

export interface LinkAppointmentModalProps {
  open: boolean;
  onClose: () => void;
  item: WorklistItemBackend;
  onConfirm: (appointmentId: string, reason: string) => Promise<void>;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('hu-HU', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LinkAppointmentModal({
  open,
  onClose,
  item,
  onConfirm,
}: LinkAppointmentModalProps) {
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<UnlinkedAppointmentOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item.episodeId || !item.workPhaseId) return;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setReason('');
    fetch(
      `/api/episodes/${item.episodeId}/unlinked-appointments?targetWorkPhaseId=${encodeURIComponent(item.workPhaseId)}`,
      { credentials: 'include' }
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Betöltési hiba');
        setOptions(data.appointments ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Hiba'))
      .finally(() => setLoading(false));
  }, [open, item.episodeId, item.workPhaseId]);

  if (!open) return null;

  const stepLabel = item.stepLabel ?? item.nextStep ?? 'Munkafázis';
  const canSubmit =
    !!selectedId && reason.trim().length >= MIN_REASON_LENGTH && !submitting;

  const handleSubmit = async () => {
    if (!selectedId || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(selectedId, reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hozzárendelés sikertelen');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-labelledby="link-appointment-title"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="link-appointment-title" className="text-lg font-semibold flex items-center gap-2">
            <Link2 className="w-5 h-5 text-medical-primary" />
            Meglévő foglalás hozzárendelése
          </h2>
          <button type="button" onClick={onClose} className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 text-sm">
          <p className="text-gray-700 dark:text-gray-300">
            Válaszd ki a jövőbeli időpontot, amelyet a következő munkafázishoz szeretnél kötni:{' '}
            <strong>{stepLabel}</strong>
          </p>

          {loading && <p className="text-gray-500 dark:text-gray-400">Foglalások betöltése…</p>}
          {!loading && options.length === 0 && (
            <p className="text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded px-3 py-2">
              Nincs hozzárendelhető jövőbeli foglalás (pl. páciens portálon foglalt konzultáció vagy más
              epizód).
            </p>
          )}
          {!loading && options.length > 0 && (
            <ul className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
              {options.map((opt) => (
                <li key={opt.id}>
                  <label className="flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <input
                      type="radio"
                      name="unlinked-appt"
                      checked={selectedId === opt.id}
                      onChange={() => setSelectedId(opt.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{formatDateTime(opt.startTime)}</span>
                      {opt.dentistEmail && (
                        <span className="text-gray-500 dark:text-gray-400 ml-1">· {opt.dentistEmail}</span>
                      )}
                      {opt.isPatientPortal && (
                        <span className="ml-1 text-xs text-blue-700 dark:text-blue-300">(páciens portál)</span>
                      )}
                      {opt.stepCode && (
                        <span className="block text-xs text-gray-500 dark:text-gray-400">Jelenlegi lépés: {opt.stepCode}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div>
            <label htmlFor="link-reason" className="block text-gray-700 dark:text-gray-300 font-medium mb-1">
              Indoklás (min. {MIN_REASON_LENGTH} karakter)
            </label>
            <textarea
              id="link-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full border rounded px-2 py-1.5 text-sm"
              placeholder="pl. beteg magának foglalt, első konzultációként"
            />
          </div>

          {error && <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            Mégse
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="px-3 py-1.5 text-sm bg-medical-primary text-white rounded disabled:opacity-50"
          >
            {submitting ? 'Mentés…' : 'Hozzárendelés'}
          </button>
        </div>
      </div>
    </div>
  );
}
