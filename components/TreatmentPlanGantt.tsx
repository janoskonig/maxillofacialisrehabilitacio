'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AlertCircle, Calendar, CheckCircle2, Clock, Eye, Loader2 } from 'lucide-react';

type TimelineStepStatus = 'completed' | 'booked' | 'in_progress' | 'no_show' | 'projected' | 'overdue';

interface TimelineStep {
  stepCode: string;
  stepSeq: number;
  label: string;
  pool: string;
  durationMinutes: number;
  status: TimelineStepStatus;
  windowStart: string | null;
  windowEnd: string | null;
  appointmentId: string | null;
  appointmentStart: string | null;
  appointmentStatus: string | null;
  intentId: string | null;
  intentState: string | null;
}

interface TimelineEpisode {
  episodeId: string;
  patientId: string;
  patientName: string;
  reason: string;
  status: string;
  openedAt: string;
  carePathwayName: string | null;
  assignedProviderName: string | null;
  treatmentTypeLabel: string | null;
  steps: TimelineStep[];
  etaHeuristic: string | null;
}

interface TimelineMeta {
  serverNow: string;
  fetchedAt: string;
  timezone: string;
  ordering: string;
}

const STATUS_CONFIG: Record<TimelineStepStatus, { bg: string; border: string; text: string; label: string }> = {
  completed:   { bg: 'bg-emerald-500', border: 'border-emerald-600', text: 'text-white',       label: 'Teljesítve' },
  booked:      { bg: 'bg-blue-500',    border: 'border-blue-600',    text: 'text-white',       label: 'Foglalt' },
  in_progress: { bg: 'bg-blue-300',    border: 'border-blue-400',    text: 'text-blue-900',    label: 'Folyamatban' },
  no_show:     { bg: 'bg-gray-300',    border: 'border-gray-400',    text: 'text-gray-600',    label: 'Nem jelent meg' },
  projected:   { bg: 'bg-amber-50',    border: 'border-amber-400 border-dashed', text: 'text-amber-800', label: 'Tervezett' },
  overdue:     { bg: 'bg-red-50',      border: 'border-red-500 ring-2 ring-red-500', text: 'text-red-800', label: 'Lejárt' },
};

function StepBar({ step, totalSteps }: { step: TimelineStep; totalSteps: number }) {
  const config = STATUS_CONFIG[step.status];
  const widthPct = Math.max(100 / totalSteps, 8);

  const dateLabel = step.appointmentStart
    ? new Date(step.appointmentStart).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })
    : step.windowStart
      ? new Date(step.windowStart).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })
      : null;

  return (
    <div
      className="group relative flex-shrink-0"
      style={{ width: `${widthPct}%`, minWidth: '60px' }}
    >
      <div
        className={`h-8 rounded border ${config.bg} ${config.border} ${config.text} flex items-center justify-center text-xs font-medium truncate px-1 transition-all`}
        title={`${step.label} — ${config.label}`}
      >
        <span className="truncate">{step.label}</span>
      </div>
      {dateLabel && (
        <div className="text-[10px] text-gray-500 text-center mt-0.5 truncate">{dateLabel}</div>
      )}
      {/* Tooltip on hover */}
      <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-56 p-2 bg-white border border-gray-200 rounded-lg shadow-lg text-xs">
        <div className="font-semibold text-gray-900 mb-1">{step.label}</div>
        <div className="text-gray-600">
          <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: getStatusDotColor(step.status) }} />
          {config.label}
        </div>
        <div className="text-gray-500 mt-0.5">Pool: {step.pool} · {step.durationMinutes} perc</div>
        {step.windowStart && (
          <div className="text-gray-500 mt-0.5">
            Ablak: {new Date(step.windowStart).toLocaleDateString('hu-HU')}
            {step.windowEnd && ` – ${new Date(step.windowEnd).toLocaleDateString('hu-HU')}`}
          </div>
        )}
        {step.appointmentStart && (
          <div className="text-gray-500 mt-0.5">
            Időpont: {new Date(step.appointmentStart).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}

function getStatusDotColor(status: TimelineStepStatus): string {
  const map: Record<TimelineStepStatus, string> = {
    completed: '#10b981',
    booked: '#3b82f6',
    in_progress: '#93c5fd',
    no_show: '#9ca3af',
    projected: '#f59e0b',
    overdue: '#ef4444',
  };
  return map[status];
}

function EpisodeRow({ episode }: { episode: TimelineEpisode }) {
  const completedCount = episode.steps.filter(s => s.status === 'completed').length;
  const overdueCount = episode.steps.filter(s => s.status === 'overdue').length;
  const totalSteps = episode.steps.length;

  return (
    <div className="border border-gray-200 rounded-lg bg-white hover:shadow-sm transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/patients/${episode.patientId}/view`}
            className="font-medium text-sm text-medical-primary hover:underline truncate"
          >
            {episode.patientName}
          </Link>
          {episode.carePathwayName && (
            <span className="text-xs text-gray-500 truncate hidden sm:inline">{episode.carePathwayName}</span>
          )}
          {episode.treatmentTypeLabel && (
            <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 hidden md:inline">{episode.treatmentTypeLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-gray-500">
            {completedCount}/{totalSteps}
          </span>
          {overdueCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
              <AlertCircle className="w-3.5 h-3.5" />
              {overdueCount} lejárt
            </span>
          )}
          {episode.etaHeuristic && (
            <span className="text-xs text-gray-500 hidden lg:flex items-center gap-1" title="Heurisztikus ETA – utolsó tervezett/foglalt lépés vége">
              <Clock className="w-3 h-3" />
              ETA {new Date(episode.etaHeuristic).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>
      {/* Steps bar */}
      <div className="flex gap-1 px-3 py-2 overflow-x-auto">
        {episode.steps.map((step) => (
          <StepBar key={step.stepSeq} step={step} totalSteps={totalSteps} />
        ))}
      </div>
    </div>
  );
}

export function TreatmentPlanGantt() {
  const [episodes, setEpisodes] = useState<TimelineEpisode[]>([]);
  const [meta, setMeta] = useState<TimelineMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/treatment-plan-timeline?status=${statusFilter}&limit=100`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Nem sikerült betölteni');
        const data = await res.json();
        setEpisodes(data.episodes ?? []);
        setMeta(data.meta ?? null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  // Summary stats
  const stats = useMemo(() => {
    const allSteps = episodes.flatMap(e => e.steps);
    return {
      totalEpisodes: episodes.length,
      overdueSteps: allSteps.filter(s => s.status === 'overdue').length,
      projectedSteps: allSteps.filter(s => s.status === 'projected').length,
      bookedSteps: allSteps.filter(s => s.status === 'booked').length,
      completedSteps: allSteps.filter(s => s.status === 'completed').length,
    };
  }, [episodes]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'open' | 'closed' | 'all')}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-medical-primary/20 focus:border-medical-primary"
          >
            <option value="open">Nyitott epizódok</option>
            <option value="closed">Lezárt epizódok</option>
            <option value="all">Összes</option>
          </select>
        </div>
        {/* Stats badges */}
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-gray-100 text-gray-600">{stats.totalEpisodes} epizód</span>
          {stats.overdueSteps > 0 && (
            <span className="px-2 py-1 rounded bg-red-100 text-red-700 font-medium">{stats.overdueSteps} lejárt lépés</span>
          )}
          <span className="px-2 py-1 rounded bg-amber-100 text-amber-700">{stats.projectedSteps} tervezett</span>
          <span className="px-2 py-1 rounded bg-blue-100 text-blue-700">{stats.bookedSteps} foglalt</span>
          <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700">{stats.completedSteps} kész</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-gray-600">
        {(Object.entries(STATUS_CONFIG) as [TimelineStepStatus, typeof STATUS_CONFIG[TimelineStepStatus]][]).map(([key, cfg]) => (
          <span key={key} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: getStatusDotColor(key) }} />
            {cfg.label}
          </span>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-medical-primary" />
          <span className="ml-2 text-sm text-gray-500">Kezelési tervek betöltése…</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && episodes.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Calendar className="w-10 h-10 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Nincs kezelési terv idővonal adat.</p>
        </div>
      )}

      {!loading && !error && episodes.length > 0 && (
        <div className="space-y-2">
          {episodes.map((ep) => (
            <EpisodeRow key={ep.episodeId} episode={ep} />
          ))}
        </div>
      )}

      {meta && (
        <div className="text-xs text-gray-400 text-right">
          Frissítve: {new Date(meta.fetchedAt).toLocaleTimeString('hu-HU')} · ETA = heurisztikus becslés
        </div>
      )}
    </div>
  );
}
