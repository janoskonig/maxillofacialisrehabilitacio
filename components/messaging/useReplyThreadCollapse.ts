'use client';

import { useCallback, useState } from 'react';

/**
 * Fázis 4.2 — Szál összecsukás / kinyitás állapot.
 * A `collapsedRoots` halmazban lévő parent ID-k közvetlen válaszai rejtve maradnak.
 */
export function useReplyThreadCollapse() {
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(() => new Set());

  const isCollapsed = useCallback(
    (parentMessageId: string) => collapsedRoots.has(parentMessageId),
    [collapsedRoots],
  );

  const toggleThread = useCallback((parentMessageId: string) => {
    setCollapsedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(parentMessageId)) {
        next.delete(parentMessageId);
      } else {
        next.add(parentMessageId);
      }
      return next;
    });
  }, []);

  const expandThread = useCallback((parentMessageId: string) => {
    setCollapsedRoots((prev) => {
      if (!prev.has(parentMessageId)) return prev;
      const next = new Set(prev);
      next.delete(parentMessageId);
      return next;
    });
  }, []);

  const resetThreads = useCallback(() => {
    setCollapsedRoots(new Set());
  }, []);

  return { collapsedRoots, isCollapsed, toggleThread, expandThread, resetThreads };
}
