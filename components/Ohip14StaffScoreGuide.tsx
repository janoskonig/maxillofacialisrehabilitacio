'use client';

import { Info } from 'lucide-react';
import type { OHIP14Response } from '@/lib/types';
import { ohip14ResponseValueOptions } from '@/lib/types';
import {
  getOhip14DimensionScores,
  getOhip14ImpactBand,
  getTopOhip14Dimensions,
  OHIP14_IMPACT_BANDS,
  OHIP14_TOTAL_MAX,
} from '@/lib/ohip14-score-interpretation';

interface Ohip14StaffScoreGuideProps {
  /** Aktív timepoint válasza; ha van összpont, részletes értelmezés is megjelenik */
  response?: OHIP14Response | null;
  compact?: boolean;
}

export function Ohip14StaffScoreGuide({ response, compact = false }: Ohip14StaffScoreGuideProps) {
  const totalScore = response?.totalScore;
  const hasScore = totalScore !== undefined && totalScore !== null;
  const band = hasScore ? getOhip14ImpactBand(totalScore) : null;
  const dimensions = hasScore ? getOhip14DimensionScores(response!) : [];
  const topDomains = hasScore ? getTopOhip14Dimensions(response!, 3) : [];

  return (
    <div className="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4">
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-2">
        <Info className="w-3.5 h-3.5 shrink-0" />
        Pontszámértelmezés (OHIP-14)
      </p>

      <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
        A magasabb pontszám <strong>rosszabb</strong> szájhigiénés életminőséget jelöl (0 = nincs hatás,{' '}
        {OHIP14_TOTAL_MAX} = maximális hatás). Válaszok:{' '}
        {ohip14ResponseValueOptions.map((o) => `${o.value} = ${o.label}`).join(', ')}.
      </p>

      {!compact && (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1 pr-2 font-medium">Összpont</th>
                <th className="py-1 pr-2 font-medium">Szint</th>
                <th className="py-1 font-medium">Értelmezés</th>
              </tr>
            </thead>
            <tbody>
              {OHIP14_IMPACT_BANDS.map((b) => (
                <tr key={b.level} className="border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                  <td className="py-1 pr-2 whitespace-nowrap font-mono">
                    {b.min}–{b.max}
                  </td>
                  <td className="py-1 pr-2 whitespace-nowrap">{b.label}</td>
                  <td className="py-1 text-slate-600 dark:text-slate-400">{b.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">
        Dimenziónként max. 8 pont (2 kérdés × 0–4); a legérintettebb dimenziók kiemelése segít a klinikai fókuszt.
      </p>

      {hasScore && band && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Eredmény: {totalScore} / {OHIP14_TOTAL_MAX}
            </span>
            <span className="text-sm font-medium text-medical-primary">{band.label}</span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300">{band.description}</p>

          {topDomains.length > 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-400">
              <strong>Legérintettebb dimenziók:</strong>{' '}
              {topDomains.map((d) => `${d.label} (${d.score}/8)`).join(' · ')}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {dimensions.map((d) => (
              <div
                key={d.key}
                className="flex justify-between gap-2 text-[11px] px-2 py-1 rounded bg-white dark:bg-gray-800 border border-slate-100 dark:border-slate-700"
              >
                <span className="text-slate-700 dark:text-slate-300 truncate">{d.label}</span>
                <span className="text-slate-900 dark:text-slate-100 font-medium shrink-0">
                  {d.score}/8 <span className="text-slate-500 dark:text-slate-400 font-normal">({d.impact})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
