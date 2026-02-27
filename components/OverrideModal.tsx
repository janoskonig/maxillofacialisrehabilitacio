'use client';

import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

const OVERRIDE_CATEGORIES = [
  { value: 'patient_preference', label: 'Beteg preferencia' },
  { value: 'clinical', label: 'Klinikai indok' },
  { value: 'capacity', label: 'Kapacitás' },
  { value: 'urgent', label: 'Sürgős' },
  { value: 'other', label: 'Egyéb' },
] as const;

const QUICK_REASONS = [
  'Beteg kérésére korábbi időpont',
  'Klinikai indok – gyógyulás várása',
  'Kapacitás átrendezés',
  'Sürgős eset',
];

export interface OverrideModalProps {
  open: boolean;
  onClose: () => void;
  /** 409 payload */
  error: string;
  overrideHint?: string;
  expectedHardNext?: {
    stepCode: string;
    earliestStart: string;
    latestStart: string;
    durationMinutes: number;
  };
  existingAppointment?: {
    id: string;
    startTime: string;
    providerName?: string;
  };
  /** Retry with overrideReason. Format: "[{category}] {reason}" */
  onConfirm: (overrideReason: string) => void | Promise<void>;
}

export function OverrideModal({
  open,
  onClose,
  error,
  overrideHint,
  expectedHardNext,
  existingAppointment,
  onConfirm,
}: OverrideModalProps) {
  const [category, setCategory] = useState<string>('');
  const [reason, setReason] = useState('');

  const overrideReasonFinal = category && reason.trim().length >= 10
    ? `[${category}] ${reason.trim()}`
    : '';

  const isValid = !!category && reason.trim().length >= 10;

  const handleConfirm = async () => {
    if (!isValid) return;
    await onConfirm(overrideReasonFinal);
    onClose();
    setCategory('');
    setReason('');
  };

  const handleQuickReason = (text: string) => {
    setReason(text);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" role="dialog" aria-modal="true" aria-labelledby="override-modal-title">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 id="override-modal-title" className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Override szükséges
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-1" aria-label="Bezárás">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-700">{error}</p>
          {overrideHint && (
            <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">{overrideHint}</p>
          )}

          {existingAppointment && (
            <div className="text-sm text-gray-600 bg-amber-50 p-2 rounded">
              <span className="font-medium">Jelenlegi foglalás:</span>{' '}
              {new Date(existingAppointment.startTime).toLocaleString('hu-HU')}
              {existingAppointment.providerName && ` – ${existingAppointment.providerName}`}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Kategória *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="form-input w-full"
            >
              <option value="">Válassz…</option>
              {OVERRIDE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Indoklás (min 10 karakter) *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="form-input w-full"
              rows={3}
              placeholder="Rövid indoklás az override-hoz…"
              maxLength={500}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleQuickReason(r)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="btn-secondary">
            Mégse
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isValid}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Override és újrafoglalás
          </button>
        </div>
      </div>
    </div>
  );
}
