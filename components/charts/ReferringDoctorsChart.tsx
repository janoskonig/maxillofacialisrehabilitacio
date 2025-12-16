'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface ReferringDoctorsChartProps {
  data: Array<{ orvos: string; darab: number }>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export function ReferringDoctorsChart({ data }: ReferringDoctorsChartProps) {
  // Top 15 legtöbb beutaló orvos
  const topData = data.slice(0, 15);

  if (topData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nincs adat megjelenítésre
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bar Chart */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Beutaló orvosok eloszlása (Bar Chart)</h3>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={topData}
            margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="orvos" 
              angle={-45}
              textAnchor="end"
              height={100}
            />
            <YAxis />
            <Tooltip 
              formatter={(value: number | undefined) => [`${value ?? 0} beteg`, 'Beteg száma']}
              labelFormatter={(label) => `Orvos: ${label}`}
            />
            <Legend />
            <Bar dataKey="darab" fill="#3b82f6" name="Beteg száma" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pie Chart - Top 10 */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Top 10 beutaló orvos (Pie Chart)</h3>
        <ResponsiveContainer width="100%" height={400}>
          <PieChart>
            <Pie
              data={topData.slice(0, 10)}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={(entry: any) => `${entry.orvos}: ${((entry.percent ?? 0) * 100).toFixed(1)}%`}
              outerRadius={120}
              fill="#8884d8"
              dataKey="darab"
              nameKey="orvos"
            >
              {topData.slice(0, 10).map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number | undefined) => [`${value ?? 0} beteg`, 'Beteg száma']}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
