import { addMinutes } from 'date-fns';
import type { TimelineEpisode, TimelineStep } from './types';
import { DAY_MS } from './constants';

export interface TimeRange {
  t0: number;
  t1: number;
  rangeMs: number;
}

export function computeAutoRange(episodes: TimelineEpisode[], nowMs: number): TimeRange {
  let minT = nowMs - 7 * DAY_MS;
  let maxT = nowMs + 14 * DAY_MS;
  for (const ep of episodes) {
    if (ep.etaHeuristic) {
      const e = new Date(ep.etaHeuristic).getTime();
      if (!Number.isNaN(e)) maxT = Math.max(maxT, e + 14 * DAY_MS);
    }
    for (const s of ep.steps) {
      const candidates = [s.appointmentStart, s.windowStart, s.windowEnd].filter(Boolean) as string[];
      for (const c of candidates) {
        const t = new Date(c).getTime();
        if (!Number.isNaN(t)) {
          minT = Math.min(minT, t - 7 * DAY_MS);
          maxT = Math.max(maxT, t + 14 * DAY_MS);
        }
      }
    }
  }
  if (maxT <= minT) maxT = minT + DAY_MS;
  return { t0: minT, t1: maxT, rangeMs: maxT - minT };
}

export function computeFixedRange(zoomDays: number, nowMs: number): TimeRange {
  const t0 = nowMs - zoomDays * 0.35 * DAY_MS;
  const t1 = nowMs + zoomDays * 0.65 * DAY_MS;
  return { t0, t1, rangeMs: t1 - t0 };
}

export function getStepTimeRange(step: TimelineStep): { startMs: number; endMs: number } | null {
  const startStr = step.appointmentStart ?? step.windowStart;
  if (!startStr) return null;
  const start = new Date(startStr);
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) return null;

  let endMs: number;
  if (step.windowEnd) {
    endMs = new Date(step.windowEnd).getTime();
    if (Number.isNaN(endMs)) endMs = addMinutes(start, step.durationMinutes || 30).getTime();
  } else if (step.appointmentStart) {
    endMs = addMinutes(start, step.durationMinutes || 30).getTime();
  } else {
    endMs = addMinutes(start, step.durationMinutes || 30).getTime();
  }
  if (endMs <= startMs) endMs = startMs + 15 * 60 * 1000;
  return { startMs, endMs };
}

export function toPercent(tMs: number, range: TimeRange): number {
  return ((tMs - range.t0) / range.rangeMs) * 100;
}

export function clipBar(startMs: number, endMs: number, range: TimeRange): { left: number; width: number } {
  const s = Math.max(startMs, range.t0);
  const e = Math.min(endMs, range.t1);
  if (e <= s) return { left: toPercent(startMs, range), width: 0.8 };
  return {
    left: toPercent(s, range),
    width: Math.max(((e - s) / range.rangeMs) * 100, 1.2),
  };
}

export function minTrackWidthPx(zoom: string, range: TimeRange): number {
  if (zoom === 'auto') {
    const days = range.rangeMs / DAY_MS;
    return Math.max(720, Math.min(2400, days * 24));
  }
  if (zoom === '14d') return 560;
  if (zoom === '90d') return 1440;
  return 960;
}
