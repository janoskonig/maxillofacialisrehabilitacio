'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MedicalStats } from '@/lib/types';

const TIMEPOINT_LABEL: Record<string, string> = {
  T0: 'T0 — protetikai fázis előtt',
  T1: 'T1 — átadás +1 hó',
  T2: 'T2 — átadás +6 hó',
  T3: 'T3 — átadás +3 év',
};

type Props = {
  ohip14: MedicalStats['ohip14'];
};

export function OHIP14StatsChart({ ohip14 }: Props) {
  const chartData = ohip14.idopontokSzerint.map((row) => ({
    ...row,
    label: TIMEPOINT_LABEL[row.timepoint] ?? row.timepoint,
    atlag: row.atlagTotalScore ?? 0,
  }));

  const hasAny = ohip14.osszesKitoltes > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Egyedi betegek
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-indigo-950">
            {ohip14.betegekLegalabbEgyKitoltessel}
          </p>
          <p className="text-xs text-indigo-800/80">legalább egy OHIP-14 kitöltéssel</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Összes kitöltés
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {ohip14.osszesKitoltes}
          </p>
          <p className="text-xs text-slate-600">minden időpont és epizód együtt</p>
        </div>
      </div>

      {!hasAny ? (
        <p className="text-center text-gray-500">Még nincs OHIP-14 kitöltés az adatbázisban.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Időpont</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Kitöltések</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Betegek</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Átlag (0–56)</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Medián</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ohip14.idopontokSzerint.map((row) => (
                  <tr key={row.timepoint}>
                    <td className="px-3 py-2 text-gray-800">
                      {TIMEPOINT_LABEL[row.timepoint] ?? row.timepoint}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.kitoltesekSzama}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.betegekSzama}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.atlagTotalScore != null ? row.atlagTotalScore : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.medianTotalScore != null ? row.medianTotalScore : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-800">
              Kitöltések száma és átlagos összpontszám időpontonként
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-12} dy={8} height={70} />
                <YAxis yAxisId="left" allowDecimals={false} label={{ value: 'Darab', angle: -90, position: 'insideLeft' }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 56]}
                  label={{ value: 'OHIP-14 átlag', angle: 90, position: 'insideRight' }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-md">
                        {payload.map((entry) => (
                          <p key={String(entry.dataKey)} className="tabular-nums text-gray-800">
                            <span className="font-medium text-gray-600">{entry.name}: </span>
                            {entry.dataKey === 'kitoltesekSzama'
                              ? `${entry.value ?? 0} db`
                              : `${entry.value ?? 0} pont`}
                          </p>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend />
                <Bar yAxisId="left" dataKey="kitoltesekSzama" fill="#6366f1" name="Kitöltések" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="atlag" fill="#0ea5e9" name="Átlag összpontszám" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
