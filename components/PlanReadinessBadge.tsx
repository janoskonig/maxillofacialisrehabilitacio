'use client';

import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import type { PlanReadinessStatus } from '@/lib/treatment-plan-validation';

export interface PlanReadinessBadgeProps {
  status: PlanReadinessStatus | null;
  errorCount?: number;
  warningCount?: number;
  /** Compact icon-only (lists) vs. icon + short label. */
  variant?: 'icon' | 'label';
}

const CONFIG: Record<
  PlanReadinessStatus,
  { Icon: typeof CheckCircle2; cls: string; label: string; title: string }
> = {
  errors: { Icon: XCircle, cls: 'text-red-600', label: 'Hibás', title: 'A kezelési terv hibát tartalmaz' },
  warnings: { Icon: AlertTriangle, cls: 'text-amber-500', label: 'Ellenőrzendő', title: 'A kezelési terv figyelmeztetést tartalmaz' },
  approved: { Icon: ShieldCheck, cls: 'text-emerald-600', label: 'Jóváhagyva', title: 'A kezelési terv jóváhagyva' },
  ready: { Icon: CheckCircle2, cls: 'text-emerald-500', label: 'Foglalásra kész', title: 'A kezelési terv foglalásra kész' },
};

/**
 * Compact plan-readiness indicator for list rows (Gantt, worklist). Renders nothing
 * when status is null (no plan / not loaded yet).
 */
export function PlanReadinessBadge({ status, errorCount, warningCount, variant = 'icon' }: PlanReadinessBadgeProps) {
  if (!status) return null;
  const { Icon, cls, label, title } = CONFIG[status];
  const count = status === 'errors' ? errorCount : status === 'warnings' ? warningCount : undefined;
  const fullTitle = count ? `${title} (${count})` : title;

  return (
    <span className={`inline-flex items-center gap-1 ${cls}`} title={fullTitle} aria-label={fullTitle}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {variant === 'label' && <span className="text-xs font-medium">{label}</span>}
    </span>
  );
}
