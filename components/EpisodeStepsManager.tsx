'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Loader2, SkipForward, RotateCcw, CheckCircle2, Circle, Clock, ChevronDown, ChevronUp } from 'lucide-react';

interface EpisodeStep {
  id: string;
  episodeId: string;
  stepCode: string;
  pathwayOrderIndex: number;
  pool: string;
  durationMinutes: number;
  defaultDaysOffset: number;
  status: 'pending' | 'scheduled' | 'completed' | 'skipped';
  appointmentId: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface StepLabel {
  stepCode: string;
  labelHu: string;
}

export interface EpisodeStepsManagerProps {
  episodeId: string;
  carePathwayId: string | null;
  carePathwayName?: string | null;
  onStepChanged?: () => void;
}

const poolLabels: Record<string, string> = {
  consult: 'Konzultáció',
  work: 'Munkafázis',
  control: 'Kontroll',
};

const statusConfig: Record<string, { icon: typeof Circle; label: string; color: string; bgColor: string }> = {
  pending: { icon: Circle, label: 'Várakozik', color: 'text-gray-400', bgColor: 'bg-gray-50' },
  scheduled: { icon: Clock, label: 'Időpont foglalva', color: 'text-blue-500', bgColor: 'bg-blue-50' },
  completed: { icon: CheckCircle2, label: 'Kész', color: 'text-green-500', bgColor: 'bg-green-50' },
  skipped: { icon: SkipForward, label: 'Átugorva', color: 'text-amber-500', bgColor: 'bg-amber-50' },
};

export function EpisodeStepsManager({
  episodeId,
  carePathwayId,
  carePathwayName,
  onStepChanged,
}: EpisodeStepsManagerProps) {
  const { showToast } = useToast();
  const [steps, setSteps] = useState<EpisodeStep[]>([]);
  const [stepLabels, setStepLabels] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [confirmStepId, setConfirmStepId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'skip' | 'unskip' | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const loadSteps = useCallback(async () => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps/generate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setSteps([]);
          return;
        }
        throw new Error(data.error ?? 'Nem sikerült betölteni');
      }
      const data = await res.json();
      setSteps(data.steps ?? []);
    } catch (e) {
      console.error('Error loading episode steps:', e);
    }
  }, [episodeId]);

  const loadLabels = useCallback(async () => {
    try {
      const res = await fetch('/api/step-catalog', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const map = new Map<string, string>();
        (data.steps ?? []).forEach((s: StepLabel) => map.set(s.stepCode, s.labelHu));
        setStepLabels(map);
      }
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    if (!carePathwayId) {
      setSteps([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([loadSteps(), loadLabels()]).finally(() => setLoading(false));
  }, [carePathwayId, loadSteps, loadLabels]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await loadSteps();
      showToast('Lépések generálva', 'success');
    } catch {
      showToast('Nem sikerült generálni a lépéseket', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleSkip = async (stepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'skipped', reason: skipReason || 'Manuálisan átugorva' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Hiba');
      }
      const data = await res.json();
      setSteps((prev) => prev.map((s) => (s.id === stepId ? data.step : s)));
      setConfirmStepId(null);
      setConfirmAction(null);
      setSkipReason('');
      showToast('Lépés átugorva', 'success');
      onStepChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUnskip = async (stepId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/steps/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'pending', reason: 'Visszaállítva várakozóra' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Hiba');
      }
      const data = await res.json();
      setSteps((prev) => prev.map((s) => (s.id === stepId ? data.step : s)));
      setConfirmStepId(null);
      setConfirmAction(null);
      showToast('Lépés visszaállítva', 'success');
      onStepChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Hiba történt', 'error');
    } finally {
      setSaving(false);
    }
  };

  const getStepLabel = (stepCode: string): string => {
    return stepLabels.get(stepCode) ?? stepCode.replace(/_/g, ' ');
  };

  // Find the first pending step to highlight as "next"
  const nextPendingIndex = steps.findIndex((s) => s.status === 'pending' || s.status === 'scheduled');

  if (!carePathwayId) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-900">Kezelési lépések</h3>
          {carePathwayName && (
            <p className="text-sm text-gray-500 mt-0.5">{carePathwayName}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {steps.length > 0 && (
            <span className="text-xs text-gray-500">
              {steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length}/{steps.length} kész
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Betöltés…</span>
            </div>
          ) : steps.length === 0 ? (
            <div className="py-4">
              <p className="text-sm text-gray-600 mb-3">
                Ehhez az epizódhoz még nincsenek konkrét lépések generálva a kezelési útból.
              </p>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-medical-primary text-white rounded-md text-sm hover:bg-medical-primary-dark disabled:opacity-50"
              >
                {generating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Lépések generálása
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-gray-500 mb-3">
                Már teljesített lépéseket átugorhatod — a rendszer automatikusan a következő várakozó lépéssel fog számolni az időpontfoglalásnál.
              </p>
              {steps.map((step, idx) => {
                const config = statusConfig[step.status] ?? statusConfig.pending;
                const StatusIcon = config.icon;
                const isNext = idx === nextPendingIndex;
                const canSkip = step.status === 'pending' || step.status === 'scheduled';
                const canUnskip = step.status === 'skipped';
                const isConfirming = confirmStepId === step.id;

                return (
                  <div key={step.id}>
                    <div
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        isNext ? 'bg-medical-primary/5 border border-medical-primary/20' : config.bgColor
                      }`}
                    >
                      {/* Step number + icon */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono text-gray-400 w-5 text-right">{idx + 1}.</span>
                        <StatusIcon className={`w-4 h-4 ${config.color}`} />
                      </div>

                      {/* Step info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${step.status === 'skipped' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                            {getStepLabel(step.stepCode)}
                          </span>
                          {isNext && (
                            <span className="text-xs font-medium text-medical-primary bg-medical-primary/10 px-1.5 py-0.5 rounded">
                              Következő
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-500">{poolLabels[step.pool] ?? step.pool}</span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500">{step.durationMinutes} perc</span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className={`text-xs ${config.color}`}>{config.label}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="shrink-0">
                        {canSkip && !isConfirming && (
                          <button
                            onClick={() => {
                              setConfirmStepId(step.id);
                              setConfirmAction('skip');
                              setSkipReason('');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 bg-amber-100 rounded hover:bg-amber-200 transition-colors"
                            title="Lépés átugrása"
                          >
                            <SkipForward className="w-3 h-3" />
                            Átugrom
                          </button>
                        )}
                        {canUnskip && !isConfirming && (
                          <button
                            onClick={() => {
                              setConfirmStepId(step.id);
                              setConfirmAction('unskip');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                            title="Visszaállítás"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Visszaállít
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Confirm dialog (inline) */}
                    {isConfirming && (
                      <div className="mt-1 ml-10 p-3 rounded-lg border border-gray-200 bg-white">
                        {confirmAction === 'skip' ? (
                          <>
                            <p className="text-sm text-gray-700 mb-2">
                              Biztosan átugrja a(z) <strong>{getStepLabel(step.stepCode)}</strong> lépést?
                            </p>
                            <input
                              type="text"
                              value={skipReason}
                              onChange={(e) => setSkipReason(e.target.value)}
                              placeholder="Ok (opcionális, pl. már megtörtént)"
                              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mb-2"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSkip(step.id)}
                                disabled={saving}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 disabled:opacity-50"
                              >
                                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                                Átugrás megerősítése
                              </button>
                              <button
                                onClick={() => { setConfirmStepId(null); setConfirmAction(null); }}
                                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
                              >
                                Mégse
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-gray-700 mb-2">
                              Visszaállítja a(z) <strong>{getStepLabel(step.stepCode)}</strong> lépést várakozóra?
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleUnskip(step.id)}
                                disabled={saving}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-600 text-white rounded text-xs font-medium hover:bg-gray-700 disabled:opacity-50"
                              >
                                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                                Visszaállítás
                              </button>
                              <button
                                onClick={() => { setConfirmStepId(null); setConfirmAction(null); }}
                                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800"
                              >
                                Mégse
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
