'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { extractSuggestedTreatmentTypeCodes } from '@/lib/treatment-type-normalize';

export interface EpisodePathwayEditorProps {
  episodeId: string;
  patientId?: string | null;
  carePathwayId?: string | null;
  assignedProviderId?: string | null;
  carePathwayName?: string | null;
  assignedProviderName?: string | null;
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

interface DoctorOption {
  id: string;
  name: string;
}

interface EpisodePathwayRow {
  id: string;
  carePathwayId: string;
  ordinal: number;
  pathwayName: string;
  stepCount: number;
}

export function EpisodePathwayEditor({
  episodeId,
  patientId,
  carePathwayId,
  assignedProviderId,
  treatmentTypeId: initialTreatmentTypeId,
  onSaved,
  compact = false,
}: EpisodePathwayEditorProps) {
  const { showToast } = useToast();
  const [pathways, setPathways] = useState<PathwayOption[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [suggestedTreatmentTypeCodes, setSuggestedTreatmentTypeCodes] = useState<string[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Multi-pathway state
  const [episodePathways, setEpisodePathways] = useState<EpisodePathwayRow[]>([]);
  const [addingPathway, setAddingPathway] = useState(false);
  const [newPathwayId, setNewPathwayId] = useState('');
  const [removingPathwayId, setRemovingPathwayId] = useState<string | null>(null);

  // Provider state (still single per episode)
  const [selectedProviderId, setSelectedProviderId] = useState<string>(assignedProviderId ?? '');
  const [providerDirty, setProviderDirty] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    setError(null);
    try {
      const [pathwaysRes, doctorsRes, patientRes, episodeRes] = await Promise.all([
        fetch('/api/care-pathways', { credentials: 'include' }),
        fetch('/api/users/fogpotlastanasz', { credentials: 'include' }),
        patientId ? fetch(`/api/patients/${patientId}`, { credentials: 'include' }) : Promise.resolve(null),
        fetch(`/api/episodes/${episodeId}`, { credentials: 'include' }),
      ]);
      if (!pathwaysRes.ok || !doctorsRes.ok) {
        throw new Error('Nem sikerült betölteni az adatokat');
      }
      const pathwaysData = await pathwaysRes.json();
      const doctorsData = await doctorsRes.json();
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
      setDoctors(
        (doctorsData.users ?? []).map((d: { id: string; name?: string; displayName?: string; email?: string }) => ({
          id: d.id,
          name: d.name ?? d.displayName ?? d.email ?? d.id,
        }))
      );

      if (episodeRes.ok) {
        const episodeData = await episodeRes.json();
        const ep = episodeData.episode;
        setEpisodePathways(ep?.episodePathways ?? []);
        setSelectedProviderId(ep?.assignedProviderId ?? '');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba történt');
      showToast('Nem sikerült betölteni a kezelési utakat vagy orvosokat', 'error');
    } finally {
      setLoadingLists(false);
    }
  }, [showToast, patientId, episodeId]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    setSelectedProviderId(assignedProviderId ?? '');
    setProviderDirty(false);
  }, [assignedProviderId]);

  const handleAddPathway = async () => {
    if (!newPathwayId || addingPathway) return;
    setAddingPathway(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'addPathway', carePathwayId: newPathwayId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Hiba a kezelési út hozzáadásakor');
      }
      setEpisodePathways(data.episodePathways ?? []);
      setNewPathwayId('');
      showToast('Kezelési út hozzáadva', 'success');
      await onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setAddingPathway(false);
    }
  };

  const handleRemovePathway = async (carePathwayId: string) => {
    if (removingPathwayId) return;
    setRemovingPathwayId(carePathwayId);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'removePathway', carePathwayId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Hiba a kezelési út eltávolításakor');
      }
      setEpisodePathways(data.episodePathways ?? []);
      showToast('Kezelési út eltávolítva', 'success');
      await onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setRemovingPathwayId(null);
    }
  };

  const handleSaveProvider = async () => {
    if (!providerDirty || savingProvider) return;
    setSavingProvider(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ assignedProviderId: selectedProviderId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Hiba a felelős orvos mentésekor');
      }
      setProviderDirty(false);
      showToast('Felelős orvos mentve', 'success');
      await onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSavingProvider(false);
    }
  };

  // Pathways already assigned — filter them out of the dropdown
  const assignedPathwayIds = new Set(episodePathways.map((ep) => ep.carePathwayId));
  const availablePathways = pathways.filter((p) => !assignedPathwayIds.has(p.id));

  if (loadingLists) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Betöltés…</span>
        </div>
      </div>
    );
  }

  if (error && episodePathways.length === 0 && !providerDirty) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-red-600">{error}</p>
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
      className={`bg-white rounded-lg border border-gray-200 ${compact ? 'p-3' : 'p-4'}`}
      role="region"
      aria-labelledby="episode-pathway-heading"
    >
      <h3 id="episode-pathway-heading" className={`font-semibold text-gray-900 ${compact ? 'text-sm mb-2' : 'text-base mb-3'}`}>
        Kezelési utak és felelős orvos
      </h3>
      <p className="text-sm text-gray-600 mb-3">
        Ehhez az epizódhoz tartozó beállítások: add hozzá a <strong>kezelési utakat</strong> (lépéssor: konzultáció → munka → kontroll) és válaszd ki a <strong>felelős orvost</strong>. Egy epizódhoz több kezelési út is rendelhető — lépéseik összefésülve jelennek meg.
      </p>

      <div className={`space-y-4 ${compact ? 'space-y-3' : ''}`}>
        {/* Assigned pathways list */}
        {episodePathways.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Hozzárendelt kezelési utak
            </label>
            <ul className="space-y-1.5">
              {episodePathways.map((ep) => (
                <li key={ep.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-900 truncate">{ep.pathwayName}</span>
                    <span className="text-xs text-gray-500 shrink-0">{ep.stepCount} lépés</span>
                  </div>
                  <button
                    onClick={() => handleRemovePathway(ep.carePathwayId)}
                    disabled={removingPathwayId === ep.carePathwayId}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 disabled:opacity-50 transition-colors shrink-0"
                    title="Kezelési út eltávolítása"
                  >
                    {removingPathwayId === ep.carePathwayId ? (
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
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="episode-add-pathway-select">
              Kezelési út hozzáadása
            </label>
            <div className="flex items-center gap-2">
              <select
                id="episode-add-pathway-select"
                value={newPathwayId}
                onChange={(e) => setNewPathwayId(e.target.value)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
                disabled={addingPathway}
              >
                <option value="">— Válassz kezelési utat</option>
                {availablePathways.map((p) => {
                  const isSuggested = p.treatmentTypeCode && suggestedTreatmentTypeCodes.includes(p.treatmentTypeCode);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}{isSuggested ? ' — Ajánlott' : ''}
                    </option>
                  );
                })}
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

        {/* Provider */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="episode-provider-select">
            Felelős orvos
          </label>
          <div className="flex items-center gap-2">
            <select
              id="episode-provider-select"
              value={selectedProviderId}
              onChange={(e) => {
                setSelectedProviderId(e.target.value);
                setProviderDirty(true);
              }}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
              disabled={savingProvider}
            >
              <option value="">— Nincs beállítva</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {providerDirty && (
              <button
                onClick={handleSaveProvider}
                disabled={savingProvider}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark disabled:opacity-50 text-sm shrink-0"
              >
                {savingProvider && <Loader2 className="w-4 h-4 animate-spin" />}
                Mentés
              </button>
            )}
          </div>
        </div>

        {/* Guard: both pathway + provider needed */}
        {episodePathways.length > 0 && !selectedProviderId && (
          <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
            Felelős orvos kiválasztása szükséges a worklist foglaláshoz.
          </p>
        )}
        {episodePathways.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
            Adj hozzá legalább egy kezelési utat, hogy a lépések generálhatók legyenek.
          </p>
        )}

        {error && (
          <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>
        )}
      </div>
    </div>
  );
}
