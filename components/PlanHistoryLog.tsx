'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, History, Loader2 } from 'lucide-react';
import type { PlanHistoryEntry } from '@/lib/plan-history';

/**
 * WP-2.2 — „A terv változásai (N)": lecsukott <details> a terv-kártya alján.
 *
 * Csak olvasható napló (visszavonás-gomb nincs). A lista LUSTÁN töltődik: a
 * fetch csak az első kinyitáskor indul, nem minden kartonnyitásnál; minden
 * újranyitás friss első oldalt kér (a terv közben változhatott). A lapozás a
 * „Továbbiak betöltése" gombbal megy (limit+offset, a szerver default 20-asával).
 *
 * A magyar összefoglaló (`summary`) a szerverről jön (lib/plan-history.ts) —
 * itt csak elrendezés van: `2026-08-20 14:12 · Dr. Kiss Anna · elhagyta:
 * Koronapróba — Manuálisan törölve (2 foglalás lemondva)`.
 */

const PAGE_SIZE = 20;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PlanHistoryLog({ episodeId }: { episodeId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PlanHistoryEntry[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const loadPage = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(
          `/api/episodes/${episodeId}/plan-history?limit=${PAGE_SIZE}&offset=${offset}`,
          { credentials: 'include' }
        );
        if (!res.ok) throw new Error('Nem sikerült betölteni a változásnaplót');
        const data = await res.json();
        const pageEntries: PlanHistoryEntry[] = data.entries ?? [];
        // Review-javítás: két lap között születhet új audit-sor, az offset
        // ilyenkor elcsúszik és a lap eleje a már megjelenített sort adná
        // újra — id-alapú dedupe véd a duplikált sor/React-key ellen.
        setEntries((prev) => {
          if (offset === 0) return pageEntries;
          const seen = new Set(prev.map((e) => e.id));
          return [...prev, ...pageEntries.filter((e) => !seen.has(e.id))];
        });
        setCount(typeof data.count === 'number' ? data.count : null);
        setHasMore(Boolean(data.hasMore));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [episodeId]
  );

  // A <details> nyitását magunk vezéreljük (controlled), így a lusta betöltés
  // determinisztikus: fetch csak nyitáskor, friss első oldallal.
  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void loadPage(0);
  };

  // Review-javítás (SSOT: "A terv változásai (N)" lecsukva is): egy könnyű,
  // count-célú lekérés mountkor (limit=1) — a teljes lista továbbra is csak
  // kinyitáskor töltődik.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}/plan-history?limit=1&offset=0`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.count === 'number') {
          setCount((prev) => (prev == null ? data.count : prev));
        }
      } catch {
        /* a lecsukott N hiánya nem hiba-állapot */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  return (
    <details
      open={open}
      className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800"
    >
      <summary
        onClick={(e) => {
          e.preventDefault();
          handleToggle();
        }}
        className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
      >
        <History className="w-4 h-4 shrink-0" />
        <span className="font-medium">
          A terv változásai{count != null ? ` (${count})` : ''}
        </span>
        <ChevronRight
          className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </summary>

      <div className="mt-2 pl-6">
        {error ? (
          <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
            <span>A változásnapló betöltése sikertelen.</span>
            <button
              type="button"
              onClick={() => void loadPage(0)}
              className="underline font-medium"
            >
              Újra
            </button>
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Betöltés…</span>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-1">
            Még nincs naplózott változás.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {entries.map((entry) => (
              <li key={entry.id} className="text-sm text-gray-700 dark:text-gray-300">
                <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                  {formatTimestamp(entry.createdAt)}
                </span>
                <span className="text-gray-400 dark:text-gray-600"> · </span>
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {entry.changedBy}
                </span>
                <span className="text-gray-400 dark:text-gray-600"> · </span>
                <span>{entry.summary}</span>
                {entry.reason && (
                  <span className="text-gray-500 dark:text-gray-400"> — {entry.reason}</span>
                )}
              </li>
            ))}
          </ol>
        )}

        {hasMore && !error && (
          <button
            type="button"
            onClick={() => void loadPage(entries.length)}
            disabled={loading}
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-medical-primary hover:underline disabled:opacity-50"
          >
            {loading && entries.length > 0 && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Továbbiak betöltése
          </button>
        )}
      </div>
    </details>
  );
}
