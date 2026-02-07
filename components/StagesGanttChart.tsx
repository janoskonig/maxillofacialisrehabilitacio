'use client';

export interface GanttEpisode {
  id: string;
  patientId: string;
  patientName: string;
  reason: string;
  chiefComplaint: string | null;
  status: string;
  openedAt: string;
  closedAt: string | null;
}

export interface GanttInterval {
  episodeId: string;
  stageCode: string;
  start: string;
  end: string;
}

export interface StageCatalogEntry {
  code: string;
  labelHu: string;
  orderIndex: number;
}

const STAGE_COLORS: Record<string, string> = {
  STAGE_0: 'bg-blue-400',
  STAGE_1: 'bg-blue-500',
  STAGE_2: 'bg-indigo-500',
  STAGE_3: 'bg-violet-500',
  STAGE_4: 'bg-amber-500',
  STAGE_5: 'bg-emerald-500',
  STAGE_6: 'bg-teal-500',
  STAGE_7: 'bg-slate-500',
};

function getStageColor(stageCode: string): string {
  return STAGE_COLORS[stageCode] ?? 'bg-gray-400';
}

interface StagesGanttChartProps {
  episodes: GanttEpisode[];
  intervals: GanttInterval[];
  catalog: StageCatalogEntry[];
  /** Ha megadva, csak ezek az epizódok jelennek meg (pl. egy beteg szűrésénél) */
  episodeOrder?: string[];
  /** Ha megadva, az ábra időtengelye és a sávok erre a tartományra vágódnak (pl. utolsó 3 hónap) */
  viewStart?: string;
  viewEnd?: string;
}

export function StagesGanttChart({ episodes, intervals, catalog, episodeOrder, viewStart, viewEnd }: StagesGanttChartProps) {
  const order = episodeOrder ?? episodes.map((e) => e.id);
  const displayedEpisodes = order
    .map((id) => episodes.find((e) => e.id === id))
    .filter(Boolean) as GanttEpisode[];

  const hasViewRange = viewStart && viewEnd;
  const tMin = hasViewRange
    ? new Date(viewStart).getTime()
    : Math.min(
        ...intervals.map((i) => new Date(i.start).getTime()),
        ...displayedEpisodes.map((e) => new Date(e.openedAt).getTime())
      );
  const tMax = hasViewRange
    ? new Date(viewEnd).getTime()
    : Math.max(
        ...intervals.map((i) => new Date(i.end).getTime()),
        ...displayedEpisodes.map((e) => (e.closedAt ? new Date(e.closedAt).getTime() : Date.now()))
      );
  const rangeMs = Math.max(tMax - tMin, 1);
  const toPercent = (t: number) => ((t - tMin) / rangeMs) * 100;
  const toPercentWidth = (start: number, end: number) => ((end - start) / rangeMs) * 100;

  const catalogByCode = new Map(catalog.map((c) => [c.code, c]));

  const rowHeight = 40;
  const headerHeight = 48;
  const leftLabelWidth = 220;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      {/* Legend */}
      <div className="flex flex-wrap gap-2 p-3 border-b border-gray-200 bg-gray-50">
        {catalog
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((s) => (
            <span key={s.code} className="inline-flex items-center gap-1.5 text-xs">
              <span className={`h-3 w-3 rounded ${getStageColor(s.code)}`} />
              {s.labelHu}
            </span>
          ))}
      </div>

      <div className="flex" style={{ minWidth: leftLabelWidth + 800 }}>
        {/* Left: labels */}
        <div
          className="flex-shrink-0 border-r border-gray-200 bg-gray-50/80 sticky left-0 z-10"
          style={{ width: leftLabelWidth }}
        >
          <div
            className="flex items-center px-2 text-xs font-medium text-gray-500 border-b border-gray-200"
            style={{ height: headerHeight }}
          >
            Beteg / Epizód
          </div>
          {displayedEpisodes.map((ep) => (
            <div
              key={ep.id}
              className="flex flex-col justify-center px-2 border-b border-gray-100 text-sm truncate"
              style={{ height: rowHeight }}
              title={`${ep.patientName} – ${ep.chiefComplaint || '–'}`}
            >
              <span className="font-medium text-gray-900 truncate">{ep.patientName}</span>
              <span className="text-xs text-gray-500 truncate">{ep.chiefComplaint || '–'}</span>
            </div>
          ))}
        </div>

        {/* Right: time grid + bars */}
        <div className="flex-1 overflow-x-auto" style={{ minWidth: 600 }}>
          <div
            className="relative border-b border-gray-200"
            style={{
              height: headerHeight,
              minWidth: 800,
            }}
          >
            {/* Month ticks - approximate */}
            {(() => {
              const months: { label: string; left: number }[] = [];
              const start = new Date(tMin);
              const end = new Date(tMax);
              let d = new Date(start.getFullYear(), start.getMonth(), 1);
              while (d.getTime() <= end.getTime()) {
                months.push({
                  label: d.toLocaleDateString('hu-HU', { month: 'short', year: '2-digit' }),
                  left: toPercent(d.getTime()),
                });
                d.setMonth(d.getMonth() + 1);
              }
              return months.map((m) => (
                <div
                  key={m.label}
                  className="absolute top-0 bottom-0 text-xs text-gray-500 border-l border-gray-200 pl-1"
                  style={{ left: `${m.left}%`, minWidth: 0 }}
                >
                  {m.label}
                </div>
              ));
            })()}
          </div>

          {displayedEpisodes.map((ep) => {
            const epIntervals = intervals.filter((i) => i.episodeId === ep.id);
            return (
              <div
                key={ep.id}
                className="relative border-b border-gray-100"
                style={{ height: rowHeight, minWidth: 800 }}
              >
                {epIntervals.map((iv) => {
                  let startMs = new Date(iv.start).getTime();
                  let endMs = new Date(iv.end).getTime();
                  if (hasViewRange) {
                    startMs = Math.max(startMs, tMin);
                    endMs = Math.min(endMs, tMax);
                    if (startMs >= endMs) return null;
                  }
                  const left = toPercent(startMs);
                  const width = toPercentWidth(startMs, endMs);
                  const label = catalogByCode.get(iv.stageCode)?.labelHu ?? iv.stageCode;
                  return (
                    <div
                      key={`${iv.episodeId}-${iv.stageCode}-${iv.start}`}
                      className={`absolute top-1 bottom-1 rounded ${getStageColor(iv.stageCode)} min-w-[4px] flex items-center justify-center overflow-hidden`}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 2)}%`,
                      }}
                      title={`${label}: ${new Date(iv.start).toLocaleDateString('hu-HU')} – ${new Date(iv.end).toLocaleDateString('hu-HU')}`}
                    >
                      {width > 8 && (
                        <span className="text-xs text-white/90 truncate px-1">{label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {displayedEpisodes.length === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">
          Nincs megjeleníthető epizód a kiválasztott szűrőkkel.
        </div>
      )}
    </div>
  );
}
