'use client';

import { useEffect, useState } from 'react';
import type { PlanReadinessStatus } from '@/lib/treatment-plan-validation';

export interface PlanReadinessEntry {
  status: PlanReadinessStatus;
  errorCount: number;
  warningCount: number;
  approved: boolean;
}

/**
 * Fetch treatment-plan readiness for a set of episodes in one batch request
 * (WP6a). Returns a map keyed by episodeId; empty until loaded. Re-fetches when the
 * set of ids changes.
 */
export function usePlanReadiness(episodeIds: string[]): Map<string, PlanReadinessEntry> {
  const [map, setMap] = useState<Map<string, PlanReadinessEntry>>(new Map());
  // Stable dependency: sorted, de-duped id list as a string.
  const key = Array.from(new Set(episodeIds)).sort().join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/episodes/plan-validation/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeIds: ids }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Record<string, PlanReadinessEntry>;
        if (!cancelled) setMap(new Map(Object.entries(data)));
      } catch {
        /* non-critical UI enhancement */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return map;
}
