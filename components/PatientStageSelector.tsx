'use client';

import { useState, useEffect } from 'react';
import { PatientStage, PatientStageEntry, patientStageOptions } from '@/lib/types';
import type { StageCatalogEntry, StageEventEntry } from '@/lib/types';
import { useToast } from '@/contexts/ToastContext';
import { Save, Loader2 } from 'lucide-react';

interface PatientStageSelectorProps {
  patientId: string;
  currentStage: PatientStageEntry | StageEventEntry | null;
  onStageChanged?: () => void;
  /** Új modell: aktív epizód ID (csak ehhez lehet stádiumot rögzíteni) */
  activeEpisodeId?: string | null;
  /** Új modell: etiológia a katalógus szűréshez */
  reason?: string | null;
  /** true = stage_events + stage_catalog, false = patient_stages */
  useNewModel?: boolean;
}

export function PatientStageSelector({
  patientId,
  currentStage,
  onStageChanged,
  activeEpisodeId,
  reason,
  useNewModel,
}: PatientStageSelectorProps) {
  const { showToast } = useToast();
  const legacyStage = currentStage && 'stage' in currentStage ? (currentStage as PatientStageEntry).stage : undefined;
  const newStageCode = currentStage && 'stageCode' in currentStage ? (currentStage as StageEventEntry).stageCode : undefined;

  const [selectedStage, setSelectedStage] = useState<PatientStage>(legacyStage || 'uj_beteg');
  const [selectedStageCode, setSelectedStageCode] = useState<string>(newStageCode || 'STAGE_0');
  const [catalog, setCatalog] = useState<StageCatalogEntry[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [startNewEpisode, setStartNewEpisode] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (useNewModel && reason) {
      fetch(`/api/stage-catalog?reason=${encodeURIComponent(reason)}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((data) => setCatalog(data.catalog || []))
        .catch(() => setCatalog([]));
    }
  }, [useNewModel, reason]);

  useEffect(() => {
    if (newStageCode) setSelectedStageCode(newStageCode);
    if (legacyStage) setSelectedStage(legacyStage);
  }, [newStageCode, legacyStage]);

  const handleSave = async () => {
    if (useNewModel && activeEpisodeId) {
      if (!selectedStageCode) {
        showToast('Kérjük, válasszon stádiumot', 'error');
        return;
      }
      try {
        setSaving(true);
        const response = await fetch(`/api/patients/${patientId}/stages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            episodeId: activeEpisodeId,
            stageCode: selectedStageCode,
            note: note.trim() || null,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Hiba a stádium mentésekor');
        showToast('Stádium sikeresen frissítve', 'success');
        setNote('');
        onStageChanged?.();
      } catch (error) {
        console.error('Error saving stage:', error);
        showToast(error instanceof Error ? error.message : 'Hiba a stádium mentésekor', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

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
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          stage: selectedStage,
          notes: notes.trim() || null,
          startNewEpisode: startNewEpisode ? true : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Hiba történt a stádium mentésekor');

      showToast(
        startNewEpisode ? 'Új epizód sikeresen elindítva' : 'Stádium sikeresen frissítve',
        'success'
      );
      setNotes('');
      setStartNewEpisode(false);
      onStageChanged?.();
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

  const currentStageLabel = useNewModel && newStageCode
    ? (catalog.find((c) => c.code === newStageCode)?.labelHu ?? newStageCode)
    : legacyStage
      ? (patientStageOptions.find((opt) => opt.value === legacyStage)?.label ?? legacyStage)
      : null;

  const currentStageDate = currentStage && ('stageDate' in currentStage ? currentStage.stageDate : 'at' in currentStage ? currentStage.at : null);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Stádium változtatása
      </h3>

      {useNewModel && !activeEpisodeId && (
        <p className="mb-4 text-sm text-amber-700 bg-amber-50 p-3 rounded-md">
          Nincs aktív epizód. Indítson új ellátási epizódot a stádium rögzítéséhez.
        </p>
      )}

      {currentStage && currentStageLabel && (
        <div className="mb-4 p-3 bg-gray-50 rounded-md">
          <p className="text-sm text-gray-600 mb-1">Jelenlegi stádium:</p>
          <p className="text-base font-medium text-gray-900">{currentStageLabel}</p>
          {currentStageDate && (
            <p className="text-xs text-gray-500 mt-1">
              {new Date(currentStageDate).toLocaleDateString('hu-HU', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
          {'note' in currentStage && currentStage.note && (
            <p className="text-sm text-gray-600 mt-1">{currentStage.note}</p>
          )}
          {'notes' in currentStage && currentStage.notes && (
            <p className="text-sm text-gray-600 mt-1">{currentStage.notes}</p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {useNewModel && catalog.length > 0 ? (
          <div>
            <label htmlFor="stage-select" className="block text-sm font-medium text-gray-700 mb-2">
              Új stádium
            </label>
            <select
              id="stage-select"
              value={selectedStageCode}
              onChange={(e) => setSelectedStageCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-medical-primary focus:border-medical-primary"
              disabled={saving || !activeEpisodeId}
            >
              {catalog.map((c) => (
                <option key={c.code} value={c.code}>{c.labelHu}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label htmlFor="stage-select" className="block text-sm font-medium text-gray-700 mb-2">
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
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="stage-notes" className="block text-sm font-medium text-gray-700 mb-2">
            Megjegyzések (opcionális)
          </label>
          <textarea
            id="stage-notes"
            value={useNewModel ? note : notes}
            onChange={(e) => (useNewModel ? setNote(e.target.value) : setNotes(e.target.value))}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-medical-primary focus:border-medical-primary"
            placeholder="Stádium változás indoklása..."
            disabled={saving}
          />
        </div>

        {!useNewModel && (
          <div className="flex items-center">
            <input
              type="checkbox"
              id="new-episode"
              checked={startNewEpisode}
              onChange={(e) => setStartNewEpisode(e.target.checked)}
              className="h-4 w-4 text-medical-primary focus:ring-medical-primary border-gray-300 rounded"
              disabled={saving}
            />
            <label htmlFor="new-episode" className="ml-2 block text-sm text-gray-700">
              Új kezelési epizód indítása (új episode_id generálása)
            </label>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || (useNewModel && !activeEpisodeId)}
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
