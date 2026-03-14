'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { formatDateTime } from '@/lib/dateUtils';

export interface SlotIntentForCascade {
  id: string;
  stepCode: string;
  stepSeq: number;
  suggestedStart: string | null;
  suggestedEnd: string | null;
  durationMinutes?: number;
  pool?: string;
}

export interface CascadeIntentsModalProps {
  open: boolean;
  onClose: () => void;
  episodeId: string;
  /** Delta in milliseconds (new - old) */
  deltaMs: number;
  /** Subsequent intents (step_seq > moved appointment's step_seq) */
  intents: SlotIntentForCascade[];
  onConfirm: (selectedIntentIds: string[]) => Promise<void>;
}

function formatDelta(deltaMs: number): string {
  const sign = deltaMs >= 0 ? '+' : '-';
  const abs = Math.abs(deltaMs);
  const days = Math.floor(abs / (24 * 60 * 60 * 1000));
  const rest = abs % (24 * 60 * 60 * 1000);
  const hours = Math.floor(rest / (60 * 60 * 1000));
  const mins = Math.floor((rest % (60 * 60 * 1000)) / (60 * 1000));
  const parts: string[] = [];
  if (days) parts.push(`${days} nap`);
  if (hours) parts.push(`${hours} óra`);
  if (mins || parts.length === 0) parts.push(`${mins} perc`);
  return `${sign} ${parts.join(' ')}`;
}

export function CascadeIntentsModal({
  open,
  onClose,
  episodeId,
  deltaMs,
  intents,
  onConfirm,
}: CascadeIntentsModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && intents.length > 0) {
      setSelected(new Set(intents.map((i) => i.id)));
    }
  }, [open, intents]);

  const handleToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      onClose();
      return;
    }
    setLoading(true);
    try {
      await onConfirm(ids);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" role="dialog" aria-modal="true" aria-labelledby="cascade-intents-title">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 id="cascade-intents-title" className="text-lg font-semibold text-gray-900">
            Tervezett lépések eltolása
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-1" aria-label="Bezárás">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          <p className="text-sm text-gray-600 mb-3">
            Az időpontot {formatDelta(deltaMs)} eltoltad. A következő tervezett lépések (még nem fix) időpontjait is eltoljam ugyanannyival?
          </p>
          <ul className="space-y-2">
            {intents.map((intent) => (
              <li key={intent.id} className="flex items-center gap-3 p-2 rounded border border-gray-200 hover:bg-gray-50">
                <input
                  type="checkbox"
                  id={`cascade-${intent.id}`}
                  checked={selected.has(intent.id)}
                  onChange={() => handleToggle(intent.id)}
                  className="rounded border-gray-300 text-medical-primary focus:ring-medical-primary"
                />
                <label htmlFor={`cascade-${intent.id}`} className="flex-1 cursor-pointer text-sm">
                  <span className="font-medium text-gray-700">{intent.stepCode}</span>
                  {intent.suggestedStart && (
                    <span className="text-gray-500 ml-2">
                      {formatDateTime(intent.suggestedStart)}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex gap-2 justify-end p-4 border-t bg-gray-50">
          <button type="button" onClick={onClose} className="btn-secondary">
            Nem
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || selected.size === 0}
            className="btn-primary"
          >
            {loading ? 'Eltolás...' : `Eltolás (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
