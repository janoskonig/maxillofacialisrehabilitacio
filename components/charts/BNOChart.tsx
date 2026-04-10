'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export type BnoChartRow = { kod: string; nev: string | null; elofordulas: number };

interface BNOChartProps {
  data: BnoChartRow[];
}

interface TooltipPayloadItem {
  payload?: BnoChartRow;
}

export function BNOChart({ data }: BNOChartProps) {
  const topData = data.slice(0, 20);

  if (topData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
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
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="kod" width={88} tick={{ fontSize: 11 }} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = (payload[0] as TooltipPayloadItem).payload;
            if (!row) return null;
            return (
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-md">
                <p className="font-semibold text-gray-900">{row.kod}</p>
                {row.nev ? (
                  <p className="mt-0.5 text-gray-700">{row.nev}</p>
                ) : (
                  <p className="mt-0.5 text-gray-500">Nincs megnevezés a BNO törzsben</p>
                )}
                <p className="mt-1 tabular-nums text-gray-600">{row.elofordulas} előfordulás</p>
              </div>
            );
          }}
        />
        <Legend />
        <Bar dataKey="elofordulas" fill="#3b82f6" name="Előfordulás" />
      </BarChart>
    </ResponsiveContainer>
  );
}
