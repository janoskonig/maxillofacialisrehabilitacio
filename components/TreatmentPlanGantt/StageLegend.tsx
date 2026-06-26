import { stageDisplay } from './stage-display';
import type { StageLegendEntry } from './types';

/** Stádium-jelmagyarázat az egyesített / stádium nézethez — szín → fázisnév
 *  (a nevek a stage_catalog-ból, az API meta.stageLegend-jéből). A szín a kód
 *  szerinti előrehaladást tükrözi. A gondozás (STAGE_7) rejtett a listából. */
const FALLBACK_CODES = ['STAGE_0', 'STAGE_2', 'STAGE_5', 'STAGE_6'] as const;

export function StageLegend({ entries }: { entries?: StageLegendEntry[] }) {
  const items =
    entries && entries.length > 0
      ? entries.filter((e) => e.code !== 'STAGE_7')
      : FALLBACK_CODES.map((code) => ({ code, label: stageDisplay(code).label }));

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span className="text-gray-500 dark:text-gray-400">Stádium:</span>
      {items.map(({ code, label }) => (
        <span key={code} className="inline-flex items-center gap-1.5" title={label}>
          <span
            className={`inline-block w-3.5 h-3.5 rounded-sm shrink-0 ${stageDisplay(code).band} ring-1 ring-inset ring-black/10 dark:ring-white/15`}
            aria-hidden
          />
          <span className="text-gray-700 dark:text-gray-300">{label}</span>
        </span>
      ))}
    </div>
  );
}
