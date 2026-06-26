import { memo, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Clock } from 'lucide-react';
import type { TimelineEpisode, TimelineStep, TimelineViewMode } from './types';
import { StepBar } from './StepBar';
import { computeNextTodo } from './episode-utils';
import { stageDisplay } from './stage-display';

/** Egyesített nézet: a lépés egyetlen pont (nem sáv) — a stádium-sáv adja a
 *  kontextust, a pont a konkrét eseményt jelöli (mint a mockupon). */
function stepDotClass(status: TimelineStep['status']): string {
  if (status === 'completed') return 'bg-emerald-600';
  if (status === 'booked') return 'bg-white dark:bg-gray-900 border-2 border-blue-600';
  return 'bg-white dark:bg-gray-900 border border-gray-500 dark:border-gray-400';
}

export interface EpisodeRowProps {
  episode: TimelineEpisode;
  range: { t0: number; t1: number; rangeMs: number; nowMs: number };
  toPercent: (t: number) => number;
  todayPercent: number;
  trackMinWidth: number;
  trackHeight?: number;
  /** Nézetmód: stádium-sáv, lépések, vagy egyesített. */
  viewMode?: TimelineViewMode;
  /**
   * Stabil callback a szülőből — az `episode`-t paraméterként kapja vissza,
   * hogy ne kelljen episode-onkénti closure-t létrehozni a hívóban
   * (különben a `memo` invalidálódna minden szülő render-nél).
   */
  onStepSelect: (episode: TimelineEpisode, step: TimelineStep) => void;
}

export const EpisodeRow = memo(function EpisodeRow({
  episode,
  range,
  toPercent,
  todayPercent,
  trackMinWidth,
  trackHeight = 56,
  viewMode = 'merged',
  onStepSelect,
}: EpisodeRowProps) {
  const completed = episode.steps.filter((s) => s.status === 'completed').length;
  const total = episode.steps.length;
  const progressPct = total ? (completed / total) * 100 : 0;
  const next = computeNextTodo(episode, range.nowMs);

  const showToday = todayPercent >= -1 && todayPercent <= 101;
  const showStage = viewMode === 'stage' || viewMode === 'merged';
  const showSteps = viewMode === 'steps' || viewMode === 'merged';
  const cur = stageDisplay(episode.currentStageCode);

  const bandSegments = showStage
    ? (episode.stageIntervals ?? [])
        .map((iv) => {
          const sMs = new Date(iv.start).getTime();
          const eMs = new Date(iv.end).getTime();
          if (Number.isNaN(sMs) || Number.isNaN(eMs)) return null;
          const left = Math.max(0, Math.min(100, toPercent(sMs)));
          const right = Math.max(0, Math.min(100, toPercent(eMs)));
          const width = right - left;
          if (width <= 0.05) return null;
          const disp = stageDisplay(iv.stageCode);
          return { key: `${iv.stageCode}-${iv.start}`, left, width, disp, label: iv.label ?? disp.label };
        })
        .filter(Boolean as unknown as <T>(v: T | null) => v is T)
    : [];

  // Egyesített nézet pont-pozíciói: a dátummal bíró lépések a dátumukon, a
  // dátum nélküli tervezettek halvány sorként a legutolsó ismert pont (ill. a
  // „Ma") után — így nem nyúlnak szét sávként és nem torlódnak a „Ma"-nál.
  const stepDots = useMemo(() => {
    if (viewMode !== 'merged') return [] as { step: TimelineStep; pos: number; faint: boolean }[];
    const dated: { step: TimelineStep; pos: number; faint: boolean }[] = [];
    const undated: TimelineStep[] = [];
    for (const s of episode.steps) {
      const dateStr = s.appointmentStart ?? s.windowStart ?? s.windowEnd ?? null;
      const t = dateStr ? new Date(dateStr).getTime() : NaN;
      if (!Number.isNaN(t)) {
        dated.push({ step: s, pos: Math.max(0, Math.min(100, toPercent(t))), faint: s.status === 'planned' });
      } else {
        undated.push(s);
      }
    }
    const lastDated = dated.length ? Math.max(...dated.map((d) => d.pos)) : todayPercent;
    let queue = Math.max(todayPercent, lastDated);
    for (const s of undated) {
      queue = Math.min(99, queue + 2.4);
      dated.push({ step: s, pos: queue, faint: true });
    }
    return dated;
  }, [viewMode, episode.steps, toPercent, todayPercent]);

  // A StepBar a régi `(step, el) => void` szignaturát várja, a parent
  // viszont a stabil `(episode, step)` callback-et adta. Itt összekötjük
  // — episode-onként egyetlen useCallback, amit a memo-zott row tart, így
  // a StepBar memo-ja sem invalidálódik szülő-render-en.
  const handleStepBarSelect = useCallback(
    (step: TimelineStep, _el: HTMLElement) => {
      onStepSelect(episode, step);
    },
    [onStepSelect, episode]
  );

  return (
    <div className="flex border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900" style={{ minWidth: 0 }}>
      <div className="flex-shrink-0 sticky left-0 z-10 w-[200px] md:w-[280px] border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-2 py-2 flex flex-col justify-center gap-1.5 shadow-[2px_0_8px_-4px_rgba(0,0,0,0.08)]">
        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0">
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
        {showStage && episode.currentStageCode && (
          <div className="min-w-0">
            <span
              className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${cur.badge} truncate max-w-full`}
              title={episode.currentStageLabel ?? cur.label}
            >
              {episode.currentStageLabel ?? cur.label}
            </span>
          </div>
        )}
        {episode.carePathwayName && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate hidden sm:block">{episode.carePathwayName}</div>
        )}
        {next && (
          <div className="text-[10px] text-gray-700 dark:text-gray-300 truncate" title={next.step.label}>
            Köv.: <span className="font-medium">{next.step.label}</span>
            <span className="text-gray-500 dark:text-gray-400"> · {next.relativeLabel}</span>
          </div>
        )}
        {episode.etaHeuristic && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-0.5">
            <Clock className="w-3 h-3 shrink-0" />
            ETA{' '}
            {new Date(episode.etaHeuristic).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>
      <div
        className="relative flex-shrink-0 border-l border-gray-100/50 dark:border-gray-800"
        style={{ width: trackMinWidth, height: trackHeight, minHeight: trackHeight }}
        role="region"
        aria-label={`Idővonal: ${episode.patientName}`}
      >
        {showStage &&
          bandSegments.map((seg) => (
            <div
              key={seg.key}
              className={`absolute top-1 bottom-1 ${seg.disp.band} rounded-sm overflow-hidden flex items-start justify-start px-1.5 pt-1 pointer-events-none ring-1 ring-inset ring-black/5 dark:ring-white/10`}
              style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
              title={seg.label}
              aria-hidden
            >
              {seg.width > 4 && (
                <span className={`text-[10px] leading-tight font-medium truncate ${seg.disp.text}`}>{seg.label}</span>
              )}
            </div>
          ))}
        {showToday && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 z-[2] pointer-events-none"
            style={{ left: `${Math.min(100, Math.max(0, todayPercent))}%` }}
            aria-hidden
          />
        )}
        {showSteps && viewMode === 'steps' &&
          episode.steps.map((step) => (
            <StepBar key={step.stepSeq} step={step} range={range} toPercent={toPercent} onSelect={handleStepBarSelect} />
          ))}
        {showSteps && viewMode === 'merged' &&
          stepDots.map(({ step, pos, faint }) => (
            <button
              key={step.stepSeq}
              type="button"
              className={`absolute rounded-full z-[3] ring-2 ring-white dark:ring-gray-900 hover:scale-150 transition-transform focus:outline-none focus:ring-2 focus:ring-medical-primary/60 ${stepDotClass(step.status)} ${faint ? 'opacity-60' : ''}`}
              style={{ left: `${pos}%`, top: '50%', width: 10, height: 10, transform: 'translate(-50%, -50%)' }}
              aria-label={`${step.label} — ${step.status === 'completed' ? 'teljesített' : step.status === 'booked' ? 'foglalt' : 'tervezett'}`}
              title={step.label}
              onClick={(e) => handleStepBarSelect(step, e.currentTarget)}
            />
          ))}
      </div>
    </div>
  );
});
