'use client';

/**
 * OperationalStatsSection — operatív / SLA panel (jelenleg user_tasks).
 *
 * Adatforrás: GET /api/admin/stats/operational (lazy fetch).
 *
 * Mit mutat:
 *   - Felhasználói feladat-összesítő (összes / nyitott / kész / lejárt
 *     + medián megoldási idő).
 *   - Type szerinti bontás táblában.
 *   - Lejárat-info (legrégebben nyitva, lejárt feladatok átlag napjai).
 */

import { useCallback, useEffect, useState } from 'react';
import { ListChecks, AlertTriangle, RefreshCw, Timer, CheckCircle2 } from 'lucide-react';

const TASK_TYPE_LABEL: Record<string, string> = {
  document_upload: 'Dokumentum feltöltés',
  ohip14: 'OHIP-14 kitöltés',
  manual: 'Manuális',
  meeting_action: 'Meeting action',
};

const ASSIGNEE_KIND_LABEL: Record<string, string> = {
  staff: 'Stáff',
  patient: 'Páciens',
};

interface UserTaskTypeBucket {
  taskType: string;
  osszes: number;
  nyitott: number;
  kesz: number;
  torolt: number;
  medianMegoldasiNapok: number | null;
}

interface UserTaskAssigneeBucket {
  assigneeKind: string;
  osszes: number;
  nyitott: number;
}

export interface OperationalApiResponse {
  generaltAt: string;
  userTasks: {
    osszesito: {
      osszes: number;
      nyitott: number;
      kesz: number;
      torolt: number;
      lejart: number;
      medianMegoldasiNapok: number | null;
    };
    tipusSzerint: UserTaskTypeBucket[];
    assigneeKindSzerint: UserTaskAssigneeBucket[];
    lejarat: {
      legregebbenNyitvaNapok: number | null;
      lejartAtlagNapok: number | null;
    };
  };
}

function fmtInt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('hu-HU');
}

function fmtNum(v: number | null | undefined, suffix = ''): string {
  if (v == null) return '—';
  return `${v.toLocaleString('hu-HU', { maximumFractionDigits: 1 })}${suffix}`;
}

interface Props {
  onDataChange?: (data: OperationalApiResponse | null) => void;
}

export function OperationalStatsSection({ onDataChange }: Props) {
  const [data, setData] = useState<OperationalApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const res = await fetch('/api/admin/stats/operational', { credentials: 'include' });
      if (res.ok) {
        const body = (await res.json()) as OperationalApiResponse;
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
      setError('Hálózati hiba az operatív statisztikák betöltésekor');
      setData(null);
      onDataChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onDataChange]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section
      id="stats-operational"
      className="card scroll-mt-28 border-teal-200/80 shadow-soft-md"
      aria-labelledby="stats-operational-heading"
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-teal-100 p-2 text-teal-700">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <h2 id="stats-operational-heading" className="text-lg font-semibold text-gray-900">
              Operatív SLA — felhasználói feladatok
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              user_tasks: nyitott / lejárt / megoldási idő típus szerint.
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
            A user_tasks tábla nem található — a 014-es migráció valószínűleg még nem futott le ezen az
            adatbázison.
          </span>
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : data ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-gray-200/80 bg-gradient-to-br from-teal-50/60 to-white p-3">
              <p className="text-xs font-medium text-gray-500">Összes feladat</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900">
                {fmtInt(data.userTasks.osszesito.osszes)}
              </p>
            </div>
            <div className="rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 to-white p-3">
              <p className="text-xs font-medium text-gray-500">Nyitott</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-amber-700">
                {fmtInt(data.userTasks.osszesito.nyitott)}
              </p>
            </div>
            <div className="rounded-xl border border-rose-200/80 bg-gradient-to-br from-rose-50/60 to-white p-3">
              <p className="text-xs font-medium text-gray-500">Lejárt</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-rose-700">
                {fmtInt(data.userTasks.osszesito.lejart)}
              </p>
              {data.userTasks.lejarat.lejartAtlagNapok != null ? (
                <p className="mt-0.5 text-[11px] text-rose-700">
                  Átl. túl: {fmtNum(data.userTasks.lejarat.lejartAtlagNapok, ' nap')}
                </p>
              ) : null}
            </div>
            <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/60 to-white p-3">
              <p className="text-xs font-medium text-gray-500">Kész</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-emerald-700">
                {fmtInt(data.userTasks.osszesito.kesz)}
              </p>
              {data.userTasks.osszesito.medianMegoldasiNapok != null ? (
                <p className="mt-0.5 text-[11px] text-emerald-800">
                  Medián megoldás: {fmtNum(data.userTasks.osszesito.medianMegoldasiNapok, ' nap')}
                </p>
              ) : null}
            </div>
          </div>

          {data.userTasks.lejarat.legregebbenNyitvaNapok != null ? (
            <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-xs text-gray-700">
              <Timer className="mt-0.5 h-4 w-4 text-gray-500" />
              <span>
                Legrégebben nyitva álló feladat: {' '}
                <span className="font-semibold tabular-nums">
                  {fmtNum(data.userTasks.lejarat.legregebbenNyitvaNapok, ' nap')}
                </span>
              </span>
            </div>
          ) : null}

          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <CheckCircle2 className="h-4 w-4 text-teal-600" />
              Típus szerint
            </h3>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50/90">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Típus</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Összes</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Nyitott</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Kész</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Törölt</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">Medián megoldás (nap)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {data.userTasks.tipusSzerint.length === 0 ? (
                    <tr>
                      <td className="px-3 py-2 text-gray-500" colSpan={6}>
                        Nincs adat.
                      </td>
                    </tr>
                  ) : (
                    data.userTasks.tipusSzerint.map((t) => (
                      <tr key={t.taskType}>
                        <td className="px-3 py-1.5 text-gray-800">
                          {TASK_TYPE_LABEL[t.taskType] ?? t.taskType}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">
                          {fmtInt(t.osszes)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">
                          {fmtInt(t.nyitott)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">
                          {fmtInt(t.kesz)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                          {fmtInt(t.torolt)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                          {fmtNum(t.medianMegoldasiNapok)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {data.userTasks.assigneeKindSzerint.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-800">Címzett típus szerint</h3>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {data.userTasks.assigneeKindSzerint.map((a) => (
                  <li
                    key={a.assigneeKind}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <span className="text-gray-700">
                      {ASSIGNEE_KIND_LABEL[a.assigneeKind] ?? a.assigneeKind}
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="font-semibold text-gray-900">{fmtInt(a.osszes)}</span>{' '}
                      <span className="text-xs text-amber-700">({fmtInt(a.nyitott)} nyitott)</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
