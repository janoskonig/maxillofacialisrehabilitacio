'use client';

import { X } from 'lucide-react';
import { EpisodePathwayEditor } from './EpisodePathwayEditor';

export interface EpisodePathwayModalProps {
  open: boolean;
  onClose: () => void;
  episodeId: string;
  patientName?: string | null;
  carePathwayId?: string | null;
  assignedProviderId?: string | null;
  carePathwayName?: string | null;
  assignedProviderName?: string | null;
  /** Async - modal closes only after this completes (e.g. fetchWorklist) */
  onSaved?: () => void | Promise<void>;
}

export function EpisodePathwayModal({
  open,
  onClose,
  episodeId,
  patientName,
  carePathwayId,
  assignedProviderId,
  carePathwayName,
  assignedProviderName,
  onSaved,
}: EpisodePathwayModalProps) {
  const handleSaved = async () => {
    await onSaved?.();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="episode-pathway-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-3 border-b">
          <h2
            id="episode-pathway-modal-title"
            className="text-base font-semibold text-gray-900"
          >
            Kezelési út hozzárendelése
            {patientName && (
              <span className="block text-sm font-normal text-gray-600 mt-0.5">
                {patientName}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1"
            aria-label="Bezárás"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-3">
          <EpisodePathwayEditor
            episodeId={episodeId}
            carePathwayId={carePathwayId}
            assignedProviderId={assignedProviderId}
            carePathwayName={carePathwayName}
            assignedProviderName={assignedProviderName}
            onSaved={handleSaved}
            compact
          />
        </div>
      </div>
    </div>
  );
}
