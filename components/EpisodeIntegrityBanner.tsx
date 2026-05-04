'use client';

/**
 * EpisodeIntegrityBanner — megjeleníti a `scheduling-integrity` API által
 * felderített hibákat (EWP_DANGLING_APPOINTMENT_LINK,
 * APPOINTMENT_STEP_MISMATCH, stb.) és lehetőséget ad a javítás
 * elindítására (POST /api/episodes/:id/scheduling-integrity).
 *
 * A banner csak akkor jelenik meg, ha van legalább egy violation — üres
 * állapotban null-ra renderel, így nem foglal helyet a UI-ban.
 *
 * Nem nyúl a slothoz és nem törli a foglalást. Csak stale linkek
 * tisztítása (ewp.appointment_id → NULL, scheduled → pending) és a
 * step_code / step_seq snapshot frissítése az EWP szerint.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, CheckCircle2 } from 'lucide-react';

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
  workPhaseIds?: string[];
  details?: Array<Record<string, unknown>>;
  repairable?: boolean;
}

interface IntegrityPayload {
  episodeId: string;
  violations: Violation[];
  ok: boolean;
}

export interface EpisodeIntegrityBannerProps {
  /** Az epizód ID-k, amelyekre az integrity-check-et le kell futtatni. */
  episodeIds: string[];
  /**
   * A szülő komponens frissíti a worklistet, ha a repair után új
   * adatot akarunk mutatni (dangling link takarítása után a Kontroll 2 sor
   * pl. READY-ként marad, de az auto-matching már nem „bujkál").
   */
  onRepaired?: () => void | Promise<void>;
}

const VIOLATION_LABELS: Record<ViolationKind, string> = {
  ONE_HARD_NEXT_VIOLATION: 'Egyszerre több jövőbeli munkafoglalás',
  INTENT_OPEN_EPISODE_CLOSED: 'Nyitott intent lezárt epizódhoz',
  APPOINTMENT_NO_SLOT: 'Foglalás slot nélkül',
  SLOT_DOUBLE_BOOKED: 'Slot kétszeresen foglalt',
  EWP_DANGLING_APPOINTMENT_LINK: 'Stale foglalás-hivatkozás munkafázison',
  APPOINTMENT_STEP_MISMATCH: 'step_code eltér a hozzá kötött munkafázistól',
};

export function EpisodeIntegrityBanner({
  episodeIds,
  onRepaired,
}: EpisodeIntegrityBannerProps) {
  const [payloads, setPayloads] = useState<IntegrityPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [repairingEpisodeId, setRepairingEpisodeId] = useState<string | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [lastRepairSummary, setLastRepairSummary] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (episodeIds.length === 0) {
      setPayloads([]);
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        episodeIds.map(async (id) => {
          try {
            const res = await fetch(
              `/api/episodes/${id}/scheduling-integrity`,
              { credentials: 'include' }
            );
            if (!res.ok) return null;
            const data = (await res.json()) as IntegrityPayload;
            return data;
          } catch {
            return null;
          }
        })
      );
      setPayloads(results.filter((r): r is IntegrityPayload => r !== null));
    } finally {
      setLoading(false);
    }
  }, [episodeIds]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const episodesWithViolations = payloads.filter((p) => !p.ok);
  const totalCount = episodesWithViolations.reduce(
    (sum, p) => sum + p.violations.length,
    0
  );

  const repair = async (episodeId: string) => {
    setRepairingEpisodeId(episodeId);
    setRepairError(null);
    try {
      const res = await fetch(
        `/api/episodes/${episodeId}/scheduling-integrity`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reason: 'Automatikus javítás a worklist banner-ből' }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? 'Javítás sikertelen');
      }
      setLastRepairSummary(
        `Javítva: ${data.danglingCleared ?? 0} stale link, ${data.mismatchRepaired ?? 0} step-kód eltérés`
      );
      await loadAll();
      if (onRepaired) await onRepaired();
    } catch (e) {
      setRepairError(e instanceof Error ? e.message : 'Hiba történt');
    } finally {
      setRepairingEpisodeId(null);
    }
  };

  if (loading && payloads.length === 0) {
    return null;
  }

  if (episodesWithViolations.length === 0) {
    if (lastRepairSummary) {
      return (
        <div className="flex items-start gap-2 p-2 bg-green-50 border border-green-200 rounded text-sm">
          <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-green-900">Integritás rendben</div>
            <div className="text-xs text-green-800">{lastRepairSummary}</div>
          </div>
          <button
            type="button"
            onClick={() => setLastRepairSummary(null)}
            className="text-xs text-green-700 hover:underline"
          >
            bezár
          </button>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm space-y-2">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-medium text-amber-900">
            Integritás-figyelmeztetés — {totalCount} ügy {episodesWithViolations.length} epizódban
          </div>
          <div className="text-xs text-amber-900/80 mt-0.5">
            Az adatban inkonzisztencia maradt (pl. stale foglalás-hivatkozás vagy
            step-kód eltérés). A „Javítás" gomb biztonságosan rendbe teszi
            (nem nyúl a slothoz és a foglalás státuszához).
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-amber-900 hover:underline"
        >
          {expanded ? 'összecsuk' : 'részletek'}
        </button>
      </div>

      {repairError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          {repairError}
        </div>
      )}

      {expanded && (
        <div className="space-y-2 pt-1">
          {episodesWithViolations.map((ep) => {
            const repairable = ep.violations.some((v) => v.repairable);
            const isRepairing = repairingEpisodeId === ep.episodeId;
            return (
              <div
                key={ep.episodeId}
                className="border border-amber-200 bg-white/60 rounded p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-600">
                    Epizód{' '}
                    <code className="text-gray-800">
                      {ep.episodeId.slice(0, 8)}
                    </code>
                  </div>
                  {repairable && (
                    <button
                      type="button"
                      onClick={() => repair(ep.episodeId)}
                      disabled={isRepairing}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-medical-primary text-white rounded hover:opacity-90 disabled:opacity-50"
                      title="Stale linkek takarítása + step-kód eltérések javítása"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${isRepairing ? 'animate-spin' : ''}`}
                      />
                      {isRepairing ? 'Javítás…' : 'Javítás'}
                    </button>
                  )}
                </div>
                <ul className="mt-1 space-y-1">
                  {ep.violations.map((v, idx) => (
                    <li
                      key={`${v.kind}-${idx}`}
                      className="text-xs text-amber-900"
                    >
                      <span className="font-medium">
                        {VIOLATION_LABELS[v.kind] ?? v.kind}:
                      </span>{' '}
                      {v.message}
                      {v.details && v.details.length > 0 && (
                        <ul className="ml-4 mt-0.5 list-disc marker:text-amber-600">
                          {v.details.map((d, i) => (
                            <li key={i} className="font-mono text-[11px] text-amber-900/80">
                              {JSON.stringify(d)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
