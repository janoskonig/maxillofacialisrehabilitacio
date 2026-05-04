import { memo } from 'react';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import type { TimelineEpisode, TimelineStep } from './types';
import { StepBar } from './StepBar';
import { computeNextTodo } from './episode-utils';

export interface EpisodeRowProps {
  episode: TimelineEpisode;
  range: { t0: number; t1: number; rangeMs: number; nowMs: number };
  toPercent: (t: number) => number;
  todayPercent: number;
  trackMinWidth: number;
  trackHeight?: number;
  onStepSelect: (step: TimelineStep, el: HTMLElement) => void;
}

export const EpisodeRow = memo(function EpisodeRow({
  episode,
  range,
  toPercent,
  todayPercent,
  trackMinWidth,
  trackHeight = 56,
  onStepSelect,
}: EpisodeRowProps) {
  const completed = episode.steps.filter((s) => s.status === 'completed').length;
  const total = episode.steps.length;
  const progressPct = total ? (completed / total) * 100 : 0;
  const next = computeNextTodo(episode, range.nowMs);

  const showToday = todayPercent >= -1 && todayPercent <= 101;

  return (
    <div className="flex border-b border-gray-100 bg-white" style={{ minWidth: 0 }}>
      <div className="flex-shrink-0 sticky left-0 z-10 w-[200px] md:w-[280px] border-r border-gray-200 bg-white px-2 py-2 flex flex-col justify-center gap-1.5 shadow-[2px_0_8px_-4px_rgba(0,0,0,0.08)]">
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
            aria-hidden
          />
        </div>
        <div className="flex items-center gap-1 min-w-0">
          <Link
            href={`/patients/${episode.patientId}/view`}
            className="font-medium text-sm text-medical-primary hover:underline truncate"
          >
            {episode.patientName}
          </Link>
        </div>
        {episode.carePathwayName && (
          <div className="text-[10px] text-gray-500 truncate hidden sm:block">{episode.carePathwayName}</div>
        )}
        {next && (
          <div className="text-[10px] text-gray-700 truncate" title={next.step.label}>
            Köv.: <span className="font-medium">{next.step.label}</span>
            <span className="text-gray-500"> · {next.relativeLabel}</span>
          </div>
        )}
        {episode.etaHeuristic && (
          <div className="text-[10px] text-gray-500 flex items-center gap-0.5">
            <Clock className="w-3 h-3 shrink-0" />
            ETA{' '}
            {new Date(episode.etaHeuristic).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>
      <div
        className="relative flex-shrink-0 border-l border-gray-100/50"
        style={{ width: trackMinWidth, height: trackHeight, minHeight: trackHeight }}
        role="region"
        aria-label={`Idővonal: ${episode.patientName}`}
      >
        {showToday && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 z-[1] pointer-events-none"
            style={{ left: `${Math.min(100, Math.max(0, todayPercent))}%` }}
            aria-hidden
          />
        )}
        {episode.steps.map((step) => (
          <StepBar key={step.stepSeq} step={step} range={range} toPercent={toPercent} onSelect={onStepSelect} />
        ))}
      </div>
    </div>
  );
});
