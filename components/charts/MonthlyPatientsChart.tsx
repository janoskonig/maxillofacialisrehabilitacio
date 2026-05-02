'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from 'recharts';

export type MonthlyPatientsRow = {
  honap: string; // ISO YYYY-MM
  cimke: string; // localized "Aug 25"
  darab: number;
};

export function MonthlyPatientsChart({ data }: { data: MonthlyPatientsRow[] }) {
  const total = data.reduce((sum, d) => sum + d.darab, 0);
  if (total === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-gray-500">
        Az utolsó 12 hónapban nem rögzítettünk új beteget.
      </div>
    );
  }
  const max = data.reduce((m, d) => Math.max(m, d.darab), 0);
  const lastIdx = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
        <XAxis
          dataKey="cimke"
          tick={{ fontSize: 11, fill: '#374151' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#6b7280' }}
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        <Tooltip
          cursor={{ fill: 'rgba(14, 165, 233, 0.08)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as MonthlyPatientsRow;
            return (
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-md">
                <p className="font-semibold text-gray-900">{row.cimke}</p>
                <p className="mt-0.5 tabular-nums text-gray-600">
                  {row.darab} új beteg
                </p>
              </div>
            );
          }}
        />
        <Bar dataKey="darab" radius={[6, 6, 0, 0]}>
          {data.map((d, idx) => {
            const isLatest = idx === lastIdx;
            const isPeak = d.darab === max && max > 0;
            const fill = isLatest
              ? '#0ea5e9'
              : isPeak
                ? '#0284c7'
                : '#bae6fd';
            return <Cell key={d.honap} fill={fill} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
