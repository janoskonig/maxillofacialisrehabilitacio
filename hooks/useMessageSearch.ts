'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageChannel, MessageSearchHit, MessageSearchResult } from '@/lib/types/messaging';

const DEBOUNCE_MS = 250;

export interface MessageSearchFilterState {
  q: string;
  patientId?: string;
  recipientId?: string;
  groupId?: string;
  doctorId?: string;
  from?: string;
  to?: string;
  sender?: string;
  hasAttachment?: boolean;
}

function buildSearchUrl(channel: MessageChannel, filters: MessageSearchFilterState): string {
  const base =
    channel === 'patient' ? '/api/messages/search' : '/api/doctor-messages/search';
  const sp = new URLSearchParams();
  sp.set('q', filters.q.trim());
  if (filters.patientId) sp.set('patientId', filters.patientId);
  if (filters.recipientId) sp.set('recipientId', filters.recipientId);
  if (filters.groupId) sp.set('groupId', filters.groupId);
  if (filters.doctorId) sp.set('doctorId', filters.doctorId);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.sender) sp.set('sender', filters.sender);
  if (filters.hasAttachment) sp.set('hasAttachment', 'true');
  sp.set('limit', '25');
  return `${base}?${sp.toString()}`;
}

function parseHitDates(hits: MessageSearchHit[]): MessageSearchHit[] {
  return hits.map((h) => ({
    ...h,
    createdAt: h.createdAt instanceof Date ? h.createdAt : new Date(h.createdAt as unknown as string),
  }));
}

export function useMessageSearch(
  channel: MessageChannel,
  options?: {
    defaultFilters?: Partial<MessageSearchFilterState>;
    enabled?: boolean;
  },
) {
  const enabled = options?.enabled ?? true;
  const [filters, setFilters] = useState<MessageSearchFilterState>(() => ({
    q: '',
    ...options?.defaultFilters,
  }));
  const [hits, setHits] = useState<MessageSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (nextFilters: MessageSearchFilterState) => {
      const q = nextFilters.q.trim();
      if (q.length < 2) {
        setHits([]);
        setTotal(0);
        setError(null);
        setLoading(false);
        return;
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(buildSearchUrl(channel, nextFilters), {
          credentials: 'include',
          signal: ac.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Keresés sikertelen');
        }
        const result = data as MessageSearchResult & { success?: boolean };
        setHits(parseHitDates(result.hits ?? []));
        setTotal(result.total ?? 0);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setHits([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : 'Keresés sikertelen');
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [channel],
  );

  useEffect(() => {
    if (!enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(filters);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, enabled, runSearch]);

  const setQuery = useCallback((q: string) => {
    setFilters((prev) => ({ ...prev, q }));
  }, []);

  const patchFilters = useCallback((patch: Partial<MessageSearchFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback(
    (defaults?: Partial<MessageSearchFilterState>) => {
      setFilters({ q: '', ...options?.defaultFilters, ...defaults });
      setHits([]);
      setTotal(0);
      setError(null);
    },
    [options?.defaultFilters],
  );

  return {
    filters,
    hits,
    total,
    loading,
    error,
    setQuery,
    patchFilters,
    resetFilters,
    refresh: () => runSearch(filters),
  };
}
