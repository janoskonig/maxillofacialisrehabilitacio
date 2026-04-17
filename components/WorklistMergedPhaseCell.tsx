'use client';

import type { WorklistItemBackend, WorklistMergedPhasePart, WorklistPhaseJaw } from '@/lib/worklist-types';

function jawLabelHu(jaw: WorklistPhaseJaw): string {
  return jaw === 'felso' ? 'Felső állcsont' : 'Alsó állcsont';
}

function SiteChips({
  toothNumber,
  jaw,
}: {
  toothNumber?: number | null;
  jaw?: WorklistPhaseJaw | null;
}) {
  if (toothNumber == null && jaw == null) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 items-center align-middle">
      {toothNumber != null && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 border border-teal-200/80">
          Fog {toothNumber}
        </span>
      )}
      {jaw != null && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200/80">
          {jawLabelHu(jaw)}
        </span>
      )}
    </span>
  );
}

export function WorklistMergedPhaseCell({ item }: { item: WorklistItemBackend }) {
  const title = item.stepLabel ?? item.nextStep;

  const renderPart = (part: WorklistMergedPhasePart, i: number) => (
    <li key={i} className="break-words flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span>{part.label}</span>
      <SiteChips toothNumber={part.toothNumber} jaw={part.jaw} />
    </li>
  );

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{title}</span>
        {!item.mergedWorkPhase && <SiteChips toothNumber={item.phaseToothNumber} jaw={item.phaseJaw} />}
        {item.mergedWorkPhase && (
          <span className="text-[10px] font-semibold uppercase tracking-wide shrink-0 px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200">
            Összevont munkafázis
          </span>
        )}
        {item.durationMinutes > 0 && (
          <span className="text-xs text-gray-500 shrink-0">
            {item.durationMinutes} perc
            {item.mergedWorkPhase ? ' (blokk)' : ''}
          </span>
        )}
      </div>
      {item.mergedWorkPhase && item.mergedWorkPhaseParts && item.mergedWorkPhaseParts.length > 0 && (
        <div className="text-xs text-gray-600 border-l-2 border-violet-200 pl-2 space-y-1">
          <span className="font-medium text-gray-700">Összetétel:</span>
          <ol className="list-decimal list-inside space-y-1 marker:text-violet-600">
            {item.mergedWorkPhaseParts.map(renderPart)}
          </ol>
        </div>
      )}
    </div>
  );
}
