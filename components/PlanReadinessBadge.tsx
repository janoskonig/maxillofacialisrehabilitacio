'use client';

import { CalendarClock, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import type { PlanReadinessStatus } from '@/lib/treatment-plan-validation';

export interface PlanReadinessBadgeProps {
  status: PlanReadinessStatus | null;
  errorCount?: number;
  /** Gap A: lefoglalt időpontok, amelyek a terv sorrendje elé csúsztak. */
  sequenceViolations?: number;
  /** Compact icon-only (lists) vs. icon + short label. */
  variant?: 'icon' | 'label';
}

const CONFIG: Record<
  PlanReadinessStatus,
  { Icon: typeof CheckCircle2; cls: string; label: string; title: string }
> = {
  errors: { Icon: XCircle, cls: 'text-red-600 dark:text-red-300', label: 'Hibás', title: 'A kezelési terv hibát tartalmaz' },
  approved: { Icon: ShieldCheck, cls: 'text-emerald-600 dark:text-emerald-300', label: 'Jóváhagyva', title: 'A kezelési terv jóváhagyva' },
  ready: { Icon: CheckCircle2, cls: 'text-emerald-500 dark:text-emerald-400', label: 'Foglalásra kész', title: 'A kezelési terv foglalásra kész' },
};

/**
 * Compact plan-readiness indicator for list rows (Gantt, worklist). Renders nothing
 * when status is null (no plan / empty plan / not loaded yet).
 * WP-1.1: warning-szint nincs — errors | approved | ready.
 */
export function PlanReadinessBadge({
  status,
  errorCount,
  sequenceViolations = 0,
  variant = 'icon',
}: PlanReadinessBadgeProps) {
  const hasSequence = sequenceViolations > 0;
  if (!status && !hasSequence) return null;

  const cfg = status ? CONFIG[status] : null;
  const count = status === 'errors' ? errorCount : undefined;
  const fullTitle = cfg ? (count ? `${cfg.title} (${count})` : cfg.title) : '';
  const seqTitle = `${sequenceViolations} lefoglalt időpont a terv sorrendje elé csúszott — újrafoglalandó`;

  return (
    <span className="inline-flex items-center gap-1">
      {cfg && (
        <span className={`inline-flex items-center gap-1 ${cfg.cls}`} title={fullTitle} aria-label={fullTitle}>
          <cfg.Icon className="w-3.5 h-3.5 shrink-0" />
          {variant === 'label' && <span className="text-xs font-medium">{cfg.label}</span>}
        </span>
      )}
      {hasSequence && (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-300" title={seqTitle} aria-label={seqTitle}>
          <CalendarClock className="w-3.5 h-3.5 shrink-0" />
          {variant === 'label' && <span className="text-xs font-medium">Sorrend</span>}
        </span>
      )}
    </span>
  );
}
