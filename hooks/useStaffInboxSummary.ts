'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export type StaffInboxSummaryState = {
  patientUnread: number;
  doctorUnread: number;
};

export function useStaffInboxSummary(enabled: boolean) {
  const pathname = usePathname();
  const [summary, setSummary] = useState<StaffInboxSummaryState | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await fetch('/api/messages/staff-inbox-summary', { credentials: 'include' });
      if (!res.ok) {
        setSummary(null);
        return;
      }
      const data = await res.json();
      setSummary({
        patientUnread: data.patientUnread ?? 0,
        doctorUnread: data.doctorUnread ?? 0,
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
