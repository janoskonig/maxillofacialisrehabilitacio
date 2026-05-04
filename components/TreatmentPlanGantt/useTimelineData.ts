import { useState, useEffect } from 'react';
import type { TimelineEpisode, TimelineMeta, EpisodeStatusFilter, TimelineStepStatus } from './types';

function normalizeStepStatus(raw: unknown): TimelineStepStatus {
  if (raw === 'completed') return 'completed';
  if (raw === 'booked' || raw === 'in_progress') return 'booked';
  return 'planned';
}

function normalizeEpisodes(raw: unknown): TimelineEpisode[] {
  const list = (Array.isArray(raw) ? raw : []) as TimelineEpisode[];
  return list.map((ep) => ({
    ...ep,
    steps: (ep.steps ?? []).map((s) => ({
      ...s,
      status: normalizeStepStatus(s.status),
    })),
  }));
}

export interface UseTimelineDataOptions {
  status: EpisodeStatusFilter;
  providerId: string;
  searchDebounced: string;
}

export function useTimelineData({ status, providerId, searchDebounced }: UseTimelineDataOptions) {
  const [episodes, setEpisodes] = useState<TimelineEpisode[]>([]);
  const [meta, setMeta] = useState<TimelineMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const q = new URLSearchParams();
        q.set('status', status);
        q.set('limit', '200');
        if (providerId) q.set('providerId', providerId);
        const s = searchDebounced.trim();
        if (s) q.set('search', s);
        const res = await fetch(`/api/treatment-plan-timeline?${q.toString()}`, {
          credentials: 'include',
          signal: ac.signal,
        });
        if (!res.ok) throw new Error('Nem sikerült betölteni');
        const data = await res.json();
        if (!ac.signal.aborted) {
          setEpisodes(normalizeEpisodes(data.episodes));
          setMeta(data.meta ?? null);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (!ac.signal.aborted) {
          setError(e instanceof Error ? e.message : 'Ismeretlen hiba');
          setEpisodes([]);
          setMeta(null);
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [status, providerId, searchDebounced]);

  return { episodes, meta, loading, error };
}
