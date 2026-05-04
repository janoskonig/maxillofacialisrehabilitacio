import { useMemo } from 'react';
import type { TimelineEpisode, ZoomPreset } from './types';
import { computeAutoRange, computeFixedRange, toPercent } from './timeline-math';

function zoomToDays(z: ZoomPreset): number {
  if (z === '14d') return 14;
  if (z === '90d') return 90;
  if (z === 'auto') return 30;
  return 30;
}

export function useTimelineRange(zoom: ZoomPreset, episodes: TimelineEpisode[], serverNowIso: string | null) {
  return useMemo(() => {
    const nowMs = serverNowIso ? new Date(serverNowIso).getTime() : Date.now();
    const range = zoom === 'auto' ? computeAutoRange(episodes, nowMs) : computeFixedRange(zoomToDays(zoom), nowMs);

    const pct = (tMs: number) => toPercent(tMs, range);

    return {
      ...range,
      nowMs,
      toPercent: pct,
      toPercentWidth: (startMs: number, endMs: number) => ((endMs - startMs) / range.rangeMs) * 100,
      todayPercent: pct(nowMs),
    };
  }, [zoom, episodes, serverNowIso]);
}
