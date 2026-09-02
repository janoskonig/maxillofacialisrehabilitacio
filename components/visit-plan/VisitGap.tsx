'use client';

/**
 * Két alkalom közti lépésköz („↓ 1 hét") — kattintva gyors-választó
 * (1/2/3 nap, 1/2/3/4 hét) + szabad napszám. A vizit days_offset-je az
 * egyetlen időbeli távolság a tervben; a fázisnak nincs saját várakozása.
 */
import { useState } from 'react';
import { ArrowDown, Check } from 'lucide-react';
import { Popover, MenuHeading } from './Popover';
import { VISIT_GAP_PRESETS_DAYS, formatVisitGap } from '@/lib/visit-plan-constants';

export interface VisitGapProps {
  days: number;
  onChange: (days: number) => void;
  disabled?: boolean;
}

export function VisitGap({ days, onChange, disabled }: VisitGapProps) {
  const [custom, setCustom] = useState<string>('');
  return (
    <div className="flex items-center gap-2 pl-3 py-0.5" data-testid="visit-gap">
      <span className="w-px h-3 bg-gray-300 dark:bg-gray-700 ml-3" aria-hidden />
      <Popover
        align="left"
        widthClass="w-56"
        disabled={disabled}
        triggerTitle="Az előző alkalom után ennyi idő teljen el"
        triggerAriaLabel={`Vizitköz: ${formatVisitGap(days)}`}
        triggerClassName="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-medical-primary/10 hover:text-medical-primary transition-colors disabled:opacity-50"
        trigger={
          <>
            <ArrowDown className="w-3 h-3" />
            {formatVisitGap(days)}
          </>
        }
      >
        {(close) => (
          <div>
            <MenuHeading>Az előző alkalom után</MenuHeading>
            <div className="grid grid-cols-4 gap-1 px-1 pb-1">
              {VISIT_GAP_PRESETS_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onChange(d);
                    close();
                  }}
                  className={`px-1.5 py-1 rounded text-xs font-medium transition-colors ${
                    d === days
                      ? 'bg-medical-primary text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-medical-primary/10 hover:text-medical-primary'
                  }`}
                >
                  {formatVisitGap(d)}
                </button>
              ))}
            </div>
            <form
              className="flex items-center gap-1 px-1 pb-1"
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(custom, 10);
                if (Number.isInteger(n) && n >= 0) {
                  onChange(n);
                  setCustom('');
                  close();
                }
              }}
            >
              <input
                type="number"
                min={0}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder={String(days)}
                aria-label="Vizitköz napokban"
                className="w-16 text-xs border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-center bg-white dark:bg-gray-900"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">nap</span>
              <button
                type="submit"
                className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-medical-primary hover:bg-medical-primary/10 rounded"
              >
                <Check className="w-3 h-3" /> OK
              </button>
            </form>
          </div>
        )}
      </Popover>
    </div>
  );
}
