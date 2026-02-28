'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ToothPositionsChartProps {
  data: Array<{
    fogSzam: number;
    dSzama: number;
    fSzama: number;
    mSzama: number;
    egeszsSeges?: number;
    osszes: number;
  }>;
}

// Zsigmondy kvadránsok definíciója
const QUADRANTS = {
  topLeft: [18, 17, 16, 15, 14, 13, 12, 11], // Bal felső (csökkenő)
  topRight: [21, 22, 23, 24, 25, 26, 27, 28], // Jobb felső (növekvő)
  bottomRight: [31, 32, 33, 34, 35, 36, 37, 38], // Jobb alsó (növekvő)
  bottomLeft: [48, 47, 46, 45, 44, 43, 42, 41], // Bal alsó (csökkenő)
};

export function ToothPositionsChart({ data }: ToothPositionsChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nincs adat megjelenítésre
      </div>
    );
  }

  // Adatok indexelése fog szám szerint
  const dataMap = new Map(data.map(item => [item.fogSzam, item]));

  const getToothData = (fogSzam: number) => {
    const d = dataMap.get(fogSzam);
    if (d) {
      return {
        ...d,
        egeszsSeges: d.egeszsSeges ?? (d.osszes - d.dSzama - d.fSzama - d.mSzama),
      };
    }
    return { fogSzam, dSzama: 0, fSzama: 0, mSzama: 0, egeszsSeges: 0, osszes: 0 };
  };

  // Kvadráns adatok előkészítése
  const getQuadrantData = (quadrant: number[]) => {
    return quadrant.map(fogSzam => getToothData(fogSzam));
  };

  const LABELS: Record<string, string> = {
    egeszsSeges: 'Egészséges',
    dSzama: 'Szuvas (D)',
    fSzama: 'Tömött (F)',
    mSzama: 'Hiányzik (M)',
  };

  const QuadrantChart = ({ 
    title, 
    quadrantData 
  }: { 
    title: string; 
    quadrantData: Array<{ fogSzam: number; dSzama: number; fSzama: number; mSzama: number; egeszsSeges: number; osszes: number }> 
  }) => {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-center">{title}</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart
            data={quadrantData}
            margin={{ top: 10, right: 10, left: 10, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="fogSzam" 
              angle={-45}
              textAnchor="end"
              height={50}
            />
            <YAxis />
            <Tooltip 
              formatter={(value: number | undefined, name: string | undefined) => {
                return [`${value ?? 0} fog`, LABELS[name ?? ''] || name || ''];
              }}
              labelFormatter={(label) => `${label}. fog`}
            />
            <Legend 
              formatter={(value: string) => LABELS[value] || value}
            />
            <Bar dataKey="egeszsSeges" stackId="a" fill="#22c55e" name="egeszsSeges" />
            <Bar dataKey="dSzama" stackId="a" fill="#ef4444" name="dSzama" />
            <Bar dataKey="fSzama" stackId="a" fill="#3b82f6" name="fSzama" />
            <Bar dataKey="mSzama" stackId="a" fill="#6b7280" name="mSzama" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Négy kvadránsos elrendezés - négy bar chart */}
      <div className="grid grid-cols-2 gap-6">
        {/* Bal felső kvadráns */}
        <div className="border-2 border-gray-400 rounded-lg p-4">
          <QuadrantChart 
            title="Jobb felső (18-11)" 
            quadrantData={getQuadrantData(QUADRANTS.topLeft)}
          />
        </div>

        {/* Jobb felső kvadráns */}
        <div className="border-2 border-gray-400 rounded-lg p-4">
          <QuadrantChart 
            title="Bal felső (21-28)" 
            quadrantData={getQuadrantData(QUADRANTS.topRight)}
          />
        </div>

        {/* Bal alsó kvadráns */}
        <div className="border-2 border-gray-400 rounded-lg p-4">
          <QuadrantChart 
            title="Jobb alsó (48-41)" 
            quadrantData={getQuadrantData(QUADRANTS.bottomLeft)}
          />
        </div>

        {/* Jobb alsó kvadráns */}
        <div className="border-2 border-gray-400 rounded-lg p-4">
          <QuadrantChart 
            title="Bal alsó (31-38)" 
            quadrantData={getQuadrantData(QUADRANTS.bottomRight)}
          />
        </div>
      </div>
    </div>
  );
}
