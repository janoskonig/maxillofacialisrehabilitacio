'use client';

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { Plus, X, ExternalLink, Check, Loader2 } from 'lucide-react';
import type { ToothTreatment, ToothTreatmentCatalogItem } from '@/lib/types';

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Függőben' },
  episode_linked: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Epizódhoz kötve' },
  completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Kész' },
};

// ---- Context: load treatments + catalog once, share across all tooth cards ----

interface ToothTreatmentContextValue {
  treatments: ToothTreatment[];
  catalog: ToothTreatmentCatalogItem[];
  loading: boolean;
  error: string | null;
  setError: (e: string | null) => void;
  reload: () => Promise<void>;
  patientId: string;
}

const ToothTreatmentContext = createContext<ToothTreatmentContextValue | null>(null);

interface ToothTreatmentProviderProps {
  patientId: string;
  children: ReactNode;
}

export function ToothTreatmentProvider({ patientId, children }: ToothTreatmentProviderProps) {
  const [treatments, setTreatments] = useState<ToothTreatment[]>([]);
  const [catalog, setCatalog] = useState<ToothTreatmentCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const [txRes, catRes] = await Promise.all([
        fetch(`/api/patients/${patientId}/tooth-treatments`, { credentials: 'include' }),
        fetch('/api/tooth-treatment-catalog', { credentials: 'include' }),
      ]);
      if (txRes.ok) {
        const txData = await txRes.json();
        setTreatments(txData.items ?? []);
      }
      if (catRes.ok) {
        const catData = await catRes.json();
        setCatalog(catData.items ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <ToothTreatmentContext.Provider value={{ treatments, catalog, loading, error, setError, reload, patientId }}>
      {children}
    </ToothTreatmentContext.Provider>
  );
}

// ---- Per-tooth inline component (rendered inside each tooth card) ----

interface ToothTreatmentInlineProps {
  toothNumber: string;
  isViewOnly?: boolean;
}

export function ToothTreatmentInline({ toothNumber, isViewOnly }: ToothTreatmentInlineProps) {
  const ctx = useContext(ToothTreatmentContext);
  const [adding, setAdding] = useState(false);
  const [selectedCode, setSelectedCode] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);
  const [creatingEpisodeId, setCreatingEpisodeId] = useState<string | null>(null);

  if (!ctx) return null;
  const { treatments, catalog, error, setError, reload, patientId } = ctx;

  const toothTreatments = treatments.filter((t) => String(t.toothNumber) === toothNumber);
  const active = toothTreatments.filter((t) => t.status !== 'completed');
  const completed = toothTreatments.filter((t) => t.status === 'completed');

  const handleAdd = async () => {
    if (!selectedCode) return;
    setSavingAdd(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/tooth-treatments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ toothNumber: parseInt(toothNumber), treatmentCode: selectedCode }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Hiba (${res.status})`); return; }
      setAdding(false);
      setSelectedCode('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setSavingAdd(false);
    }
  };

  const handleDelete = async (treatmentId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/tooth-treatments/${treatmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) { const data = await res.json(); setError(data.error ?? `Hiba`); return; }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    }
  };

  const handleComplete = async (treatmentId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}/tooth-treatments/${treatmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error ?? `Hiba`); return; }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    }
  };

  const handleCreateEpisode = async (treatment: ToothTreatment) => {
    setCreatingEpisodeId(treatment.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/tooth-treatments/${treatment.id}/create-episode`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({}) }
      );
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Hiba (${res.status})`); return; }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba');
    } finally {
      setCreatingEpisodeId(null);
    }
  };

  return (
    <div className="mt-2 space-y-1.5">
      {error && (
        <div className="p-1.5 bg-red-50 border border-red-200 rounded text-red-800 text-xs">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 underline">Bezár</button>
        </div>
      )}

      {/* Active treatments */}
      {active.map((t) => {
        const statusInfo = STATUS_COLORS[t.status] ?? STATUS_COLORS.pending;
        return (
          <div key={t.id} className="flex items-center gap-2 text-sm bg-gray-50 rounded px-2 py-1">
            <span className={`px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${statusInfo.bg} ${statusInfo.text}`}>
              {statusInfo.label}
            </span>
            <span className="font-medium text-sm">{t.labelHu ?? t.treatmentCode}</span>
            {!isViewOnly && (
              <div className="flex gap-1 ml-auto shrink-0">
                {t.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCreateEpisode(t)}
                      disabled={creatingEpisodeId === t.id}
                      className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                      title="Epizód létrehozása"
                    >
                      {creatingEpisodeId === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                      Epizód
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(t.id)}
                      className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                      title="Törlés"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                )}
                {t.status === 'episode_linked' && (
                  <button
                    type="button"
                    onClick={() => handleComplete(t.id)}
                    className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200 flex items-center gap-1"
                    title="Késznek jelölés"
                  >
                    <Check className="w-3 h-3" />
                    Kész
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Completed (collapsed) */}
      {completed.length > 0 && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer hover:text-gray-600">{completed.length} befejezett</summary>
          <div className="mt-1 space-y-0.5 pl-1">
            {completed.map((t) => (
              <div key={t.id} className="flex gap-1 items-center">
                <Check className="w-3 h-3 text-green-500" />
                <span>{t.labelHu ?? t.treatmentCode}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Add button / inline form */}
      {!isViewOnly && (
        <>
          {adding ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <select
                value={selectedCode}
                onChange={(e) => setSelectedCode(e.target.value)}
                className="form-input text-sm py-1 flex-1 min-w-[120px]"
              >
                <option value="">Válassz kezelést...</option>
                {catalog.map((c) => (
                  <option key={c.code} value={c.code}>{c.labelHu}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={savingAdd || !selectedCode}
                className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
              >
                {savingAdd ? '…' : 'Hozzáad'}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setSelectedCode(''); }}
                className="px-2 py-1 bg-gray-400 text-white rounded text-xs hover:bg-gray-500"
              >
                Mégse
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded px-1.5 py-0.5 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Kezelés hozzáadása
            </button>
          )}
        </>
      )}
    </div>
  );
}
