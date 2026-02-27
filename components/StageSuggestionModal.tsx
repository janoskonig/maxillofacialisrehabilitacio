'use client';

import { useState } from 'react';
import type { StageSuggestion } from '@/lib/types';
import { CheckCircle, X, Loader2, Clock, ArrowRight } from 'lucide-react';

interface StageSuggestionModalProps {
  episodeId: string;
  suggestion: StageSuggestion;
  stageLabel: string;
  fromStageLabel?: string;
  stageVersion: number;
  onAccepted: () => void;
  onDismissed: () => void;
  onClose: () => void;
}

export function StageSuggestionModal({
  episodeId,
  suggestion,
  stageLabel,
  fromStageLabel,
  stageVersion,
  onAccepted,
  onDismissed,
  onClose,
}: StageSuggestionModalProps) {
  const [accepting, setAccepting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          stageCode: suggestion.suggestedStage,
          note: note.trim() || undefined,
          expectedStageVersion: stageVersion,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 409) {
          setError('Egy másik felhasználó módosította a stádiumot. Kérjük, frissítse az oldalt.');
        } else {
          setError(data.error || 'Hiba történt');
        }
        return;
      }

      onAccepted();
    } catch (err) {
      setError('Hálózati hiba történt');
    } finally {
      setAccepting(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/suggestions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          dedupeKey: suggestion.dedupeKey,
          ttlDays: 14,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Hiba történt');
        return;
      }

      onDismissed();
    } catch (err) {
      setError('Hálózati hiba történt');
    } finally {
      setDismissing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">Stádium javaslat</h3>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Transition visualization */}
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-center gap-3">
              {fromStageLabel && (
                <>
                  <span className="text-sm text-gray-600 font-medium">{fromStageLabel}</span>
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                </>
              )}
              <span className="text-sm font-bold text-blue-700 bg-blue-100 px-3 py-1 rounded-full">
                {stageLabel}
              </span>
            </div>
          </div>

          {/* Rule info */}
          <div className="mb-4 text-sm text-gray-600">
            <p>
              A rendszer javasolja a stádium módosítását az alábbi szabályok alapján:
            </p>
            {suggestion.ruleIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {suggestion.ruleIds.map((ruleId) => (
                  <span
                    key={ruleId}
                    className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-500"
                  >
                    {ruleId}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
              <Clock className="w-3 h-3" />
              <span>
                Számítva: {new Date(suggestion.computedAt).toLocaleString('hu-HU')}
              </span>
            </div>
          </div>

          {/* Note field */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Megjegyzés (opcionális)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="pl. Konzultáció alapján..."
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-medical-primary focus:border-transparent"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleAccept}
              disabled={accepting || dismissing}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-medical-primary text-white rounded-md font-medium hover:bg-medical-primary-dark disabled:opacity-50 transition-colors text-sm"
            >
              {accepting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Elfogadás
            </button>
            <button
              onClick={handleDismiss}
              disabled={accepting || dismissing}
              className="px-4 py-2.5 border border-gray-300 rounded-md font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm"
            >
              {dismissing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Később'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
