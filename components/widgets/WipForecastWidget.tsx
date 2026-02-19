'use client';

import { useState, useEffect } from 'react';
import { DashboardWidget } from '../DashboardWidget';
import { TrendingUp } from 'lucide-react';

interface AggregateData {
  wipCount: number;
  wipCompletionP50Max: string | null;
  wipCompletionP80Max: string | null;
  wipVisitsRemainingP50Sum: number;
  wipVisitsRemainingP80Sum: number;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}.${day}`;
}

export function WipForecastWidget() {
  const [data, setData] = useState<AggregateData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/forecast/aggregate?horizonDays=120', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <DashboardWidget title="WIP prognózis" icon={<TrendingUp className="w-5 h-5" />}>
        <div className="text-center py-4 text-gray-500 text-sm">Betöltés...</div>
      </DashboardWidget>
    );
  }

  if (!data) {
    return (
      <DashboardWidget title="WIP prognózis" icon={<TrendingUp className="w-5 h-5" />}>
        <div className="text-center py-4 text-gray-500 text-sm">Nem elérhető</div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget title="WIP prognózis" icon={<TrendingUp className="w-5 h-5" />}>
      <div className="space-y-2 text-sm">
        <div>
          <span className="text-gray-600">WIP várható kifutás: </span>
          <span className="font-medium">
            P50 ~{data.wipCompletionP50Max ? formatShortDate(data.wipCompletionP50Max) : '–'}
            {data.wipCompletionP80Max && (
              <span className="text-gray-600 ml-1">
                | P80 ~{formatShortDate(data.wipCompletionP80Max)}
              </span>
            )}
          </span>
        </div>
        <div>
          <span className="text-gray-600">Hátralévő látogatások: </span>
          <span className="font-medium">
            P50 {data.wipVisitsRemainingP50Sum} | P80 {data.wipVisitsRemainingP80Sum}
          </span>
        </div>
        {data.wipCount > 0 && (
          <div className="text-xs text-gray-500 pt-1">
            {data.wipCount} WIP epizód alapján
          </div>
        )}
      </div>
    </DashboardWidget>
  );
}
