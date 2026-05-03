'use client';

import { useState, useEffect, useMemo } from 'react';
import { DashboardWidget } from '../DashboardWidget';
import { Activity, ChevronDown, ChevronUp, Info } from 'lucide-react';

type Level = 'low' | 'medium' | 'high' | 'critical' | 'unavailable';

interface DoctorWorkload {
  userId: string;
  name: string;
  weeklyTargetMinutes: number;
  targetCapacityMinutes: number;
  bookedMinutes: number;
  heldMinutes: number;
  committedMinutes: number;
  availableMinutes: number;
  utilizationPct: number;
  calendarUtilizationPct: number | null;
  wipCount: number;
  worklistCount: number;
  overdueCount: number;
  level: Level;
  flags: string[];
}

interface WorkloadResponse {
  horizonDays: number;
  weeklyTargetMinutes: number;
  generatedAt: string;
  doctors: DoctorWorkload[];
}

const HORIZON_OPTIONS = [
  { value: 7, label: '7 nap' },
  { value: 14, label: '14 nap' },
  { value: 30, label: '30 nap' },
  { value: 60, label: '60 nap' },
  { value: 90, label: '90 nap' },
];

const LEVEL_COLORS: Record<Level, string> = {
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
  unavailable: 'bg-gray-400',
};

const LEVEL_LABELS: Record<Level, string> = {
  low: 'Alacsony',
  medium: 'Közepes',
  high: 'Magas',
  critical: 'Kritikus',
  unavailable: 'Nem elérhető',
};

const LEVEL_TEXT_COLORS: Record<Level, string> = {
  low: 'text-green-700',
  medium: 'text-yellow-700',
  high: 'text-orange-700',
  critical: 'text-red-700',
  unavailable: 'text-gray-500',
};

const FLAG_LABELS: Record<string, string> = {
  over_double_target: 'Több mint 2× heti penzum lefoglalva',
  no_calendar_with_pipeline: 'Nincs jövőbeli naptár, de van várólista',
  low_calendar_offer: 'Kevés szabad időpont a horizonton',
};

/** Sáv vizuális hossza %-ban: a tényleges utilizációval arányos, 200%-nál vágunk. */
function barWidth(utilizationPct: number, level: Level): number {
  if (level === 'unavailable') return 0;
  const VISUAL_CAP = 200;
  return Math.min(100, (utilizationPct / VISUAL_CAP) * 100);
}

function formatMinutes(min: number): string {
  if (min === 0) return '0 perc';
  if (min < 60) return `${min} perc`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} óra` : `${h} ó ${m} p`;
}

export function BusynessOMeter() {
  const [data, setData] = useState<WorkloadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [horizonDays, setHorizonDays] = useState(30);
  const [showAll, setShowAll] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/doctors/workload?horizonDays=${horizonDays}&includeDetails=true`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WorkloadResponse | null) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [horizonDays]);

  const doctors = useMemo<DoctorWorkload[]>(() => data?.doctors ?? [], [data]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const headerExtra = (
    <div className="flex items-center gap-2 text-xs">
      <label className="text-gray-500 hidden sm:inline">Horizont</label>
      <select
        value={horizonDays}
        onChange={(e) => setHorizonDays(parseInt(e.target.value, 10))}
        className="border border-gray-200 rounded px-2 py-1 bg-white text-gray-700"
      >
        {HORIZON_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  if (loading) {
    return (
      <DashboardWidget title="Orvos terhelés" icon={<Activity className="w-5 h-5" />}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-gray-500">Heti penzum: 2 óra mindenkinek</span>
          {headerExtra}
        </div>
        <div className="text-center py-4 text-gray-500 text-sm">Betöltés...</div>
      </DashboardWidget>
    );
  }

  const displayed = showAll ? doctors : doctors.slice(0, 4);

  return (
    <DashboardWidget title="Orvos terhelés" icon={<Activity className="w-5 h-5" />}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Info className="w-3.5 h-3.5" />
          <span>
            Heti penzum: <span className="font-medium text-gray-700">2 óra</span>
            {data && (
              <>
                {' '}· cél a horizontra:{' '}
                <span className="font-medium text-gray-700">
                  {formatMinutes(Math.round((120 * data.horizonDays) / 7))}
                </span>
              </>
            )}
          </span>
        </div>
        {headerExtra}
      </div>

      {doctors.length === 0 ? (
        <div className="text-sm text-gray-500 py-2">Nincs megjeleníthető orvos.</div>
      ) : (
        <div className="space-y-1.5">
          {displayed.map((d) => {
            const isExpanded = expandedIds.has(d.userId);
            const width = barWidth(d.utilizationPct, d.level);
            return (
              <div key={d.userId} className="border border-gray-100 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpanded(d.userId)}
                  className="w-full grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-2.5 py-2 hover:bg-gray-50 transition-colors text-left"
                  aria-expanded={isExpanded}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    >
                      ▶
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{d.name}</div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {formatMinutes(d.committedMinutes)} foglalva /{' '}
                        {formatMinutes(d.targetCapacityMinutes)} cél
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-[180px] justify-end">
                    <div
                      className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden shrink-0 relative"
                      title={`Tényleges utilizáció: ${d.utilizationPct}%`}
                    >
                      <div
                        className={`h-full rounded-full transition-all ${LEVEL_COLORS[d.level]}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={`text-xs font-semibold ${LEVEL_TEXT_COLORS[d.level]}`}>
                        {d.utilizationPct}%
                      </span>
                      <span className="text-[10px] text-gray-500">{LEVEL_LABELS[d.level]}</span>
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 bg-gray-50/60 border-t border-gray-100">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <DetailRow
                        label="Foglalt időpontok"
                        value={formatMinutes(d.bookedMinutes)}
                      />
                      <DetailRow label="Hold (még tartott)" value={formatMinutes(d.heldMinutes)} />
                      <DetailRow
                        label="Összesen elkötelezett"
                        value={formatMinutes(d.committedMinutes)}
                      />
                      <DetailRow
                        label={`Heti penzum × ${data?.horizonDays ?? horizonDays}/7`}
                        value={formatMinutes(d.targetCapacityMinutes)}
                      />
                      <DetailRow
                        label="Utilizáció (a célhoz képest)"
                        value={`${d.utilizationPct}%`}
                        highlight={
                          d.utilizationPct >= 200
                            ? 'critical'
                            : d.utilizationPct >= 100
                              ? 'high'
                              : null
                        }
                      />
                      <DetailRow
                        label="Naptár felkínálva"
                        value={
                          d.availableMinutes > 0
                            ? formatMinutes(d.availableMinutes)
                            : 'Nincs jövőbeli slot'
                        }
                      />
                      <DetailRow
                        label="Naptár kihasználtság"
                        value={
                          d.calendarUtilizationPct != null
                            ? `${d.calendarUtilizationPct}%`
                            : '–'
                        }
                      />
                      <DetailRow
                        label="WIP epizódok / worklist"
                        value={`${d.wipCount} / ${d.worklistCount}`}
                      />
                      {d.overdueCount > 0 && (
                        <DetailRow
                          label="Lejárt next-step"
                          value={`${d.overdueCount}`}
                          highlight="critical"
                        />
                      )}
                    </div>

                    {d.flags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.flags.map((f) => (
                          <span
                            key={f}
                            className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200"
                          >
                            {FLAG_LABELS[f] ?? f}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-2 text-[11px] text-gray-500 leading-snug">
                      Számolás: ({formatMinutes(d.bookedMinutes)} foglalt +{' '}
                      {formatMinutes(d.heldMinutes)} hold) ÷{' '}
                      {formatMinutes(d.targetCapacityMinutes)} cél ={' '}
                      <span className="font-medium text-gray-700">{d.utilizationPct}%</span>. A
                      naptári fedezet csak tájékoztató, nem mozgatja a szintet.
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {doctors.length > 4 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="flex items-center gap-1 text-sm text-medical-primary hover:underline w-full justify-center pt-1"
            >
              {showAll ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showAll ? 'Összecsukás' : `${doctors.length - 4} további orvos`}
            </button>
          )}
        </div>
      )}
    </DashboardWidget>
  );
}

function DetailRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'high' | 'critical' | null;
}) {
  const valueClass =
    highlight === 'critical'
      ? 'text-red-700 font-semibold'
      : highlight === 'high'
        ? 'text-orange-700 font-semibold'
        : 'text-gray-800 font-medium';
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-gray-500 truncate">{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
