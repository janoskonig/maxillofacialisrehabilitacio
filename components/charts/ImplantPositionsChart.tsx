'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ImplantPositionsChartProps {
  data: Array<{
    fogSzam: number;
    implantatumSzama: number;
  }>;
}

// Zsigmondy kvadránsok definíciója
const QUADRANTS = {
  topLeft: [18, 17, 16, 15, 14, 13, 12, 11], // Bal felső (csökkenő)
  topRight: [21, 22, 23, 24, 25, 26, 27, 28], // Jobb felső (növekvő)
  bottomRight: [31, 32, 33, 34, 35, 36, 37, 38], // Jobb alsó (növekvő)
  bottomLeft: [48, 47, 46, 45, 44, 43, 42, 41], // Bal alsó (csökkenő)
};

export function ImplantPositionsChart({ data }: ImplantPositionsChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Nincs adat megjelenítésre
      </div>
    );
  }

  // Adatok indexelése fog szám szerint
  const dataMap = new Map(data.map(item => [item.fogSzam, item]));

  // Üres értékek létrehozása, ha nincs adat egy pozícióhoz
  const getImplantData = (fogSzam: number) => {
    return dataMap.get(fogSzam) || {
      fogSzam,
      implantatumSzama: 0
    };
  };

  // Kvadráns adatok előkészítése
  const getQuadrantData = (quadrant: number[]) => {
    return quadrant.map(fogSzam => getImplantData(fogSzam));
  };

  const QuadrantChart = ({ 
    title, 
    quadrantData 
  }: { 
    title: string; 
    quadrantData: Array<{ fogSzam: number; implantatumSzama: number }> 
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
              formatter={(value: number | undefined) => [`${value ?? 0} implantátum`, 'Implantátumok száma']}
              labelFormatter={(label) => `${label}. fog pozíció`}
            />
            <Legend />
            <Bar dataKey="implantatumSzama" fill="#10b981" name="Implantátumok száma" />
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
