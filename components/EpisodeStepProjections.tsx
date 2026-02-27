'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2, CheckCircle2, Circle, Clock, SkipForward,
  CalendarDays, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react';

interface ProjectedStep {
  stepCode: string;
  label: string;
  seq: number;
  pool: string;
  durationMinutes: number;
  status: 'completed' | 'scheduled' | 'pending' | 'skipped';
  actualDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  waitFromNowDays: number | null;
  customLabel?: string | null;
}

interface Summary {
  completedCount: number;
  remainingCount: number;
  estimatedCompletionEarliest: string | null;
  estimatedCompletionLatest: string | null;
  nextStepWaitDays: number | null;
}

const poolLabels: Record<string, string> = {
  consult: 'Konzultáció',
  work: 'Munkafázis',
  control: 'Kontroll',
};

const poolColors: Record<string, string> = {
  consult: 'bg-purple-100 text-purple-700',
  work: 'bg-blue-100 text-blue-700',
  control: 'bg-teal-100 text-teal-700',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('hu-HU', {
    month: 'short',
    day: 'numeric',
  });
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatWaitDays(days: number): string {
  if (days === 0) return 'ma';
  if (days === 1) return '1 nap múlva';
  return `${days} nap múlva`;
}

export interface EpisodeStepProjectionsProps {
  episodeId: string;
  refreshTrigger?: number;
}

export function EpisodeStepProjections({ episodeId, refreshTrigger }: EpisodeStepProjectionsProps) {
  const [steps, setSteps] = useState<ProjectedStep[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/step-projections`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Hiba történt');
      }
      const data = await res.json();
      setSteps(data.steps ?? []);
      setSummary(data.summary ?? null);
      setBlocked(data.blocked ?? false);
      setBlockedReason(data.blockedReason ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hiba történt');
    } finally {
      setLoading(false);
    }
  }, [episodeId]);

  useEffect(() => {
    load();
  }, [load, refreshTrigger]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Tervezett ütemezés betöltése…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-4">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="bg-white rounded-lg border border-amber-200 p-4">
        <div className="flex items-center gap-2 text-amber-700">
          <AlertTriangle className="w-4 h-4" />
          <p className="text-sm font-medium">Nem tudunk ütemezést becsülni</p>
        </div>
        {blockedReason && <p className="text-sm text-amber-600 mt-1 ml-6">{blockedReason}</p>}
      </div>
    );
  }

  if (steps.length === 0) return null;

  const completedSteps = steps.filter((s) => s.status === 'completed');
  const activeSteps = steps.filter((s) => s.status !== 'completed' && s.status !== 'skipped');
  const totalSteps = steps.filter((s) => s.status !== 'skipped').length;
  const progress = totalSteps > 0 ? (completedSteps.length / totalSteps) * 100 : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-medical-primary" />
          <div>
            <h3 className="text-base font-semibold text-gray-900">Tervezett ütemezés</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {summary?.remainingCount ?? 0} hátralévő lépés
              {summary?.nextStepWaitDays != null && summary.nextStepWaitDays > 0 && (
                <> · következő {formatWaitDays(summary.nextStepWaitDays)}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {completedSteps.length}/{totalSteps} kész
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-medical-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Summary card */}
          {summary && (summary.estimatedCompletionEarliest || summary.estimatedCompletionLatest) && (
            <div className="mb-4 flex items-center gap-3 p-3 rounded-lg bg-medical-primary/5 border border-medical-primary/10">
              <CalendarDays className="w-5 h-5 text-medical-primary shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-gray-900">Becsült befejezés: </span>
                <span className="text-gray-700">
                  {summary.estimatedCompletionEarliest && summary.estimatedCompletionLatest
                    ? `${formatDate(summary.estimatedCompletionEarliest)} – ${formatDate(summary.estimatedCompletionLatest)}`
                    : summary.estimatedCompletionLatest
                      ? `legkésőbb ${formatDate(summary.estimatedCompletionLatest)}`
                      : summary.estimatedCompletionEarliest
                        ? `legkorábban ${formatDate(summary.estimatedCompletionEarliest)}`
                        : '–'}
                </span>
              </div>
            </div>
          )}

          {/* Step timeline */}
          <div className="relative">
            {steps.map((step, idx) => {
              const isLast = idx === steps.length - 1;
              const isNext = step.status === 'pending' && activeSteps[0]?.stepCode === step.stepCode && activeSteps[0]?.seq === step.seq;

              return (
                <div key={`${step.stepCode}-${step.seq}`} className="flex gap-3">
                  {/* Timeline connector */}
                  <div className="flex flex-col items-center shrink-0">
                    <StepDot status={step.status} isNext={isNext} />
                    {!isLast && (
                      <div className={`w-0.5 flex-1 min-h-[1.5rem] ${
                        step.status === 'completed' ? 'bg-green-300' :
                        step.status === 'skipped' ? 'bg-amber-200' : 'bg-gray-200'
                      }`} />
                    )}
                  </div>

                  {/* Step content */}
                  <div className={`flex-1 pb-4 ${isLast ? 'pb-1' : ''}`}>
                    <div className={`flex items-start gap-2 flex-wrap ${
                      step.status === 'skipped' ? 'opacity-50' : ''
                    }`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-medium ${
                            step.status === 'skipped' ? 'line-through text-gray-400' : 'text-gray-900'
                          }`}>
                            {step.label}
                          </span>
                          {isNext && (
                            <span className="text-xs font-medium text-medical-primary bg-medical-primary/10 px-1.5 py-0.5 rounded">
                              Következő
                            </span>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded ${poolColors[step.pool] ?? 'bg-gray-100 text-gray-600'}`}>
                            {poolLabels[step.pool] ?? step.pool}
                          </span>
                          <span className="text-xs text-gray-400">{step.durationMinutes} perc</span>
                        </div>

                        {/* Date/window info */}
                        <div className="mt-1">
                          {step.status === 'completed' && step.actualDate && (
                            <span className="text-xs text-green-600">
                              ✓ Kész – {formatDateLong(step.actualDate)}
                            </span>
                          )}
                          {step.status === 'scheduled' && step.actualDate && (
                            <span className="text-xs text-blue-600">
                              📅 Foglalva – {formatDateLong(step.actualDate)}
                              {step.waitFromNowDays != null && step.waitFromNowDays > 0 && (
                                <span className="text-gray-500"> ({formatWaitDays(step.waitFromNowDays)})</span>
                              )}
                            </span>
                          )}
                          {step.status === 'pending' && step.windowStart && step.windowEnd && (
                            <span className="text-xs text-gray-600">
                              🕐 {formatDate(step.windowStart)} – {formatDate(step.windowEnd)}
                              {step.waitFromNowDays != null && (
                                <span className="text-gray-500 ml-1">
                                  ({step.waitFromNowDays === 0 ? 'most ütemezendő' : formatWaitDays(step.waitFromNowDays)})
                                </span>
                              )}
                            </span>
                          )}
                          {step.status === 'pending' && !step.windowStart && (
                            <span className="text-xs text-gray-400 italic">Időablak számítása…</span>
                          )}
                          {step.status === 'skipped' && (
                            <span className="text-xs text-amber-500">Átugorva</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StepDot({ status, isNext }: { status: string; isNext: boolean }) {
  if (status === 'completed') {
    return (
      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
      </div>
    );
  }
  if (status === 'scheduled') {
    return (
      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
        <Clock className="w-4 h-4 text-blue-600" />
      </div>
    );
  }
  if (status === 'skipped') {
    return (
      <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
        <SkipForward className="w-4 h-4 text-amber-500" />
      </div>
    );
  }
  // pending
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
      isNext ? 'bg-medical-primary/15 ring-2 ring-medical-primary/30' : 'bg-gray-100'
    }`}>
      <Circle className={`w-4 h-4 ${isNext ? 'text-medical-primary' : 'text-gray-300'}`} />
    </div>
  );
}
