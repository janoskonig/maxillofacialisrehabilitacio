'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DoctorWorkloadChartProps {
  data: Array<{
    orvosNev: string;
    orvosEmail: string;
    jovobeliIdopontokSzama: number;
    elerhetoIdopontokSzama: number;
    multbeliIdopontokSzama: number;
  }>;
}

export function DoctorWorkloadChart({ data }: DoctorWorkloadChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nincs adat megjelenítésre
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis 
          dataKey="orvosNev" 
          angle={-45}
          textAnchor="end"
          height={100}
        />
        <YAxis />
        <Tooltip 
          formatter={(value: number | undefined, name: string | undefined) => {
            const labels: Record<string, string> = {
              jovobeliIdopontokSzama: 'Jövőbeli időpontok',
              elerhetoIdopontokSzama: 'Elérhető időpontok',
              multbeliIdopontokSzama: 'Múltbeli időpontok'
            };
            return [`${value ?? 0}`, labels[name ?? ''] || name || ''];
          }}
          labelFormatter={(label) => `Orvos: ${label}`}
        />
        <Legend 
          formatter={(value: string) => {
            const labels: Record<string, string> = {
              jovobeliIdopontokSzama: 'Jövőbeli időpontok',
              elerhetoIdopontokSzama: 'Elérhető időpontok',
              multbeliIdopontokSzama: 'Múltbeli időpontok'
            };
            return labels[value] || value;
          }}
        />
        <Bar dataKey="jovobeliIdopontokSzama" fill="#3b82f6" name="jovobeliIdopontokSzama" />
        <Bar dataKey="elerhetoIdopontokSzama" fill="#10b981" name="elerhetoIdopontokSzama" />
        <Bar dataKey="multbeliIdopontokSzama" fill="#6b7280" name="multbeliIdopontokSzama" />
      </BarChart>
    </ResponsiveContainer>
  );
}
