'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Loader2 } from 'lucide-react';

export interface EpisodePathwayEditorProps {
  episodeId: string;
  carePathwayId?: string | null;
  assignedProviderId?: string | null;
  carePathwayName?: string | null;
  assignedProviderName?: string | null;
  onSaved?: () => void | Promise<void>;
  compact?: boolean;
}

interface PathwayOption {
  id: string;
  name: string;
}

interface DoctorOption {
  id: string;
  name: string;
}

export function EpisodePathwayEditor({
  episodeId,
  carePathwayId,
  assignedProviderId,
  onSaved,
  compact = false,
}: EpisodePathwayEditorProps) {
  const { showToast } = useToast();
  const [pathways, setPathways] = useState<PathwayOption[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPathwayId, setSelectedPathwayId] = useState<string>(carePathwayId ?? '');
  const [selectedProviderId, setSelectedProviderId] = useState<string>(assignedProviderId ?? '');

  const initialPathwayId = carePathwayId ?? '';
  const initialProviderId = assignedProviderId ?? '';
  const dirty =
    selectedPathwayId !== initialPathwayId || selectedProviderId !== initialProviderId;

  const bothFilled = !!selectedPathwayId && !!selectedProviderId;
  const showG1Guard = (!!selectedPathwayId || !!selectedProviderId) && !bothFilled;

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    setError(null);
    try {
      const [pathwaysRes, doctorsRes] = await Promise.all([
        fetch('/api/care-pathways', { credentials: 'include' }),
        fetch('/api/users/fogpotlastanasz', { credentials: 'include' }),
      ]);
      if (!pathwaysRes.ok || !doctorsRes.ok) {
        throw new Error('Nem sikerült betölteni az adatokat');
      }
      const pathwaysData = await pathwaysRes.json();
      const doctorsData = await doctorsRes.json();
      setPathways(
        (pathwaysData.pathways ?? []).map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
        }))
      );
      setDoctors(
        (doctorsData.users ?? []).map((d: { id: string; name?: string; displayName?: string; email?: string }) => ({
          id: d.id,
          name: d.name ?? d.displayName ?? d.email ?? d.id,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba történt');
      showToast('Nem sikerült betölteni a kezelési utakat vagy orvosokat', 'error');
    } finally {
      setLoadingLists(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    setSelectedPathwayId(carePathwayId ?? '');
    setSelectedProviderId(assignedProviderId ?? '');
  }, [carePathwayId, assignedProviderId]);

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          carePathwayId: selectedPathwayId || null,
          assignedProviderId: selectedProviderId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Hiba történt a mentéskor');
      }
      showToast('Kezelési út és felelős orvos mentve', 'success');
      setError(null);
      await onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Hiba történt a mentéskor';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

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

  if (error && !dirty) {
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
    >
      <h3 className={`font-semibold text-gray-900 ${compact ? 'text-sm mb-2' : 'text-base mb-3'}`}>
        Kezelési út és felelős orvos
      </h3>
      <div className={`space-y-3 ${compact ? 'space-y-2' : ''}`}>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Kezelési út
          </label>
          <select
            value={selectedPathwayId}
            onChange={(e) => setSelectedPathwayId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={saving}
          >
            <option value="">— Nincs beállítva</option>
            {pathways.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Felelős orvos
          </label>
          <select
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={saving}
          >
            <option value="">— Nincs beállítva</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        {showG1Guard && (
          <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
            Mindkét mező kitöltése szükséges a worklist foglaláshoz.
          </p>
        )}
        {error && (
          <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-medical-primary text-white rounded-md hover:bg-medical-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            Mentés
          </button>
          {saving && (
            <span className="text-xs text-gray-500">Mentés…</span>
          )}
        </div>
      </div>
    </div>
  );
}
