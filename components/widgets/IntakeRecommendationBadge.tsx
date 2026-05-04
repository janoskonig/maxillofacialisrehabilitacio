'use client';

import { useState, useEffect } from 'react';
import { HelpCircle, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

type ViewMode = 'PERSONAL' | 'TEAM';

interface IntakeData {
  recommendation: 'GO' | 'CAUTION' | 'STOP';
  reasons: string[];
  explain: {
    viewMode: ViewMode;
    busynessScore: number;
    nearCriticalIfNewStarts: boolean;
    wipCount: number;
    wipCompletionP80Max: string | null;
    wipP80DaysFromNow: number | null;
    nextIntakeDate: string | null;
  };
}

const BADGE_CONFIG = {
  GO: {
    bgClass: 'bg-green-100 text-green-800 border-green-200',
    icon: CheckCircle,
    iconClass: 'text-green-600',
  },
  CAUTION: {
    bgClass: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
  },
  STOP: {
    bgClass: 'bg-red-100 text-red-800 border-red-200',
    icon: XCircle,
    iconClass: 'text-red-600',
  },
} as const;

const HU_DATE_FMT = new Intl.DateTimeFormat('hu-HU', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

function formatHuDate(iso: string): string {
  // pl. „2026. máj. 18." — a végét vágjuk a ragozhatósághoz
  return HU_DATE_FMT.format(new Date(iso)).replace(/\.\s*$/, '');
}

function buildBadgeText(
  recommendation: 'GO' | 'CAUTION' | 'STOP',
  nextIntakeDate: string | null,
  viewMode: ViewMode
): { label: string; sublabel: string } {
  const verb = viewMode === 'TEAM' ? 'Beutalhatsz' : 'Fogadhatsz';
  const stopLabel =
    viewMode === 'TEAM' ? 'Új beteg beutalása várhatóan:' : 'Új beteg várhatóan:';

  if (recommendation === 'GO') {
    return { label: `${verb} új beteget?`, sublabel: 'Igen' };
  }
  if (!nextIntakeDate) {
    return {
      label: `${verb} új beteget?`,
      sublabel: recommendation === 'CAUTION' ? 'Óvatosan' : 'Egyelőre nem',
    };
  }
  const dateStr = formatHuDate(nextIntakeDate);
  if (recommendation === 'CAUTION') {
    return {
      label: `${verb} új beteget?`,
      sublabel: `Óvatosan, GO várhatóan ${dateStr}-tól`,
    };
  }
  return { label: stopLabel, sublabel: `${dateStr}-tól` };
}

function humanizeReason(code: string, viewMode: ViewMode): string {
  const scope = viewMode === 'TEAM' ? 'csapat' : 'saját';
  if (code === 'OK') return `Megfelelő ${scope} kapacitás`;
  if (code === 'NEAR_CRITICAL_IF_NEW_STARTS')
    return viewMode === 'TEAM'
      ? 'Valamelyik orvosnál nincs szabad időblokk a folyamatban lévő betegekhez'
      : 'Saját szabad időblokk hiányzik a folyamatban lévő betegekhez';

  if (/^BUSYNESS_\d+$/.test(code))
    return viewMode === 'TEAM'
      ? 'Magas csapatterhelés (legterheltebb orvos foglalt+hold percei a heti penzumhoz képest)'
      : 'Magas saját terhelés (foglalt+hold a heti penzumhoz képest)';

  if (/^WIP_P80_END_\+(\d+)D$/.test(code))
    return viewMode === 'TEAM'
      ? 'A folyamatban lévő kezelések befejezése a szokásosnál távolabbra esik'
      : 'Saját folyamatban lévő kezelések befejezése a szokásosnál távolabbra esik';

  return code;
}

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
  const { label, sublabel } = buildBadgeText(
    data.recommendation,
    data.explain.nextIntakeDate,
    data.explain.viewMode
  );

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setShowTooltip(!showTooltip)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium ${config.bgClass} hover:opacity-90 transition-opacity`}
      >
        <Icon className={`w-4 h-4 ${config.iconClass}`} />
        <span>{label}</span>
        <span className="font-semibold">{sublabel}</span>
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
            <p className="text-xs font-medium text-gray-700 mb-2">Miért ez a javaslat?</p>
            <ul className="text-xs text-gray-600 space-y-1">
              {topReasons.map((r) => (
                <li key={r}>• {humanizeReason(r, data.explain.viewMode)}</li>
              ))}
            </ul>
            <a
              href="/workload"
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
