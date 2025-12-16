'use client';

interface WaitingTimeChartProps {
  atlagNapokban: number;
  medianNapokban: number;
  minNapokban: number;
  maxNapokban: number;
  betegSzamaIdoponttal: number;
}

export function WaitingTimeChart({
  atlagNapokban,
  medianNapokban,
  minNapokban,
  maxNapokban,
  betegSzamaIdoponttal
}: WaitingTimeChartProps) {
  return (
    <div className="space-y-6">
      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4">
        <p className="text-sm text-gray-600 mb-2">
          Összesen <span className="font-semibold">{betegSzamaIdoponttal}</span> betegnek van időpontja
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-600 font-medium">Átlagos várakozási idő</p>
          <p className="text-2xl font-bold text-blue-900">{atlagNapokban.toFixed(1)} nap</p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <p className="text-sm text-green-600 font-medium">Medián várakozási idő</p>
          <p className="text-2xl font-bold text-green-900">{medianNapokban.toFixed(1)} nap</p>
        </div>
        <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
          <p className="text-sm text-orange-600 font-medium">Legrövidebb várakozás</p>
          <p className="text-2xl font-bold text-orange-900">{minNapokban.toFixed(1)} nap</p>
        </div>
        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
          <p className="text-sm text-red-600 font-medium">Leghosszabb várakozás</p>
          <p className="text-2xl font-bold text-red-900">{maxNapokban.toFixed(1)} nap</p>
        </div>
      </div>
    </div>
  );
}
