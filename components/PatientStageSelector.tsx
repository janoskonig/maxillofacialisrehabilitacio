'use client';

import { useState } from 'react';
import { PatientStage, PatientStageEntry, patientStageOptions } from '@/lib/types';
import { useToast } from '@/contexts/ToastContext';
import { Save, Loader2 } from 'lucide-react';

interface PatientStageSelectorProps {
  patientId: string;
  currentStage: PatientStageEntry | null;
  onStageChanged?: () => void;
}

export function PatientStageSelector({
  patientId,
  currentStage,
  onStageChanged,
}: PatientStageSelectorProps) {
  const { showToast } = useToast();
  const [selectedStage, setSelectedStage] = useState<PatientStage>(
    currentStage?.stage || 'uj_beteg'
  );
  const [notes, setNotes] = useState<string>('');
  const [startNewEpisode, setStartNewEpisode] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selectedStage) {
      showToast('Kérjük, válasszon stádiumot', 'error');
      return;
    }

    try {
      setSaving(true);

      const endpoint = startNewEpisode
        ? `/api/patients/${patientId}/stages/new-episode`
        : `/api/patients/${patientId}/stages`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          stage: selectedStage,
          notes: notes.trim() || null,
          startNewEpisode: startNewEpisode && !startNewEpisode ? undefined : startNewEpisode,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Hiba történt a stádium mentésekor');
      }

      const data = await response.json();
      showToast(
        startNewEpisode
          ? 'Új epizód sikeresen elindítva'
          : 'Stádium sikeresen frissítve',
        'success'
      );

      // Reset form
      setNotes('');
      setStartNewEpisode(false);

      // Callback
      if (onStageChanged) {
        onStageChanged();
      }
    } catch (error) {
      console.error('Error saving stage:', error);
      showToast(
        error instanceof Error ? error.message : 'Hiba történt a stádium mentésekor',
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Stádium változtatása
      </h3>

      {currentStage && (
        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-sm text-gray-600 mb-1">Jelenlegi stádium:</p>
          <p className="text-base font-medium text-gray-900">
            {patientStageOptions.find((opt) => opt.value === currentStage.stage)?.label ||
              currentStage.stage}
          </p>
          {currentStage.stageDate && (
            <p className="text-xs text-gray-500 mt-1">
              {new Date(currentStage.stageDate).toLocaleDateString('hu-HU', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label
            htmlFor="stage-select"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Új stádium
          </label>
          <select
            id="stage-select"
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value as PatientStage)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-medical-primary focus:border-medical-primary"
            disabled={saving}
          >
            {patientStageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="stage-notes"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Megjegyzések (opcionális)
          </label>
          <textarea
            id="stage-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-medical-primary focus:border-medical-primary"
            placeholder="Stádium változás indoklása..."
            disabled={saving}
          />
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="new-episode"
            checked={startNewEpisode}
            onChange={(e) => setStartNewEpisode(e.target.checked)}
            className="h-4 w-4 text-medical-primary focus:ring-medical-primary border-gray-300 rounded"
            disabled={saving}
          />
          <label
            htmlFor="new-episode"
            className="ml-2 block text-sm text-gray-700"
          >
            Új kezelési epizód indítása (új episode_id generálása)
          </label>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mentés...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Mentés</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
