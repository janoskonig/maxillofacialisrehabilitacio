import type { TimelineEpisode, TimelineStep, TimelineMetaCounts } from './types';
import { getStepTimeRange } from './timeline-math';

const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/** Figyelmet igényel: 7 napon belül esedékes foglalt, vagy tervezett (múltbeli ablak / közeli ablak). */
export function episodeNeedsAttention(ep: TimelineEpisode, nowMs: number): boolean {
  const horizon = nowMs + HORIZON_MS;
  for (const s of ep.steps) {
    if (s.status === 'booked') {
      const ref = s.appointmentStart;
      if (ref) {
        const t = new Date(ref).getTime();
        if (!Number.isNaN(t) && t >= nowMs && t <= horizon) return true;
      }
    }
    if (s.status === 'planned') {
      const we = s.windowEnd ? new Date(s.windowEnd).getTime() : NaN;
      if (!Number.isNaN(we) && we < nowMs) return true;
      const ws = s.windowStart ? new Date(s.windowStart).getTime() : NaN;
      if (!Number.isNaN(ws) && !Number.isNaN(we)) {
        if (we >= nowMs && ws <= horizon) return true;
      } else if (!Number.isNaN(ws) && ws >= nowMs && ws <= horizon) return true;
      else if (!Number.isNaN(we) && we >= nowMs && we <= horizon) return true;
    }
  }
  return false;
}

export function computeNextTodo(ep: TimelineEpisode, nowMs: number): {
  step: TimelineStep;
  whenMs: number;
  relativeLabel: string;
} | null {
  const candidates: { step: TimelineStep; whenMs: number }[] = [];
  for (const s of ep.steps) {
    if (s.status === 'completed') continue;
    const tr = getStepTimeRange(s);
    if (tr && (s.status === 'booked' || s.status === 'planned')) {
      candidates.push({ step: s, whenMs: tr.startMs });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.whenMs - b.whenMs);
  const best = candidates[0];
  const d0 = new Date(nowMs);
  d0.setHours(0, 0, 0, 0);
  const d1 = new Date(best.whenMs);
  d1.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((d1.getTime() - d0.getTime()) / (24 * 60 * 60 * 1000));
  let relativeLabel: string;
  if (dayDiff === 0) relativeLabel = 'Ma';
  else if (dayDiff === 1) relativeLabel = 'Holnap';
  else if (dayDiff > 1 && dayDiff <= 7) relativeLabel = `${dayDiff} nap múlva`;
  else if (dayDiff < 0) relativeLabel = `${-dayDiff} napja esedékes`;
  else relativeLabel = d1.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
  return { step: best.step, whenMs: best.whenMs, relativeLabel };
}

export function fallbackCounts(episodes: TimelineEpisode[], nowMs: number): TimelineMetaCounts {
  let actionNeededIn7d = 0;
  for (const ep of episodes) {
    if (episodeNeedsAttention(ep, nowMs)) actionNeededIn7d++;
  }
  return {
    totalEpisodes: episodes.length,
    actionNeededIn7d,
  };
}
