'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export type ActivityTrendRow = {
  datum: string; // ISO YYYY-MM-DD
  cimke: string; // human-friendly Hungarian month + day label
  darab: number;
};

export function ActivityTrendChart({ data }: { data: ActivityTrendRow[] }) {
  const total = data.reduce((sum, d) => sum + d.darab, 0);
  if (total === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-gray-500">
        Az utolsó 30 napban nem volt rögzített aktivitás.
      </div>
    );
  }
  const max = data.reduce((m, d) => Math.max(m, d.darab), 0);
  const avg = Math.round(total / data.length);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <span className="text-gray-500">
          Összes: <span className="font-semibold tabular-nums text-gray-900">{total}</span>
        </span>
        <span className="text-gray-500">
          Napi átlag: <span className="font-semibold tabular-nums text-gray-900">{avg}</span>
        </span>
        <span className="text-gray-500">
          Csúcs: <span className="font-semibold tabular-nums text-gray-900">{max}</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="3 3" />
          <XAxis
            dataKey="cimke"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            interval={Math.max(0, Math.floor(data.length / 8) - 1)}
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
            cursor={{ stroke: '#f59e0b', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as ActivityTrendRow;
              return (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-md">
                  <p className="font-semibold text-gray-900">{row.cimke}</p>
                  <p className="mt-0.5 tabular-nums text-gray-600">
                    {row.darab} esemény
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="darab"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#activityGradient)"
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
