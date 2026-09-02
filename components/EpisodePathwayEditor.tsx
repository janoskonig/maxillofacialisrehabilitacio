'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { extractSuggestedTreatmentTypeCodes } from '@/lib/treatment-type-normalize';

/**
 * Kezelési terv sablon szerkesztő — CSAK a sablonok (kezelési utak) és az
 * állcsont-hozzárendelés. A felelős orvos innen kikerült: az epizód
 * elsőrendű tulajdonsága, a terv-kártya fejlécében váltható
 * (EpisodeProviderControl), a sablontól függetlenül.
 */
export interface EpisodePathwayEditorProps {
  episodeId: string;
  patientId?: string | null;
  carePathwayId?: string | null;
  carePathwayName?: string | null;
  treatmentTypeId?: string | null;
  onSaved?: () => void | Promise<void>;
  compact?: boolean;
}

interface PathwayOption {
  id: string;
  name: string;
  treatmentTypeCode?: string | null;
  treatmentTypeId?: string | null;
  reason?: string | null;
}

interface EpisodePathwayRow {
  id: string;
  carePathwayId: string;
  ordinal: number;
  pathwayName: string;
  stepCount: number;
  workPhaseCount?: number;
  jaw?: 'felso' | 'also' | null;
}

const JAW_LABELS: Record<string, string> = {
  felso: 'Felső állcsont',
  also: 'Alsó állcsont',
};

export function EpisodePathwayEditor({
  episodeId,
  patientId,
  carePathwayId,
  treatmentTypeId: initialTreatmentTypeId,
  onSaved,
  compact = false,
}: EpisodePathwayEditorProps) {
  const { showToast } = useToast();
  const [pathways, setPathways] = useState<PathwayOption[]>([]);
  const [suggestedTreatmentTypeCodes, setSuggestedTreatmentTypeCodes] = useState<string[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Multi-pathway state
  const [episodePathways, setEpisodePathways] = useState<EpisodePathwayRow[]>([]);
  const [addingPathway, setAddingPathway] = useState(false);
  const [newPathwayId, setNewPathwayId] = useState('');
  const [newJaw, setNewJaw] = useState<'felso' | 'also'>('felso');
  const [removingPathwayId, setRemovingPathwayId] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    setError(null);
    try {
      const [pathwaysRes, patientRes, episodeRes] = await Promise.all([
        fetch('/api/care-pathways', { credentials: 'include' }),
        patientId ? fetch(`/api/patients/${patientId}`, { credentials: 'include' }) : Promise.resolve(null),
        fetch(`/api/episodes/${episodeId}`, { credentials: 'include' }),
      ]);
      if (!pathwaysRes.ok) {
        throw new Error('Nem sikerült betölteni az adatokat');
      }
      const pathwaysData = await pathwaysRes.json();
      const allPathways = (pathwaysData.pathways ?? []).map((p: { id: string; name: string; treatmentTypeCode?: string | null; treatmentTypeId?: string | null; reason?: string | null }) => ({
        id: p.id,
        name: p.name,
        treatmentTypeCode: p.treatmentTypeCode ?? null,
        treatmentTypeId: p.treatmentTypeId ?? null,
        reason: p.reason ?? null,
      }));
      setPathways(allPathways.filter((p: PathwayOption) => p.treatmentTypeId != null));
      if (patientRes?.ok) {
        const patientData = await patientRes.json();
        const patient = patientData.patient;
        const suggested = extractSuggestedTreatmentTypeCodes(
          patient?.kezelesiTervFelso,
          patient?.kezelesiTervAlso
        );
        setSuggestedTreatmentTypeCodes(suggested);
      } else {
        setSuggestedTreatmentTypeCodes([]);
      }
      if (episodeRes.ok) {
        const episodeData = await episodeRes.json();
        const ep = episodeData.episode;
        setEpisodePathways(ep?.episodePathways ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba történt');
      showToast('Nem sikerült betölteni a sablonokat', 'error');
    } finally {
      setLoadingLists(false);
    }
  }, [showToast, patientId, episodeId]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const handleAddPathway = async () => {
    if (!newPathwayId || addingPathway) return;
    setAddingPathway(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'addPathway', carePathwayId: newPathwayId, jaw: newJaw }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Hiba a sablon alkalmazásakor');
      }
      setEpisodePathways(data.episodePathways ?? []);
      setNewPathwayId('');
      showToast('Sablon alkalmazva', 'success');
      await onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setAddingPathway(false);
    }
  };

  /**
   * Sablon eltávolítása. Ha a sablonból már van foglalt vagy teljesített
   * munkafázis, a szerver 409 + PATHWAY_HAS_ACTIVE_PHASES-szel válaszol —
   * ilyenkor megerősítés után `force`-szal ismételjük, és a foglalások
   * lemondásra kerülnek.
   */
  const handleRemovePathway = async (epPathwayId: string, force = false) => {
    if (removingPathwayId) return;
    setRemovingPathwayId(epPathwayId);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'removePathway', episodePathwayId: epPathwayId, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.code === 'PATHWAY_HAS_ACTIVE_PHASES' && !force) {
          const parts: string[] = [];
          if (data.scheduledCount > 0) parts.push(`${data.scheduledCount} foglalt`);
          if (data.completedCount > 0) parts.push(`${data.completedCount} teljesített`);
          const confirmed = window.confirm(
            `Ennek a sablonnak ${parts.join(' és ')} munkafázisa van.\n\n` +
              'Eltávolítja mindenestül? A foglalt időpontok lemondásra kerülnek, a teljesített fázisok pedig kikerülnek a tervből. A művelet nem vonható vissza.'
          );
          setRemovingPathwayId(null);
          if (confirmed) await handleRemovePathway(epPathwayId, true);
          return;
        }
        throw new Error(data.error ?? 'Hiba a sablon eltávolításakor');
      }
      setEpisodePathways(data.episodePathways ?? []);
      showToast('Sablon eltávolítva', 'success');
      await onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setRemovingPathwayId(null);
    }
  };

  // Pathways already assigned — a pathway is still available if it hasn't been added for the currently selected jaw
  const assignedKeys = new Set(episodePathways.map((ep) => `${ep.carePathwayId}:${ep.jaw ?? '_none_'}`));
  const availablePathways = pathways.filter((p) => !assignedKeys.has(`${p.id}:${newJaw}`));

  if (loadingLists) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Betöltés…</span>
        </div>
      </div>
    );
  }

  if (error && episodePathways.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
        <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        <button
          onClick={loadLists}
          className="mt-2 text-sm text-medical-primary hover:underline"
        >
          Újrapróbálás
        </button>
      </div>
    );
  }

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 ${compact ? 'p-3' : 'p-4'}`}
      role="region"
      aria-labelledby="episode-pathway-heading"
    >
      <h3 id="episode-pathway-heading" className={`font-semibold text-gray-900 dark:text-gray-100 ${compact ? 'text-sm mb-2' : 'text-base mb-3'}`}>
        Kezelési terv sablonok
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        Alkalmazd a <strong>kezelési terv sablonokat</strong> (lépéssor: konzultáció → munkafázisok). Egy epizódra több sablon is alkalmazható — lépéseik összefésülve jelennek meg, és a tervben szabadon egyéniesíthetők. A felelős orvos a terv-kártya fejlécében váltható, a sablontól függetlenül. A recall (kontroll) időpontok nem a terv részei — a Gyors foglalás blokkban foglalhatók.
      </p>

      <div className={`space-y-4 ${compact ? 'space-y-3' : ''}`}>
        {/* Assigned pathways list */}
        {episodePathways.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Alkalmazott sablonok
            </label>
            <ul className="space-y-1.5">
              {episodePathways.map((ep) => (
                <li key={ep.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-200 dark:border-gray-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ep.pathwayName}</span>
                    {ep.jaw && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 shrink-0">
                        {JAW_LABELS[ep.jaw] ?? ep.jaw}
                      </span>
                    )}
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                      {ep.workPhaseCount ?? ep.stepCount} munkafázis
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemovePathway(ep.id)}
                    disabled={removingPathwayId === ep.id}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 transition-colors shrink-0"
                    title="Sablon eltávolítása"
                  >
                    {removingPathwayId === ep.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    Eltávolítás
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Add pathway */}
        {availablePathways.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="episode-add-pathway-select">
              Sablon alkalmazása
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                id="episode-add-pathway-select"
                value={newPathwayId}
                onChange={(e) => setNewPathwayId(e.target.value)}
                className="flex-1 min-w-[180px] rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm disabled:opacity-50"
                disabled={addingPathway}
              >
                <option value="">— Válassz sablont</option>
                {availablePathways.map((p) => {
                  const isSuggested = p.treatmentTypeCode && suggestedTreatmentTypeCodes.includes(p.treatmentTypeCode);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}{isSuggested ? ' — Ajánlott' : ''}
                    </option>
                  );
                })}
              </select>
              <select
                id="episode-add-jaw-select"
                value={newJaw}
                onChange={(e) => setNewJaw(e.target.value as 'felso' | 'also')}
                className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm disabled:opacity-50"
                disabled={addingPathway}
              >
                <option value="felso">Felső állcsont</option>
                <option value="also">Alsó állcsont</option>
              </select>
              <button
                onClick={handleAddPathway}
                disabled={!newPathwayId || addingPathway}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-sm shrink-0"
              >
                {addingPathway ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Hozzáadás
              </button>
            </div>
          </div>
        )}

        {episodePathways.length === 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2 rounded">
            Alkalmazz legalább egy sablont, hogy a lépések generálhatók legyenek.
          </p>
        )}

        {error && (
          <p className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 p-2 rounded">{error}</p>
        )}
      </div>
    </div>
  );
}
