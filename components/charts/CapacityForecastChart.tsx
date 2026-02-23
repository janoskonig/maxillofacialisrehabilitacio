'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Loader2, TrendingUp } from 'lucide-react';

interface WeekBucket {
  weekStart: string;
  weekLabel: string;
  supply: number;
  hardDemand: number;
  softDemand: number;
}

type Pool = 'consult' | 'work' | 'control';

const POOL_LABELS: Record<Pool, string> = {
  consult: 'Konzultáció',
  work: 'Munkafázis',
  control: 'Kontroll',
};

export function CapacityForecastChart() {
  const [weeks, setWeeks] = useState<WeekBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<Pool>('work');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/capacity-forecast?pool=${pool}&weeks=12`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Nem sikerült betölteni');
        const data = await res.json();
        setWeeks(data.weeks ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [pool]);

  const maxVal = useMemo(() => {
    if (weeks.length === 0) return 1;
    return Math.max(1, ...weeks.map(w => Math.max(w.supply, w.hardDemand + w.softDemand)));
  }, [weeks]);

  const overloadedWeeks = useMemo(
    () => weeks.filter(w => (w.hardDemand + w.softDemand) > w.supply && w.supply > 0).length,
    [weeks]
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-500" />
          <select
            value={pool}
            onChange={(e) => setPool(e.target.value as Pool)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-medical-primary/20 focus:border-medical-primary"
          >
            {Object.entries(POOL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        {overloadedWeeks > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {overloadedWeeks} hét túlterhelt
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-medical-primary" />
          <span className="ml-2 text-sm text-gray-500">Kapacitás betöltése…</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && weeks.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          {/* Legend */}
          <div className="flex items-center gap-4 mb-4 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-400" />
              Szabad kapacitás (supply)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-blue-500" />
              Foglalt (hard demand)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-400" />
              Tervezett (soft demand)
            </span>
          </div>

          {/* Chart */}
          <div className="flex items-end gap-1 h-48">
            {weeks.map((w, idx) => {
              const totalDemand = w.hardDemand + w.softDemand;
              const supplyH = (w.supply / maxVal) * 100;
              const hardH = (w.hardDemand / maxVal) * 100;
              const softH = (w.softDemand / maxVal) * 100;
              const isOverloaded = totalDemand > w.supply && w.supply > 0;

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-0.5 group relative min-w-0">
                  {/* Bars */}
                  <div className="w-full flex gap-px items-end h-40">
                    {/* Supply bar */}
                    <div
                      className="flex-1 bg-emerald-400 rounded-t transition-all"
                      style={{ height: `${supplyH}%`, minHeight: w.supply > 0 ? '2px' : '0' }}
                    />
                    {/* Demand stacked */}
                    <div className="flex-1 flex flex-col justify-end">
                      <div
                        className="bg-amber-400 rounded-t transition-all"
                        style={{ height: `${softH}%`, minHeight: w.softDemand > 0 ? '2px' : '0' }}
                      />
                      <div
                        className={`bg-blue-500 transition-all ${isOverloaded ? 'ring-1 ring-red-500' : ''}`}
                        style={{ height: `${hardH}%`, minHeight: w.hardDemand > 0 ? '2px' : '0' }}
                      />
                    </div>
                  </div>
                  {/* Week label */}
                  <div className="text-[9px] text-gray-400 truncate w-full text-center leading-tight">
                    {w.weekLabel.split(' – ')[0]}
                  </div>

                  {/* Tooltip */}
                  <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-44 p-2 bg-white border border-gray-200 rounded-lg shadow-lg text-xs">
                    <div className="font-semibold text-gray-900 mb-1">{w.weekLabel}</div>
                    <div className="text-emerald-700">Supply: {w.supply}</div>
                    <div className="text-blue-700">Foglalt: {w.hardDemand}</div>
                    <div className="text-amber-700">Tervezett: {w.softDemand}</div>
                    {isOverloaded && (
                      <div className="text-red-600 font-medium mt-0.5">Túlterhelt!</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-gray-400 mt-3 text-center">
            Kereslet a legkorábbi esedékesség hete alapján (window_start)
          </p>
        </div>
      )}

      {!loading && !error && weeks.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          Nincs kapacitás adat a kiválasztott poolhoz.
        </div>
      )}
    </div>
  );
}
