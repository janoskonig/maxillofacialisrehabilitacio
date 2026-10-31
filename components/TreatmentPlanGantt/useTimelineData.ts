import { useState, useEffect, useMemo } from 'react';
import type { AftercareWorkspace } from '@/lib/aftercare/model';
import { withAftercareTimeline } from '@/lib/treatment-workspace';
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
  patientId?: string;
  episodeId?: string;
  enabled?: boolean;
  refreshTrigger?: number;
  careWorkspace?: AftercareWorkspace | null;
}

export function useTimelineData({ status, providerId, searchDebounced, patientId, episodeId, enabled = true, refreshTrigger, careWorkspace }: UseTimelineDataOptions) {
  const [episodes, setEpisodes] = useState<TimelineEpisode[]>([]);
  const [meta, setMeta] = useState<TimelineMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localCare, setLocalCare] = useState<AftercareWorkspace | null>(null);
  const [careError, setCareError] = useState<string | null>(null);
  const ownsCareFetch = !!patientId && careWorkspace === undefined;
  useEffect(() => {
    setLocalCare(null);
    setCareError(null);
    if (!enabled || !ownsCareFetch || !patientId) return;
    const controller = new AbortController();
    fetch(`/api/patients/${patientId}/aftercare`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error('A gondozási vizitek nem tölthetők be; az idővonal hiányos.'); return res.json(); })
      .then((data) => { if (!controller.signal.aborted) setLocalCare(data); })
      .catch((e) => { if (!controller.signal.aborted) setCareError(e.message); });
    return () => controller.abort();
  }, [enabled, ownsCareFetch, patientId, refreshTrigger]);

  useEffect(() => {
    if (!enabled) { setEpisodes([]); setMeta(null); setLoading(false); return; }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const q = new URLSearchParams();
        q.set('status', status);
        q.set('limit', '200');
        // Egyesített „betegút" nézet: aktív kezelések (gondozás kizárva),
        // a kezelés kezdete szerint növekvő sorrendben.
        if (!patientId) q.set('activeOnly', '1');
        if (patientId) q.set('patientId', patientId);
        if (episodeId) q.set('episodeId', episodeId);
        q.set('ordering', 'start_asc');
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
  }, [status, providerId, searchDebounced, patientId, episodeId, enabled, refreshTrigger]);

  const sharedEpisodes = useMemo(() => episodes.map((ep) => withAftercareTimeline(ep, careWorkspace ?? localCare)), [episodes, careWorkspace, localCare]);
  return { episodes: sharedEpisodes, meta, loading, error, careError };
}
