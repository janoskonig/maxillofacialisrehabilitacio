'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ReferringDoctorsChartProps {
  data: Array<{ orvos: string; darab: number }>;
}

export function ReferringDoctorsChart({ data }: ReferringDoctorsChartProps) {
  const topData = data.slice(0, 15);

  if (topData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nincs adat megjelenítésre
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={420}>
      <BarChart
        data={topData}
        layout="vertical"
        margin={{ top: 12, right: 24, left: 8, bottom: 12 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="orvos"
          width={160}
          tick={{ fontSize: 11 }}
          interval={0}
        />
        <Tooltip
          formatter={(value: number | undefined) => [`${value ?? 0} beteg`, 'Beteg száma']}
          labelFormatter={(label) => `Orvos: ${label}`}
        />
        <Legend />
        <Bar dataKey="darab" fill="#3b82f6" name="Beteg száma" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
