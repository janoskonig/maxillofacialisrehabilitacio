'use client';

interface WaitingTimeChartProps {
  atlagNapokban: number;
  medianNapokban: number;
  szorasNapokban?: number;
  minNapokban: number;
  maxNapokban: number;
  betegSzamaIdoponttal: number;
}

export function WaitingTimeChart({
  atlagNapokban,
  medianNapokban,
  szorasNapokban,
  minNapokban,
  maxNapokban,
  betegSzamaIdoponttal
}: WaitingTimeChartProps) {
  return (
    <div className="space-y-6">
      <div className="bg-gray-50 dark:bg-gray-800/60 p-4 rounded-lg border border-gray-200 dark:border-gray-800 mb-4">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Összesen <span className="font-semibold">{betegSzamaIdoponttal}</span> betegnek van időpontja
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 dark:bg-blue-950/40 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-600 dark:text-blue-300 font-medium">Átlagos várakozási idő</p>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-200">
            {atlagNapokban.toFixed(1)}
            {szorasNapokban !== undefined && szorasNapokban !== null && (
              <span className="text-lg font-normal"> ± {szorasNapokban.toFixed(1)}</span>
            )}
            <span className="text-base font-normal"> nap</span>
          </p>
        </div>
        <div className="bg-green-50 dark:bg-green-950/40 p-4 rounded-lg border border-green-200 dark:border-green-800">
          <p className="text-sm text-green-600 dark:text-green-300 font-medium">Medián várakozási idő</p>
          <p className="text-2xl font-bold text-green-900 dark:text-green-200">{medianNapokban.toFixed(1)} nap</p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-950/40 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
          <p className="text-sm text-orange-600 dark:text-orange-300 font-medium">Legrövidebb várakozás</p>
          <p className="text-2xl font-bold text-orange-900 dark:text-orange-200">{minNapokban.toFixed(1)} nap</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950/40 p-4 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-300 font-medium">Leghosszabb várakozás</p>
          <p className="text-2xl font-bold text-red-900 dark:text-red-200">{maxNapokban.toFixed(1)} nap</p>
        </div>
      </div>
    </div>
  );
}
