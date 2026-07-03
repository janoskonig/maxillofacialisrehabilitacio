'use client';

import { useEffect, useState } from 'react';
import type { OhipFunnelReport } from '@/lib/ohip14-funnel';

/**
 * OHIP-14 válaszarány-tölcsér panel (admin statisztika).
 *
 * Időpontonként (T0–T3): jogosult → emlékeztetett → eszkalált → kitöltött,
 * plusz kezelőorvosonkénti kitöltési arány. A nem véletlenszerű lemorzsolódás
 * (T1–T3 arányesés) a QoL-kimenetek torzításának fő forrása — ez a panel
 * teszi láthatóvá.
 */
export function OhipFunnelPanel() {
  const [report, setReport] = useState<OhipFunnelReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/admin/stats/ohip-funnel', { credentials: 'include', signal: ac.signal })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json())?.error || 'Hiba a betöltéskor');
        return res.json();
      })
      .then(data => setReport(data))
      .catch(e => {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  if (loading) {
    return (
      <div className="h-32 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Válaszarányok betöltése...</p>
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!report) return null;

  const rateColor = (r: number | null) =>
    r === null
      ? 'text-gray-400'
      : r >= 80
        ? 'text-emerald-600 dark:text-emerald-400'
        : r >= 50
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400';

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {report.totalPatients} nyitott epizódú beteg
        {report.withoutEmail > 0 && (
          <>
            {' '}
            — ebből <strong>{report.withoutEmail}</strong> e-mail cím nélkül (őket az e-mail
            emlékeztető nem éri el)
          </>
        )}
        .
      </p>

      {/* Időpontonkénti tölcsér */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
              <th className="py-2 pr-4 font-medium">Időpont</th>
              <th className="py-2 pr-4 font-medium text-right">Jogosult</th>
              <th className="py-2 pr-4 font-medium text-right">Kitöltött</th>
              <th className="py-2 pr-4 font-medium text-right">Nyitott (várakozik)</th>
              <th className="py-2 pr-4 font-medium text-right">Emlékeztetett</th>
              <th className="py-2 pr-4 font-medium text-right">Eszkalált</th>
              <th className="py-2 pr-4 font-medium text-right">Kihagyott</th>
              <th className="py-2 font-medium text-right">Kitöltési arány</th>
            </tr>
          </thead>
          <tbody>
            {report.timepoints.map(row => (
              <tr key={row.timepoint} className="border-b border-gray-100 dark:border-gray-800/60">
                <td className="py-2 pr-4 font-semibold text-gray-900 dark:text-gray-100">{row.timepoint}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{row.eligible}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{row.completed}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{row.pendingOpen}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{row.reminded}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {row.escalated > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">{row.escalated}</span>
                  ) : (
                    row.escalated
                  )}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {row.missed > 0 ? (
                    <span className="text-red-600 dark:text-red-400 font-medium">{row.missed}</span>
                  ) : (
                    row.missed
                  )}
                </td>
                <td className={`py-2 text-right tabular-nums font-semibold ${rateColor(row.completionRate)}`}>
                  {row.completionRate === null ? '–' : `${row.completionRate}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Vizuális arány-sávok */}
      <div className="space-y-2">
        {report.timepoints.map(row => (
          <div key={row.timepoint} className="flex items-center gap-3">
            <span className="w-8 text-xs font-semibold text-gray-700 dark:text-gray-300">{row.timepoint}</span>
            <div
              className="flex-1 h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
              role="img"
              aria-label={`${row.timepoint}: kitöltési arány ${row.completionRate ?? 0}%`}
            >
              <div
                className="h-full rounded-full bg-medical-primary"
                style={{ width: `${row.completionRate ?? 0}%` }}
              />
            </div>
            <span className={`w-14 text-right text-xs tabular-nums ${rateColor(row.completionRate)}`}>
              {row.completionRate === null ? '–' : `${row.completionRate}%`}
            </span>
          </div>
        ))}
      </div>

      {/* Kezelőorvosonkénti bontás */}
      {report.byDoctor.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Kitöltési arány kezelőorvosonként
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
                  <th className="py-2 pr-4 font-medium">Kezelőorvos</th>
                  <th className="py-2 pr-4 font-medium text-right">Jogosult</th>
                  <th className="py-2 pr-4 font-medium text-right">Kitöltött</th>
                  <th className="py-2 pr-4 font-medium text-right">Kihagyott</th>
                  <th className="py-2 font-medium text-right">Arány</th>
                </tr>
              </thead>
              <tbody>
                {report.byDoctor.map(d => (
                  <tr key={d.doctor} className="border-b border-gray-100 dark:border-gray-800/60">
                    <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{d.doctor}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{d.eligible}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{d.completed}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{d.missed}</td>
                    <td className={`py-2 text-right tabular-nums font-semibold ${rateColor(d.completionRate)}`}>
                      {d.completionRate === null ? '–' : `${d.completionRate}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
