'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface BNOChartProps {
  data: Array<{ kod: string; elofordulas: number }>;
}

export function BNOChart({ data }: BNOChartProps) {
  // Top 20 legtöbb előfordulású BNO kód
  const topData = data.slice(0, 20);

  if (topData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nincs adat megjelenítésre
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        data={topData}
        margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
        layout="vertical"
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" />
        <YAxis 
          type="category" 
          dataKey="kod" 
          width={100}
          angle={-45}
          textAnchor="end"
          height={60}
        />
        <Tooltip 
          formatter={(value: number | undefined) => [`${value ?? 0} előfordulás`, 'Előfordulás']}
          labelFormatter={(label) => `BNO kód: ${label}`}
        />
        <Legend />
        <Bar dataKey="elofordulas" fill="#3b82f6" name="Előfordulás" />
      </BarChart>
    </ResponsiveContainer>
  );
}
