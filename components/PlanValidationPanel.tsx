'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, ShieldCheck, ShieldOff, XCircle } from 'lucide-react';

interface PlanIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  workPhaseCode?: string;
}

interface SequenceViolation {
  workPhaseCode: string;
  label?: string | null;
  bookedStart: string;
  blockingWorkPhaseCode: string;
  reason: string;
  message: string;
}

interface PlanValidationResponse {
  issues: PlanIssue[];
  approvable: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  sequenceViolations?: SequenceViolation[];
}

export interface PlanValidationPanelProps {
  episodeId: string;
  /** Optional — enables the "rebook on worklist" link from sequence-violation flags. */
  patientId?: string;
  /** Changes whenever the plan steps change → triggers a re-validation. */
  signature: string;
  /** Whether the current user may approve/revoke (write roles). */
  canEdit?: boolean;
}

/**
 * WP3: surfaces treatment-plan validation issues and the "approved / ready to book"
 * state for an episode. Re-validates whenever `signature` changes (i.e. after any
 * step edit in EpisodeStepsManager).
 */
export function PlanValidationPanel({ episodeId, patientId, signature, canEdit = true }: PlanValidationPanelProps) {
  const [data, setData] = useState<PlanValidationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/plan-validation`);
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      /* ignore — non-critical UI */
    } finally {
      setLoading(false);
    }
  }, [episodeId]);

  // Re-validate on mount and whenever the plan changes.
  useEffect(() => {
    void load();
  }, [load, signature]);

  const approve = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/plan-validation`, { method: 'POST' });
      if (res.ok) setData(await res.json());
    } finally {
      setActing(false);
    }
  };

  const revoke = async () => {
    setActing(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/plan-validation`, { method: 'DELETE' });
      if (res.ok) await load();
    } finally {
      setActing(false);
    }
  };

  if (loading || !data) return null;

  const errors = data.issues.filter((i) => i.level === 'error');
  const warnings = data.issues.filter((i) => i.level === 'warning');
  const clean = data.issues.length === 0;
  const approved = Boolean(data.approvedAt);

  return (
    <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden text-sm">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
        <div className="flex items-center gap-2 min-w-0">
          {approved ? (
            <>
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-medium text-emerald-700">Terv jóváhagyva</span>
              <span className="text-gray-500 dark:text-gray-400 truncate">
                {new Date(data.approvedAt as string).toLocaleString('hu-HU')}
              </span>
            </>
          ) : clean ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-medium text-emerald-700">A terv rendben — foglalásra kész</span>
            </>
          ) : errors.length > 0 ? (
            <>
              <XCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span className="font-medium text-red-700">
                {errors.length} hiba{warnings.length > 0 ? `, ${warnings.length} figyelmeztetés` : ''}
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="font-medium text-amber-700">{warnings.length} figyelmeztetés</span>
            </>
          )}
        </div>

        {canEdit && (
          <div className="shrink-0">
            {approved ? (
              <button
                onClick={revoke}
                disabled={acting}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {acting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldOff className="w-3 h-3" />}
                Jóváhagyás visszavonása
              </button>
            ) : (
              <button
                onClick={approve}
                disabled={acting || !data.approvable}
                title={data.approvable ? '' : 'Előbb javítsd a hibákat'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {acting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                Terv jóváhagyása
              </button>
            )}
          </div>
        )}
      </div>

      {data.issues.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {[...errors, ...warnings].map((issue, idx) => (
            <li key={`${issue.code}-${issue.workPhaseCode ?? idx}`} className="flex items-start gap-2 px-3 py-1.5">
              {issue.level === 'error' ? (
                <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              )}
              <span className="text-gray-700 dark:text-gray-300">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}

      {(data.sequenceViolations?.length ?? 0) > 0 && (
        <div className="border-t border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-medium">
              <CalendarClock className="w-3.5 h-3.5 shrink-0" />
              Sorrend-eltérés a lefoglalt időpontokban — újrafoglalás szükséges
            </span>
            {patientId && (
              <a
                href={`/patients/${patientId}/view`}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300 underline hover:text-amber-900 dark:hover:text-amber-200"
              >
                Újrafoglalás a munkalistán →
              </a>
            )}
          </div>
          <ul className="divide-y divide-amber-100 dark:divide-amber-900">
            {data.sequenceViolations!.map((v, idx) => (
              <li key={`${v.workPhaseCode}-${idx}`} className="flex items-start gap-2 px-3 py-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                <span className="text-gray-700 dark:text-gray-300">{v.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
