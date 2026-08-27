'use client';

/**
 * Ütemezési integritás — admin fül (WP-1.2).
 *
 * A betegkartonról kivezetett integritás-figyelmeztetések itt élnek tovább:
 * a scan (GET /api/admin/scheduling-integrity) először automatikusan rendbe
 * teszi a javítható violationöket (stale foglalás-link, step_code eltérés),
 * majd a MARADÉKOT listázza epizódonként, technikai nyelvezettel és
 * beteg-linkkel. A lista tisztán diagnosztikai — semmit nem blokkol.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Loader2,
  Wrench,
} from 'lucide-react';

type ViolationKind =
  | 'ONE_HARD_NEXT_VIOLATION'
  | 'INTENT_OPEN_EPISODE_CLOSED'
  | 'APPOINTMENT_NO_SLOT'
  | 'SLOT_DOUBLE_BOOKED'
  | 'EWP_DANGLING_APPOINTMENT_LINK'
  | 'APPOINTMENT_STEP_MISMATCH';

interface Violation {
  kind: ViolationKind;
  message: string;
  appointmentIds?: string[];
  slotIds?: string[];
  intentIds?: string[];
  workPhaseIds?: string[];
  details?: Array<Record<string, unknown>>;
  repairable?: boolean;
}

interface EpisodeReport {
  episodeId: string;
  episodeStatus: string;
  patientId: string | null;
  patientName: string | null;
  violations: Violation[];
}

interface ScanPayload {
  generatedAt: string;
  autoRepair: {
    candidateEpisodes: number;
    repairedEpisodes: number;
    danglingCleared: number;
    mismatchRepaired: number;
    capped: boolean;
  };
  episodes: EpisodeReport[];
  truncated: boolean;
  ok: boolean;
}

const VIOLATION_LABELS: Record<ViolationKind, string> = {
  ONE_HARD_NEXT_VIOLATION: 'Egyszerre több jövőbeli munkafoglalás',
  INTENT_OPEN_EPISODE_CLOSED: 'Nyitott intent lezárt epizódhoz',
  APPOINTMENT_NO_SLOT: 'Foglalás slot nélkül',
  SLOT_DOUBLE_BOOKED: 'Slot kétszeresen foglalt',
  EWP_DANGLING_APPOINTMENT_LINK: 'Stale foglalás-hivatkozás munkafázison',
  APPOINTMENT_STEP_MISMATCH: 'step_code eltér a hozzá kötött munkafázistól',
};

export function SchedulingIntegrityPanel() {
  const [payload, setPayload] = useState<ScanPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/scheduling-integrity', {
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'A scan futtatása nem sikerült');
        return;
      }
      setPayload(data as ScanPayload);
    } catch {
      setError('Hálózati hiba');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const totalViolations =
    payload?.episodes.reduce((sum, ep) => sum + ep.violations.length, 0) ?? 0;
  const autoRepairedSomething =
    (payload?.autoRepair.danglingCleared ?? 0) > 0 ||
    (payload?.autoRepair.mismatchRepaired ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
          DB-konzisztencia a munkafázis ↔ foglalás ↔ slot-intent gráfon. A
          javítható eltéréseket (stale foglalás-link, step_code eltérés) a
          rendszer automatikusan rendbe teszi — a scan is lefuttatja őket —,
          az itt látható lista a kézi figyelmet igénylő maradék. A
          betegkartonon ezek szándékosan nem jelennek meg.
        </p>
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-medical-primary rounded hover:opacity-90 disabled:opacity-50 shrink-0"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Scan futtatása
        </button>
      </div>

      {error && (
        <div className="p-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !payload && (
        <p className="text-sm text-gray-500 dark:text-gray-400">Scan fut…</p>
      )}

      {payload && (
        <>
          {autoRepairedSomething && (
            <div className="flex items-start gap-2 p-3 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-sm">
              <Wrench className="w-4 h-4 text-blue-700 dark:text-blue-300 shrink-0 mt-0.5" />
              <div className="text-blue-900 dark:text-blue-200">
                <span className="font-medium">Automatikus javítás ebben a futásban:</span>{' '}
                {payload.autoRepair.danglingCleared} stale foglalás-link takarítva,{' '}
                {payload.autoRepair.mismatchRepaired} step-kód eltérés javítva (
                {payload.autoRepair.repairedEpisodes} epizód).
                {payload.autoRepair.capped && (
                  <span className="block mt-1 text-blue-800/90 dark:text-blue-300/90">
                    A javítás-korlát miatt nem minden érintett epizód került
                    sorra — futtasd újra a scant.
                  </span>
                )}
              </div>
            </div>
          )}

          {payload.episodes.length === 0 ? (
            <div className="flex items-start gap-2 p-3 rounded border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-sm">
              <ShieldCheck className="w-4 h-4 text-green-700 dark:text-green-300 shrink-0 mt-0.5" />
              <div className="text-green-900 dark:text-green-200">
                <span className="font-medium">Nincs függő integritás-ügy.</span>{' '}
                <span className="text-green-800/90 dark:text-green-300/90">
                  Utolsó scan:{' '}
                  {new Date(payload.generatedAt).toLocaleString('hu-HU')}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
                <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-300" />
                <span className="font-medium">
                  {totalViolations} ügy {payload.episodes.length} epizódban
                </span>
                {payload.truncated && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    (csonkolt lista — futtasd újra a scant a folytatáshoz)
                  </span>
                )}
              </div>

              {payload.episodes.map((ep) => (
                <div
                  key={ep.episodeId}
                  className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {ep.patientName ?? 'Ismeretlen beteg'}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Epizód{' '}
                        <code className="text-gray-700 dark:text-gray-300">
                          {ep.episodeId.slice(0, 8)}
                        </code>{' '}
                        · {ep.episodeStatus}
                      </span>
                    </div>
                    {ep.patientId && (
                      <Link
                        href={`/patients/${ep.patientId}/stages`}
                        className="inline-flex items-center gap-1 text-xs text-medical-primary hover:underline font-medium shrink-0"
                      >
                        Beteg kartonja
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {ep.violations.map((v, idx) => (
                      <li
                        key={`${v.kind}-${idx}`}
                        className="text-xs text-gray-700 dark:text-gray-300"
                      >
                        <span className="font-medium text-amber-900 dark:text-amber-200">
                          {VIOLATION_LABELS[v.kind] ?? v.kind}:
                        </span>{' '}
                        {v.message}
                        {v.details && v.details.length > 0 && (
                          <ul className="ml-4 mt-0.5 list-disc marker:text-gray-400 dark:marker:text-gray-500 space-y-0.5">
                            {v.details.map((d, i) => (
                              <li
                                key={i}
                                className="font-mono text-[11px] text-gray-500 dark:text-gray-400 break-all"
                              >
                                {JSON.stringify(d)}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(v.appointmentIds?.length ?? 0) > 0 && !v.details && (
                          <span className="block ml-4 mt-0.5 font-mono text-[11px] text-gray-500 dark:text-gray-400 break-all">
                            appointments: {v.appointmentIds?.join(', ')}
                          </span>
                        )}
                        {(v.intentIds?.length ?? 0) > 0 && (
                          <span className="block ml-4 mt-0.5 font-mono text-[11px] text-gray-500 dark:text-gray-400 break-all">
                            intents: {v.intentIds?.join(', ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
