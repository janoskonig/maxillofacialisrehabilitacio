'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export type StaffTaskSummaryState = {
  totalOpen: number;
  unviewed: number;
  viewedOpen: number;
};

export function useStaffTaskSummary(enabled: boolean) {
  const pathname = usePathname();
  const [summary, setSummary] = useState<StaffTaskSummaryState | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await fetch('/api/user-tasks/summary', { credentials: 'include' });
      if (!res.ok) {
        setSummary(null);
        return;
      }
      const data = await res.json();
      setSummary({
        totalOpen: data.totalOpen ?? 0,
        unviewed: data.unviewed ?? 0,
        viewedOpen: data.viewedOpen ?? 0,
      });
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setSummary(null);
      return;
    }
    refetch();
  }, [enabled, pathname, refetch]);

  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, refetch]);

  return { summary, loading, refetch };
}
