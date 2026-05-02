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

export type BookingHourRow = {
  ora: number;
  cimke: string;
  darab: number;
};

export function BookingHourChart({ data }: { data: BookingHourRow[] }) {
  const total = data.reduce((sum, d) => sum + d.darab, 0);
  if (total === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-gray-500">
        Még nincs foglalás óránkénti megoszláshoz.
      </div>
    );
  }
  const max = data.reduce((m, d) => Math.max(m, d.darab), 0);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
        <XAxis
          dataKey="cimke"
          tick={{ fontSize: 10, fill: '#6b7280' }}
          interval={1}
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
          cursor={{ fill: 'rgba(59, 130, 246, 0.06)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as BookingHourRow;
            const pct = total > 0 ? Math.round((row.darab / total) * 1000) / 10 : 0;
            return (
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-md">
                <p className="font-semibold text-gray-900">{row.cimke}</p>
                <p className="mt-0.5 tabular-nums text-gray-600">
                  {row.darab} foglalás · {pct}%
                </p>
              </div>
            );
          }}
        />
        <Bar dataKey="darab" radius={[6, 6, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.ora}
              fill={d.darab === max && max > 0 ? '#2563eb' : '#93c5fd'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
