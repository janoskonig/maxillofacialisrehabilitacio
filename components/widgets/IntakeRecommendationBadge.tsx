'use client';

import { useState, useEffect } from 'react';
import { HelpCircle, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface IntakeData {
  recommendation: 'GO' | 'CAUTION' | 'STOP';
  reasons: string[];
  explain: {
    busynessScore: number;
    nearCriticalIfNewStarts: boolean;
    wipCount: number;
    wipCompletionP80Max: string | null;
    wipP80DaysFromNow: number | null;
  };
}

const BADGE_CONFIG = {
  GO: {
    label: 'Fogadhatsz új beteget?',
    sublabel: 'Igen',
    bgClass: 'bg-green-100 text-green-800 border-green-200',
    icon: CheckCircle,
    iconClass: 'text-green-600',
  },
  CAUTION: {
    label: 'Fogadhatsz új beteget?',
    sublabel: 'Óvatosan',
    bgClass: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
  },
  STOP: {
    label: 'Fogadhatsz új beteget?',
    sublabel: 'Nem ajánlott',
    bgClass: 'bg-red-100 text-red-800 border-red-200',
    icon: XCircle,
    iconClass: 'text-red-600',
  },
} as const;

export function IntakeRecommendationBadge() {
  const [data, setData] = useState<IntakeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    fetch('/api/recommendations/intake', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;

  const config = BADGE_CONFIG[data.recommendation];
  const Icon = config.icon;
  const topReasons = data.reasons.slice(0, 2);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setShowTooltip(!showTooltip)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium ${config.bgClass} hover:opacity-90 transition-opacity`}
      >
        <Icon className={`w-4 h-4 ${config.iconClass}`} />
        <span>{config.label}</span>
        <span className="font-semibold">{config.sublabel}</span>
        <HelpCircle className="w-3.5 h-3.5 text-gray-500" />
      </button>

      {showTooltip && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setShowTooltip(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-64 p-3 bg-white border border-gray-200 rounded-lg shadow-lg text-left">
            <p className="text-xs font-medium text-gray-700 mb-2">Indokok:</p>
            <ul className="text-xs text-gray-600 space-y-1">
              {topReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {data.explain.wipP80DaysFromNow != null && (
              <p className="text-xs text-gray-500 mt-2">
                WIP P80 kifutás: +{data.explain.wipP80DaysFromNow} nap
              </p>
            )}
            <a
              href="?tab=workload"
              className="text-xs text-medical-primary hover:underline mt-2 inline-block"
            >
              Részletek →
            </a>
          </div>
        </>
      )}
    </div>
  );
}
