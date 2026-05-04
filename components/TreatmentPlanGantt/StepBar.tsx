import { memo } from 'react';
import type { TimelineStep } from './types';
import type { TimeRange } from './timeline-math';
import { getStepTimeRange, clipBar } from './timeline-math';
import { STATUS_CONFIG } from './constants';

export interface StepBarProps {
  step: TimelineStep;
  range: TimeRange & { nowMs: number };
  toPercent: (tMs: number) => number;
  onSelect: (step: TimelineStep, el: HTMLElement) => void;
}

export const StepBar = memo(function StepBar({ step, range, toPercent, onSelect }: StepBarProps) {
  const cfg = STATUS_CONFIG[step.status];
  const tr = getStepTimeRange(step);

  if (!tr) {
    const base = toPercent(range.nowMs);
    const left = Math.min(97, Math.max(1, base + step.stepSeq * 0.35));
    return (
      <button
        type="button"
        className="absolute top-1/2 -translate-y-1/2 w-1.5 h-8 rounded-sm bg-gray-400 hover:bg-gray-500 ring-1 ring-gray-300 z-[2]"
        style={{ left: `${left}%` }}
        aria-label={`${step.label} — nincs dátum, hely a sorban`}
        onClick={(e) => onSelect(step, e.currentTarget)}
      />
    );
  }

  const { left, width } = clipBar(tr.startMs, tr.endMs, range);

  return (
    <button
      type="button"
      className={`absolute top-1/2 -translate-y-1/2 h-8 rounded border z-[2] flex items-center justify-center overflow-hidden shadow-sm hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-medical-primary/40 ${cfg.bg} ${cfg.border} ${cfg.text}`}
      style={{
        left: `${left}%`,
        width: `${Math.min(100 - left, Math.max(width, 1.4))}%`,
        minWidth: 24,
      }}
      aria-label={`${step.label}, ${cfg.label}`}
      onClick={(e) => onSelect(step, e.currentTarget)}
    >
      {width > 6 && <span className="truncate px-1 text-[10px] sm:text-xs font-medium">{step.label}</span>}
    </button>
  );
});
