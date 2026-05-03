'use client';

/**
 * ConsiliumStatsSection — konzílium-kapcsolatos statisztika.
 *
 * Adatforrás: GET /api/admin/stats/consilium (lazy fetch).
 *
 * Mit mutat:
 *   - Sessions összesítő (státusz × múltbeli/jövőbeli) + heti trend mini-bar.
 *   - Item coverage: discussed/összes + per-session coverage medián.
 *   - Részvétel: bejelentett vs jelen-lévő tagok session-ként + top 15 leggyakoribb résztvevő.
 *   - Prep tokenek: aktív / visszavont / lejárt arány.
 *   - Prep kommentek: össz + kommentelt item arány + top 10 szerző.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users2,
  AlertTriangle,
  RefreshCw,
  CalendarRange,
  MessageCircle,
  KeyRound,
  CheckCircle2,
} from 'lucide-react';

interface SessionWeeklyBucket {
  hetKezdete: string;
  darab: number;
}
interface TopAttendee {
  attendeeId: string;
  attendeeName: string;
  osszesMeghivas: number;
  osszesJelen: number;
}
interface TopAuthor {
  authorDisplay: string;
  kommentSzam: number;
  erintettItemSzam: number;
}

export interface ConsiliumApiResponse {
  generaltAt: string;
  schemaFlags: {
    hasAttendees: boolean;
    hasTokens: boolean;
    hasComments: boolean;
  };
  sessions: {
    summary: {
      osszes: number;
      multbeli: number;
      jovobeli: number;
      draft: number;
      active: number;
      closed: number;
      atlagNapirendiPont: number | null;
    };
    statusSzerint: Array<{ status: string; darab: number }>;
    hetiTrend: SessionWeeklyBucket[];
  };
  coverage: {
    osszesItem: number;
    discussedItem: number;
    coveragePct: number;
    perSession: {
      sessionSzam: number;
      atlagCoveragePct: number | null;
      medianCoveragePct: number | null;
    };
  };
  attendance: {
    available: boolean;
    summary: {
      sessionSzam: number;
      atlagBejelentett: number | null;
      medianBejelentett: number | null;
      atlagJelen: number | null;
      medianJelen: number | null;
      osszesBejelentett: number;
      osszesJelen: number;
      reszveteliAranyPct: number;
    };
    topAttendees: TopAttendee[];
  };
  prepTokens: {
    available: boolean;
    kiallitott: number;
    aktiv: number;
    visszavont: number;
    lejart: number;
    tokenezettItemSzam: number;
  };
  prepComments: {
    available: boolean;
    osszesKomment: number;
    kommenteltItemSzam: number;
    atlagKommentPerKommenteltItem: number | null;
    medianKommentPerKommenteltItem: number | null;
    topAuthors: TopAuthor[];
  };
}

const STATUS_LABEL_HU: Record<string, string> = {
  draft: 'Vázlat',
  active: 'Aktív',
  closed: 'Lezárt',
};

function fmtInt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('hu-HU');
}

function fmtNum(v: number | null | undefined, suffix = ''): string {
  if (v == null) return '—';
  return `${v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })}${suffix}`;
}

function formatWeekStart(iso: string): string {
  return new Date(iso).toLocaleDateString('hu-HU', {
    timeZone: 'Europe/Budapest',
    month: 'short',
    day: 'numeric',
  });
}

interface Props {
  onDataChange?: (data: ConsiliumApiResponse | null) => void;
}

export function ConsiliumStatsSection({ onDataChange }: Props) {
  const [data, setData] = useState<ConsiliumApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const res = await fetch('/api/admin/stats/consilium', { credentials: 'include' });
      if (res.ok) {
        const body = (await res.json()) as ConsiliumApiResponse;
        setData(body);
        onDataChange?.(body);
      } else if (res.status === 503) {
        setUnavailable(true);
        setData(null);
        onDataChange?.(null);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `Hiba (HTTP ${res.status})`);
        setData(null);
        onDataChange?.(null);
      }
    } catch {
      setError('Hálózati hiba a konzílium statisztikák betöltésekor');
      setData(null);
      onDataChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onDataChange]);

  useEffect(() => {
    load();
  }, [load]);

  const maxWeekly = useMemo(() => {
    if (!data?.sessions.hetiTrend.length) return 0;
    return data.sessions.hetiTrend.reduce((m, w) => Math.max(m, w.darab), 0);
  }, [data]);

  return (
    <section
      id="stats-consilium"
      className="card scroll-mt-28 border-purple-200/80 shadow-soft-md"
      aria-labelledby="stats-consilium-heading"
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-purple-100 p-2 text-purple-700">
            <Users2 className="h-5 w-5" />
          </div>
          <div>
            <h2 id="stats-consilium-heading" className="text-lg font-semibold text-gray-900">
              Konzílium
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Sessions, részvétel, megbeszélt napirendi pontok és előkészítő kommentek.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-soft transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Frissítés
        </button>
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : unavailable ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A consilium_sessions tábla nem található — a 011-es migráció valószínűleg még nem futott
            le ezen az adatbázison.
          </span>
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Sessions KPI sor */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-purple-50/60 to-white p-3">
              <p className="text-xs font-medium text-gray-500">Összes ülés</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
                {fmtInt(data.sessions.summary.osszes)}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {fmtInt(data.sessions.summary.multbeli)} múltbeli ·{' '}
                {fmtInt(data.sessions.summary.jovobeli)} jövőbeli
              </p>
            </div>
            <div className="rounded-xl border border-gray-200/80 bg-white p-3">
              <p className="text-xs font-medium text-gray-500">Státusz</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-900">
                {data.sessions.summary.draft} vázlat ·{' '}
                <span className="text-emerald-700">{data.sessions.summary.active} aktív</span> ·{' '}
                {data.sessions.summary.closed} lezárt
              </p>
            </div>
            <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-indigo-50/60 to-white p-3">
              <p className="text-xs font-medium text-gray-500">Átl. napirendi pont / ülés</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-indigo-700">
                {fmtNum(data.sessions.summary.atlagNapirendiPont)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/60 to-white p-3">
              <p className="text-xs font-medium text-gray-500">Megbeszélt napirendi pontok</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-700">
                {data.coverage.coveragePct.toLocaleString('hu-HU', { maximumFractionDigits: 1 })}%
              </p>
              <p className="mt-0.5 text-[11px] text-emerald-800">
                {fmtInt(data.coverage.discussedItem)} / {fmtInt(data.coverage.osszesItem)} item
                {data.coverage.perSession.sessionSzam > 0 ? (
                  <>
                    {' '}· medián session-coverage: {fmtNum(data.coverage.perSession.medianCoveragePct, '%')}
                  </>
                ) : null}
              </p>
            </div>
          </div>

          {/* Heti trend mini-chart */}
          {data.sessions.hetiTrend.length > 0 ? (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                <CalendarRange className="h-4 w-4 text-purple-600" />
                Heti aktivitás (utolsó 26 hét + 12 hét előretekintés)
              </h3>
              <div className="flex h-24 items-end gap-1 rounded-lg border border-gray-200 bg-white p-2">
                {data.sessions.hetiTrend.map((w) => {
                  const pct = maxWeekly > 0 ? Math.max(2, Math.round((w.darab / maxWeekly) * 100)) : 2;
                  return (
                    <div
                      key={w.hetKezdete}
                      className="flex-1 rounded-sm bg-gradient-to-t from-purple-500/70 to-purple-400/70 transition-all hover:from-purple-600 hover:to-purple-500"
                      style={{ height: `${pct}%` }}
                      title={`${formatWeekStart(w.hetKezdete)}: ${w.darab} ülés`}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Részvétel */}
          {data.attendance.available ? (
            <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-purple-50/30 to-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Users2 className="h-4 w-4 text-purple-600" />
                Részvétel — bejelentett vs jelen-lévő
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-gray-500">Sessions (n)</p>
                  <p className="text-xl font-bold tabular-nums text-gray-900">
                    {fmtInt(data.attendance.summary.sessionSzam)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Átl. bejelentett</p>
                  <p className="text-xl font-bold tabular-nums text-gray-900">
                    {fmtNum(data.attendance.summary.atlagBejelentett)}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    medián {fmtNum(data.attendance.summary.medianBejelentett)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Átl. jelen-lévő</p>
                  <p className="text-xl font-bold tabular-nums text-emerald-700">
                    {fmtNum(data.attendance.summary.atlagJelen)}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    medián {fmtNum(data.attendance.summary.medianJelen)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Részvételi arány</p>
                  <p className="text-xl font-bold tabular-nums text-violet-700">
                    {data.attendance.summary.reszveteliAranyPct.toLocaleString('hu-HU', { maximumFractionDigits: 1 })}%
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {fmtInt(data.attendance.summary.osszesJelen)} /{' '}
                    {fmtInt(data.attendance.summary.osszesBejelentett)}
                  </p>
                </div>
              </div>

              {data.attendance.topAttendees.length > 0 ? (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold text-gray-700">
                    Top {data.attendance.topAttendees.length} leggyakoribb résztvevő
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-xs">
                      <thead className="bg-gray-50/90">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">Név</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">Meghívás</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">Jelen</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">Részvétel %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {data.attendance.topAttendees.map((a, idx) => {
                          const pct =
                            a.osszesMeghivas > 0
                              ? Math.round((a.osszesJelen / a.osszesMeghivas) * 1000) / 10
                              : 0;
                          return (
                            <tr key={`${a.attendeeId}-${idx}`}>
                              <td className="px-3 py-1.5 text-gray-800">{a.attendeeName}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                                {fmtInt(a.osszesMeghivas)}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums font-medium text-emerald-700">
                                {fmtInt(a.osszesJelen)}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-violet-700">
                                {pct}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200/70 bg-amber-50/40 p-3 text-xs text-amber-800">
              A részvétel-statisztika a 012-es migráció után érhető el (`attendees` JSONB oszlop).
            </div>
          )}

          {/* Prep tokenek */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-sky-50/40 to-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <KeyRound className="h-4 w-4 text-sky-600" />
                Előkészítő tokenek
              </h3>
              {data.prepTokens.available ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500">Kiállított összesen</p>
                    <p className="text-xl font-bold tabular-nums text-gray-900">
                      {fmtInt(data.prepTokens.kiallitott)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Aktív</p>
                    <p className="text-xl font-bold tabular-nums text-emerald-700">
                      {fmtInt(data.prepTokens.aktiv)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Visszavont</p>
                    <p className="text-xl font-bold tabular-nums text-rose-700">
                      {fmtInt(data.prepTokens.visszavont)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Lejárt</p>
                    <p className="text-xl font-bold tabular-nums text-gray-500">
                      {fmtInt(data.prepTokens.lejart)}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-gray-500">Tokent kapott napirendi pontok</p>
                    <p className="text-lg font-semibold tabular-nums text-sky-700">
                      {fmtInt(data.prepTokens.tokenezettItemSzam)} item
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-800">
                  A 015-ös migráció (consilium_item_prep_tokens) még nem futott le.
                </p>
              )}
            </div>

            {/* Prep kommentek */}
            <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-rose-50/40 to-white p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <MessageCircle className="h-4 w-4 text-rose-600" />
                Előkészítő kommentek
              </h3>
              {data.prepComments.available ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-500">Összes komment</p>
                      <p className="text-xl font-bold tabular-nums text-gray-900">
                        {fmtInt(data.prepComments.osszesKomment)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Kommentelt napirendi pont</p>
                      <p className="text-xl font-bold tabular-nums text-rose-700">
                        {fmtInt(data.prepComments.kommenteltItemSzam)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Átl. komment / kommentelt item</p>
                      <p className="text-xl font-bold tabular-nums text-gray-900">
                        {fmtNum(data.prepComments.atlagKommentPerKommenteltItem)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Medián / kommentelt item</p>
                      <p className="text-xl font-bold tabular-nums text-gray-900">
                        {fmtNum(data.prepComments.medianKommentPerKommenteltItem)}
                      </p>
                    </div>
                  </div>

                  {data.prepComments.topAuthors.length > 0 ? (
                    <div className="mt-4">
                      <h4 className="mb-2 text-xs font-semibold text-gray-700">
                        Top {data.prepComments.topAuthors.length} kommentelő
                      </h4>
                      <ul className="space-y-1.5">
                        {data.prepComments.topAuthors.map((a, idx) => {
                          const max = Math.max(
                            ...data.prepComments.topAuthors.map((x) => x.kommentSzam),
                          );
                          const pct = max > 0 ? Math.round((a.kommentSzam / max) * 100) : 0;
                          return (
                            <li key={`${a.authorDisplay}-${idx}`}>
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-700 truncate" title={a.authorDisplay}>
                                  {a.authorDisplay}
                                </span>
                                <span className="tabular-nums">
                                  <span className="font-semibold text-gray-900">{a.kommentSzam}</span>{' '}
                                  <span className="text-[10px] text-gray-400">
                                    ({a.erintettItemSzam} item)
                                  </span>
                                </span>
                              </div>
                              <div className="mt-0.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-rose-500/70 transition-[width] duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-gray-500">
                      Még nincs előkészítő komment a rendszerben.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-amber-800">
                  A 015-ös migráció (consilium_prep_comments) még nem futott le.
                </p>
              )}
            </div>
          </div>

          {/* Per-session coverage info */}
          {data.coverage.perSession.sessionSzam > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-xs text-gray-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              <span>
                Per-session megbeszélési arány — átlag{' '}
                <span className="font-semibold tabular-nums">
                  {fmtNum(data.coverage.perSession.atlagCoveragePct, '%')}
                </span>
                , medián{' '}
                <span className="font-semibold tabular-nums">
                  {fmtNum(data.coverage.perSession.medianCoveragePct, '%')}
                </span>{' '}
                ({data.coverage.perSession.sessionSzam} ülés napirendi pontokkal)
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
