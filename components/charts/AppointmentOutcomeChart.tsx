'use client';

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';

export type OutcomeKey =
  | 'completed'
  | 'no_show'
  | 'cancelled_by_doctor'
  | 'cancelled_by_patient'
  | 'pending';

export type AppointmentOutcomeRow = {
  kimenet: OutcomeKey | string;
  darab: number;
};

const LABELS: Record<string, string> = {
  completed: 'Teljesült',
  no_show: 'Nem jelent meg',
  cancelled_by_doctor: 'Lemondta az orvos',
  cancelled_by_patient: 'Lemondta a beteg',
  pending: 'Folyamatban / nincs rögzítve',
};

const COLORS: Record<string, string> = {
  completed: '#10b981',
  no_show: '#ef4444',
  cancelled_by_doctor: '#f59e0b',
  cancelled_by_patient: '#fb923c',
  pending: '#94a3b8',
};

export function AppointmentOutcomeChart({ data }: { data: AppointmentOutcomeRow[] }) {
  const filtered = data.filter((d) => d.darab > 0);
  const total = filtered.reduce((sum, d) => sum + d.darab, 0);

  if (total === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500">
        Nincs megjeleníthető időpont-kimenetel.
      </div>
    );
  }

  const chartData = filtered.map((d) => ({
    name: LABELS[d.kimenet] ?? d.kimenet,
    key: d.kimenet,
    value: d.darab,
    pct: Math.round((d.darab / total) * 1000) / 10,
  }));

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={2}
            stroke="white"
            strokeWidth={2}
          >
            {chartData.map((entry) => (
              <Cell key={entry.key} fill={COLORS[entry.key] ?? '#3b82f6'} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as { name: string; value: number; pct: number };
              return (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-md">
                  <p className="font-semibold text-gray-900">{row.name}</p>
                  <p className="mt-0.5 tabular-nums text-gray-600">
                    {row.value} db · {row.pct}%
                  </p>
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            iconType="circle"
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[42%] -translate-y-1/2 text-center">
        <p className="text-2xl font-bold tabular-nums text-gray-900">{total}</p>
        <p className="text-xs font-medium text-gray-500">összes</p>
      </div>
    </div>
  );
}
