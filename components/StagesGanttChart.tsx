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

export interface GanttVirtualWindow {
  episodeId: string;
  virtualKey: string;
  patientName: string;
  stepCode: string;
  stepLabel: string;
  pool: string;
  durationMinutes: number;
  windowStartDate: string;
  windowEndDate: string;
  worklistUrl: string;
  worklistParams: { episodeId: string; stepCode: string; pool: string };
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
  /** Virtuális ablakok (foglalásra váró lépések) – külön sávban jelennek meg */
  virtualWindows?: GanttVirtualWindow[];
  /** Ha megadva, csak ezek az epizódok jelennek meg (pl. egy beteg szűrésénél) */
  episodeOrder?: string[];
  /** Ha megadva, az ábra időtengelye és a sávok erre a tartományra vágódnak (pl. utolsó 3 hónap) */
  viewStart?: string;
  viewEnd?: string;
}

export function StagesGanttChart({ episodes, intervals, catalog, virtualWindows = [], episodeOrder, viewStart, viewEnd }: StagesGanttChartProps) {
  const order = episodeOrder ?? episodes.map((e) => e.id);
  const displayedEpisodes = order
    .map((id) => episodes.find((e) => e.id === id))
    .filter(Boolean) as GanttEpisode[];

  const hasViewRange = viewStart && viewEnd;
  const virtualTimePoints = virtualWindows.flatMap((v) => [
    new Date(v.windowStartDate + 'T00:00:00').getTime(),
    new Date(v.windowEndDate + 'T23:59:59').getTime(),
  ]);
  const tMin = hasViewRange
    ? new Date(viewStart).getTime()
    : Math.min(
        ...intervals.map((i) => new Date(i.start).getTime()),
        ...displayedEpisodes.map((e) => new Date(e.openedAt).getTime()),
        ...(virtualTimePoints.length > 0 ? [Math.min(...virtualTimePoints)] : [])
      );
  const tMax = hasViewRange
    ? new Date(viewEnd).getTime()
    : Math.max(
        ...intervals.map((i) => new Date(i.end).getTime()),
        ...displayedEpisodes.map((e) => (e.closedAt ? new Date(e.closedAt).getTime() : Date.now())),
        ...(virtualTimePoints.length > 0 ? [Math.max(...virtualTimePoints)] : [])
      );
  const rangeMs = Math.max(tMax - tMin, 1);
  const toPercent = (t: number) => ((t - tMin) / rangeMs) * 100;
  const toPercentWidth = (start: number, end: number) => ((end - start) / rangeMs) * 100;

  const catalogByCode = new Map(catalog.map((c) => [c.code, c]));

  const hasVirtuals = virtualWindows.length > 0;
  const rowHeight = 40;
  const virtualTrackHeight = 24;
  const episodeRowHeight = hasVirtuals ? rowHeight + virtualTrackHeight : rowHeight;
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
        {hasVirtuals && (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="h-3 w-3 rounded border-2 border-dashed border-amber-400 bg-amber-50" />
            Várható lépés (nem foglalt)
          </span>
        )}
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
              style={{ height: episodeRowHeight }}
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
            const epVirtuals = virtualWindows.filter((v) => v.episodeId === ep.id);
            return (
              <div
                key={ep.id}
                className="relative border-b border-gray-100"
                style={{ height: episodeRowHeight, minWidth: 800 }}
              >
                {/* Track A: Stages */}
                <div className="absolute inset-x-0 top-0" style={{ height: rowHeight }}>
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
                {/* Track B: Virtual windows */}
                {hasVirtuals && (
                  <div
                    className="absolute inset-x-0 flex items-center"
                    style={{ top: rowHeight, height: virtualTrackHeight }}
                  >
                    {epVirtuals.map((vw) => {
                      const startMs = new Date(vw.windowStartDate + 'T00:00:00').getTime();
                      const endMs = new Date(vw.windowEndDate + 'T23:59:59').getTime();
                      let left = toPercent(startMs);
                      let width = toPercentWidth(startMs, endMs);
                      if (hasViewRange) {
                        const clampedStart = Math.max(startMs, tMin);
                        const clampedEnd = Math.min(endMs, tMax);
                        if (clampedStart >= clampedEnd) return null;
                        left = toPercent(clampedStart);
                        width = toPercentWidth(clampedStart, clampedEnd);
                      }
                      return (
                        <a
                          key={vw.virtualKey}
                          href={vw.worklistUrl}
                          className="absolute opacity-60 border-2 border-dashed border-amber-400 bg-amber-50 rounded min-w-[4px] flex items-center justify-center overflow-hidden hover:opacity-80 hover:bg-amber-100 transition-all"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(width, 2)}%`,
                            top: 2,
                            bottom: 2,
                          }}
                          title={`${vw.stepLabel} (${vw.patientName}): ${vw.windowStartDate} – ${vw.windowEndDate}. Még nem foglalt – kattintson a munkalistához.`}
                        >
                          {width > 10 && (
                            <span className="text-[10px] text-amber-800 truncate px-1">
                              {vw.stepLabel}
                            </span>
                          )}
                        </a>
                      );
                    })}
                  </div>
                )}
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
