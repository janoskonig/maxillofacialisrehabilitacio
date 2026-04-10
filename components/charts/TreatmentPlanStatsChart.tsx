'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MedicalStats } from '@/lib/types';

const ARCOT_TIPUS_LABEL: Record<string, string> = {
  orrepitézis: 'Orrprotézis',
  fülepitézis: 'Fülprotézis',
  orbitaepitézis: 'Orbita protézis',
  középarcepitézis: 'Középarc protézis',
  nincs_tipus: '(nincs típus megadva)',
};

type Props = {
  treatmentPlans: MedicalStats['treatmentPlans'];
};

function pct(done: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((done / total) * 100)}%`;
}

export function TreatmentPlanStatsChart({ treatmentPlans }: Props) {
  const tp = treatmentPlans;
  const totalSorok = tp.osszesTervSorAFelson + tp.osszesTervSorAlso + tp.osszesTervSorArcotErinto;
  const totalKesz =
    tp.elkeszultFelson + tp.elkeszultAlso + tp.elkeszultArcotErinto;

  const fogChartData = tp.fogpotlasTipusSzerint.slice(0, 18).map((row) => ({
    ...row,
    megjelenes:
      row.labelHu ??
      (row.kod === 'ismeretlen' ? 'Ismeretlen / régi mező' : row.kod),
  }));

  const arcData = tp.arcotErintoTipusSzerint.map((row) => ({
    ...row,
    megjelenes: ARCOT_TIPUS_LABEL[row.tipus] ?? row.tipus,
  }));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-teal-100 bg-teal-50/70 px-3 py-3">
          <p className="text-xs font-medium text-teal-800">Betegek kiosztott tervvel</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-teal-950">
            {tp.betegekKiosztottTervvel}
          </p>
          <p className="text-xs text-teal-800/80">legalább egy tétel (felső / alsó / arc)</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3">
          <p className="text-xs font-medium text-gray-600">Tervsorok összesen</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{totalSorok}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-3 py-3">
          <p className="text-xs font-medium text-gray-600">Elkészült tételek</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{totalKesz}</p>
          <p className="text-xs text-gray-500">összes ív együtt: {pct(totalKesz, totalSorok)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
          <p className="text-xs font-medium text-gray-600">Ívenként</p>
          <ul className="mt-1 space-y-1 text-xs text-gray-800">
            <li>
              Felső: {tp.osszesTervSorAFelson} sor, elkészült {pct(tp.elkeszultFelson, tp.osszesTervSorAFelson)}
            </li>
            <li>
              Alsó: {tp.osszesTervSorAlso} sor, elkészült {pct(tp.elkeszultAlso, tp.osszesTervSorAlso)}
            </li>
            <li>
              Arcot érintő: {tp.osszesTervSorArcotErinto} sor, elkészült{' '}
              {pct(tp.elkeszultArcotErinto, tp.osszesTervSorArcotErinto)}
            </li>
          </ul>
        </div>
      </div>

      {fogChartData.length === 0 ? (
        <p className="text-center text-gray-500">Nincs felső/alsó állcsonti tervsor a rendszerben.</p>
      ) : (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-800">
            Fogpótlás-kezeléstípusok a kiosztott tervekben (felső + alsó ív)
          </h3>
          <p className="mb-3 text-xs text-gray-500">
            A `treatmentTypeCode` vagy a régi `tipus` mező alapján; a törzsben nem szereplő kódok külön sávban jelennek meg.
          </p>
          <ResponsiveContainer width="100%" height={Math.min(520, 120 + fogChartData.length * 28)}>
            <BarChart
              layout="vertical"
              data={fogChartData}
              margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="megjelenes"
                width={200}
                tick={{ fontSize: 11 }}
                interval={0}
              />
              <Tooltip
                formatter={(v: number | undefined) => [`${v ?? 0} tétel`, 'Darab']}
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload as { kod: string; labelHu: string | null };
                  return p ? `Kód: ${p.kod}` : '';
                }}
              />
              <Legend />
              <Bar dataKey="darab" fill="#0d9488" name="Tervsorok száma" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {arcData.length === 0 ? (
        <p className="text-sm text-gray-500">Nincs arcot érintő tervsor.</p>
      ) : (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-800">Arcot érintő tervek típusa</h3>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Típus</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Tervsorok</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {arcData.map((row) => (
                  <tr key={row.tipus}>
                    <td className="px-3 py-2 text-gray-800">{row.megjelenes}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{row.darab}</td>
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
