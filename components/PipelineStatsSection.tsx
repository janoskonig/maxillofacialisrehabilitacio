'use client';

/**
 * PipelineStatsSection — episode + work-phase pipeline KPI panel.
 *
 * Adatforrás: GET /api/admin/stats/pipeline (lazy fetch; csak a panel
 * mount-jakor töltünk).
 *
 * Mit mutat:
 *   - Episode lifetime: lezárt mintás összegzés (átlag/medián/IQR/max
 *     napokban) + nyitott episode-ok jelenlegi kor-statisztikája.
 *   - Episode status megoszlás (open/closed/paused).
 *   - Munkafázis totals — top 15 kód, kész aránnyal.
 *   - Munkafázis status mátrix az ugyanezen 15 kódra (kompakt tábla).
 *   - Ragadt (>kuszob nap) pending/scheduled work-phase-ek.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitBranch,
  AlertTriangle,
  RefreshCw,
  Layers,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface EpisodeStatusBucket {
  status: string;
  darab: number;
}
interface WorkPhaseTotal {
  workPhaseCode: string;
  labelHu: string | null;
  osszes: number;
  kesz: number;
  pending: number;
  scheduled: number;
  skipped: number;
  keszPct: number;
}
interface WorkPhaseMatrixCell {
  workPhaseCode: string;
  labelHu: string | null;
  status: string;
  darab: number;
}
interface StuckWorkPhase {
  workPhaseCode: string;
  labelHu: string | null;
  status: string;
  darab: number;
  legidosebbNapok: number | null;
}

export interface PipelineApiResponse {
  generaltAt: string;
  stuckDaysThreshold: number;
  episodeStatus: EpisodeStatusBucket[];
  episodeLifetime: {
    lezart: {
      mintaSzam: number;
      atlagNapok: number | null;
      medianNapok: number | null;
      p25Napok: number | null;
      p75Napok: number | null;
      minNapok: number | null;
      maxNapok: number | null;
    };
    nyitott: {
      mintaSzam: number;
      atlagNapok: number | null;
      medianNapok: number | null;
      p75Napok: number | null;
      maxNapok: number | null;
    };
  };
  workPhaseMatrix: WorkPhaseMatrixCell[];
  workPhaseTotals: WorkPhaseTotal[];
  stuckWorkPhases: {
    kuszobNapok: number;
    osszes: number;
    top: StuckWorkPhase[];
  };
}

const STATUS_LABEL_HU: Record<string, string> = {
  open: 'Nyitott',
  closed: 'Lezárt',
  paused: 'Szüneteltetve',
  pending: 'Függőben',
  scheduled: 'Időzítve',
  completed: 'Kész',
  skipped: 'Kihagyva',
};

const WP_STATUS_ORDER = ['pending', 'scheduled', 'completed', 'skipped'] as const;

function fmtNum(v: number | null | undefined, suffix = ''): string {
  if (v == null) return '—';
  return `${v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })}${suffix}`;
}

function fmtInt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('hu-HU');
}

interface Props {
  /** Külső callback ha a parent szeretné hivatkozni a fetch-ed adatra (pl. CSV export). */
  onDataChange?: (data: PipelineApiResponse | null) => void;
}

export function PipelineStatsSection({ onDataChange }: Props) {
  const [data, setData] = useState<PipelineApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const res = await fetch('/api/admin/stats/pipeline', { credentials: 'include' });
      if (res.ok) {
        const body = (await res.json()) as PipelineApiResponse;
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
      setError('Hálózati hiba a pipeline statisztikák betöltésekor');
      setData(null);
      onDataChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onDataChange]);

  useEffect(() => {
    load();
  }, [load]);

  const matrixByCode = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    if (!data) return m;
    for (const cell of data.workPhaseMatrix) {
      if (!m.has(cell.workPhaseCode)) m.set(cell.workPhaseCode, new Map());
      m.get(cell.workPhaseCode)!.set(cell.status, cell.darab);
    }
    return m;
  }, [data]);

  return (
    <section
      id="stats-pipeline"
      className="card scroll-mt-28 border-indigo-200/80 shadow-soft-md"
      aria-labelledby="stats-pipeline-heading"
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-indigo-100 p-2 text-indigo-700">
            <GitBranch className="h-5 w-5" />
          </div>
          <div>
            <h2 id="stats-pipeline-heading" className="text-lg font-semibold text-gray-900">
              Folyamat és munkafázisok
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Episode élettartam, work-phase pipeline és „ragadt" lépések.
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      ) : unavailable ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A pipeline adatok nem érhetők el — a 016-os migráció (patient_episodes / episode_work_phases)
            valószínűleg még nem futott le ezen az adatbázison.
          </span>
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* ── Episode lifetime + status ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-indigo-50/60 to-white p-4">
              <div className="mb-2 flex items-center gap-2 text-indigo-800">
                <CheckCircle2 className="h-4 w-4" />
                <h3 className="text-sm font-semibold">Lezárt episode-ok</h3>
              </div>
              <p className="text-2xl font-bold tabular-nums text-gray-900">
                {fmtInt(data.episodeLifetime.lezart.mintaSzam)}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-gray-500">Átlag</dt>
                <dd className="text-right tabular-nums">{fmtNum(data.episodeLifetime.lezart.atlagNapok, ' nap')}</dd>
                <dt className="text-gray-500">Medián</dt>
                <dd className="text-right tabular-nums">{fmtNum(data.episodeLifetime.lezart.medianNapok, ' nap')}</dd>
                <dt className="text-gray-500">P25–P75</dt>
                <dd className="text-right tabular-nums">
                  {fmtNum(data.episodeLifetime.lezart.p25Napok)}–{fmtNum(data.episodeLifetime.lezart.p75Napok, ' nap')}
                </dd>
                <dt className="text-gray-500">Min–Max</dt>
                <dd className="text-right tabular-nums">
                  {fmtNum(data.episodeLifetime.lezart.minNapok)}–{fmtNum(data.episodeLifetime.lezart.maxNapok, ' nap')}
                </dd>
              </dl>
            </div>

            <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-sky-50/60 to-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sky-800">
                <Clock className="h-4 w-4" />
                <h3 className="text-sm font-semibold">Nyitott episode-ok kora</h3>
              </div>
              <p className="text-2xl font-bold tabular-nums text-gray-900">
                {fmtInt(data.episodeLifetime.nyitott.mintaSzam)}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-gray-500">Átlag</dt>
                <dd className="text-right tabular-nums">{fmtNum(data.episodeLifetime.nyitott.atlagNapok, ' nap')}</dd>
                <dt className="text-gray-500">Medián</dt>
                <dd className="text-right tabular-nums">{fmtNum(data.episodeLifetime.nyitott.medianNapok, ' nap')}</dd>
                <dt className="text-gray-500">P75</dt>
                <dd className="text-right tabular-nums">{fmtNum(data.episodeLifetime.nyitott.p75Napok, ' nap')}</dd>
                <dt className="text-gray-500">Legrégebb</dt>
                <dd className="text-right tabular-nums">{fmtNum(data.episodeLifetime.nyitott.maxNapok, ' nap')}</dd>
              </dl>
            </div>

            <div className="rounded-xl border border-gray-200/80 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-gray-700">
                <Layers className="h-4 w-4" />
                <h3 className="text-sm font-semibold">Episode-ok státusz szerint</h3>
              </div>
              <ul className="mt-2 space-y-2">
                {data.episodeStatus.length === 0 ? (
                  <li className="text-sm text-gray-500">Nincs adat.</li>
                ) : (
                  data.episodeStatus.map((s) => (
                    <li key={s.status} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{STATUS_LABEL_HU[s.status] ?? s.status}</span>
                      <span className="font-semibold tabular-nums text-gray-900">{fmtInt(s.darab)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          {/* ── Stuck work phases warning ── */}
          {data.stuckWorkPhases.osszes > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="mb-2 flex items-center gap-2 text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                <h3 className="text-sm font-semibold">
                  „Ragadt" munkafázisok ({data.stuckWorkPhases.kuszobNapok}+ napja nyitva):{' '}
                  <span className="tabular-nums">{fmtInt(data.stuckWorkPhases.osszes)}</span>
                </h3>
              </div>
              {data.stuckWorkPhases.top.length === 0 ? (
                <p className="text-xs text-amber-800">Nincs részletes bontás.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-amber-200/70 bg-white">
                  <table className="min-w-full divide-y divide-amber-100 text-xs">
                    <thead className="bg-amber-50/60">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-amber-900">Munkafázis</th>
                        <th className="px-3 py-2 text-left font-semibold text-amber-900">Státusz</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-900">Darab</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-900">Legidősebb</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-50">
                      {data.stuckWorkPhases.top.map((s, idx) => (
                        <tr key={`${s.workPhaseCode}-${s.status}-${idx}`}>
                          <td className="px-3 py-1.5 text-gray-800">
                            {s.labelHu ?? <span className="font-mono text-gray-500">{s.workPhaseCode}</span>}
                            {s.labelHu ? (
                              <span className="ml-1 text-[10px] text-gray-400">{s.workPhaseCode}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5 text-gray-700">{STATUS_LABEL_HU[s.status] ?? s.status}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">
                            {fmtInt(s.darab)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-amber-900">
                            {fmtNum(s.legidosebbNapok, ' nap')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800">
              Nincs {data.stuckWorkPhases.kuszobNapok}+ napja nyitva álló pending/scheduled munkafázis.
            </div>
          )}

          {/* ── Work phase totals + matrix ── */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-800">
              Munkafázis pipeline (top 15 kód)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50/90">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Munkafázis</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Összes</th>
                    {WP_STATUS_ORDER.map((s) => (
                      <th key={s} className="px-3 py-2 text-right font-semibold text-gray-600">
                        {STATUS_LABEL_HU[s] ?? s}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Kész %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {data.workPhaseTotals.map((w, idx) => {
                    const cells = matrixByCode.get(w.workPhaseCode) ?? new Map<string, number>();
                    return (
                      <tr key={w.workPhaseCode} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
                        <td className="px-3 py-1.5 text-gray-800">
                          {w.labelHu ?? <span className="font-mono text-gray-500">{w.workPhaseCode}</span>}
                          {w.labelHu ? (
                            <span className="ml-1 text-[10px] text-gray-400">{w.workPhaseCode}</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">
                          {fmtInt(w.osszes)}
                        </td>
                        {WP_STATUS_ORDER.map((s) => (
                          <td key={s} className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                            {fmtInt(cells.get(s) ?? (s === 'completed' ? w.kesz
                              : s === 'pending' ? w.pending
                              : s === 'scheduled' ? w.scheduled
                              : w.skipped))}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-700">
                          {w.keszPct.toLocaleString('hu-HU', { maximumFractionDigits: 1 })}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
