'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DMFDistributionChartProps {
  data: Array<{ dmft: number; betegSzama: number }>;
  stats: {
    atlag: number;
    median: number;
    szoras: number;
    min: number;
    max: number;
  };
}

export function DMFDistributionChart({ data, stats }: DMFDistributionChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nincs adat megjelenítésre
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Statisztikák */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-600 font-medium">Átlag</p>
          <p className="text-2xl font-bold text-blue-900">{stats.atlag.toFixed(2)}</p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <p className="text-sm text-green-600 font-medium">Medián</p>
          <p className="text-2xl font-bold text-green-900">{stats.median.toFixed(2)}</p>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
          <p className="text-sm text-purple-600 font-medium">Szórás</p>
          <p className="text-2xl font-bold text-purple-900">{stats.szoras.toFixed(2)}</p>
        </div>
        <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
          <p className="text-sm text-orange-600 font-medium">Minimum</p>
          <p className="text-2xl font-bold text-orange-900">{stats.min}</p>
        </div>
        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
          <p className="text-sm text-red-600 font-medium">Maximum</p>
          <p className="text-2xl font-bold text-red-900">{stats.max}</p>
        </div>
      </div>

      {/* Histogram */}
      <div>
        <h3 className="text-lg font-semibold mb-4">DMF index eloszlás</h3>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="dmft" 
              label={{ value: 'DMF index', position: 'insideBottom', offset: -5 }}
            />
            <YAxis 
              label={{ value: 'Beteg száma', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              formatter={(value: number | undefined) => [`${value ?? 0} beteg`, 'Beteg száma']}
              labelFormatter={(label) => `DMF index: ${label}`}
            />
            <Legend />
            <Bar dataKey="betegSzama" fill="#3b82f6" name="Beteg száma" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
