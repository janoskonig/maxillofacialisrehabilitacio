'use client';

import { useState, useEffect } from 'react';
import { DashboardWidget } from '../DashboardWidget';
import { Activity, ChevronDown, ChevronUp } from 'lucide-react';

interface DoctorWorkload {
  userId: string;
  name: string;
  busynessScore: number;
  level: 'low' | 'medium' | 'high' | 'critical' | 'unavailable';
  utilizationPct?: number;
  bookedMinutes?: number;
  availableMinutes?: number;
  wipCount?: number;
  worklistCount?: number;
  overdueCount?: number;
}

export function BusynessOMeter() {
  const [doctors, setDoctors] = useState<DoctorWorkload[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/doctors/workload?horizonDays=7&includeDetails=true', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { doctors: [] }))
      .then((d) => setDoctors(d.doctors ?? []))
      .catch(() => setDoctors([]))
      .finally(() => setLoading(false));
  }, []);

  const levelColors: Record<string, string> = {
    low: 'bg-green-500',
    medium: 'bg-yellow-500',
    high: 'bg-orange-500',
    critical: 'bg-red-500',
    unavailable: 'bg-gray-400',
  };

  const levelLabels: Record<string, string> = {
    low: 'Alacsony',
    medium: 'Közepes',
    high: 'Magas',
    critical: 'Kritikus',
    unavailable: 'Nem elérhető',
  };

  if (loading) {
    return (
      <DashboardWidget title="Orvos terhelés" icon={<Activity className="w-5 h-5" />}>
        <div className="text-center py-4 text-gray-500 text-sm">Betöltés...</div>
      </DashboardWidget>
    );
  }

  const displayed = expanded ? doctors : doctors.slice(0, 4);

  return (
    <DashboardWidget title="Orvos terhelés" icon={<Activity className="w-5 h-5" />}>
      <div className="space-y-2">
        {displayed.map((d) => (
          <div key={d.userId} className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{d.name}</div>
              {expanded && d.availableMinutes !== undefined && (
                <div className="text-xs text-gray-500">
                  {d.utilizationPct}% kihasználtság · {d.bookedMinutes ?? 0} / {d.availableMinutes ?? 0} perc
                  {d.overdueCount !== undefined && d.overdueCount > 0 && (
                    <span className="ml-1 text-orange-600">{d.overdueCount} lejárt</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${levelColors[d.level] || 'bg-gray-400'}`}
                  style={{ width: `${Math.min(100, d.busynessScore)}%` }}
                />
              </div>
              <span className="text-xs font-medium w-8">{d.busynessScore}</span>
              <span className={`text-xs hidden sm:inline ${d.level === 'critical' ? 'text-red-600' : d.level === 'high' ? 'text-orange-600' : ''}`}>
                {levelLabels[d.level] || d.level}
              </span>
            </div>
          </div>
        ))}
        {doctors.length > 4 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-sm text-medical-primary hover:underline w-full justify-center pt-1"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {expanded ? 'Összecsukás' : `${doctors.length - 4} további`}
          </button>
        )}
      </div>
    </DashboardWidget>
  );
}
