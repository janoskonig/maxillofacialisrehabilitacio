'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface GanttEpisode {
  id: string;
  patientId: string;
  patientName: string;
  reason: string;
  chiefComplaint: string | null;
  status: string;
  openedAt: string;
  closedAt: string | null;
  /** Az aktuális (legutolsó) stádium kódja – az API számolja a stage_events-ből */
  currentStageCode?: string | null;
  /** Mikor lépett az aktuális stádiumba */
  currentStageStart?: string | null;
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

const STAGE_BADGE_COLORS: Record<string, string> = {
  STAGE_0: 'bg-blue-100 text-blue-800 ring-blue-200',
  STAGE_1: 'bg-blue-100 text-blue-800 ring-blue-200',
  STAGE_2: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  STAGE_3: 'bg-violet-100 text-violet-800 ring-violet-200',
  STAGE_4: 'bg-amber-100 text-amber-800 ring-amber-200',
  STAGE_5: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  STAGE_6: 'bg-teal-100 text-teal-800 ring-teal-200',
  STAGE_7: 'bg-slate-100 text-slate-800 ring-slate-200',
};

const CLOSED_GROUP_KEY = '__closed__';
const NO_STAGE_KEY = '__none__';

function getStageColor(stageCode: string): string {
  return STAGE_COLORS[stageCode] ?? 'bg-gray-400';
}

function getStageBadgeColor(stageCode: string): string {
  return STAGE_BADGE_COLORS[stageCode] ?? 'bg-gray-100 text-gray-700 ring-gray-200';
}

function daysBetween(fromIso: string, toMs: number): number {
  const fromMs = new Date(fromIso).getTime();
  if (isNaN(fromMs)) return 0;
  return Math.max(0, Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)));
}

interface StagesGanttChartProps {
  episodes: GanttEpisode[];
  intervals: GanttInterval[];
  catalog: StageCatalogEntry[];
  /** Virtuális ablakok (foglalásra váró lépések) – külön sávban jelennek meg */
  virtualWindows?: GanttVirtualWindow[];
  /** Ha megadva, csak ezek az epizódok jelennek meg (sz\u0171r\u00e9s + sorrend) */
  episodeOrder?: string[];
  /** Ha megadva, az ábra időtengelye és a sávok erre a tartományra vágódnak (pl. utolsó 3 hónap) */
  viewStart?: string;
  viewEnd?: string;
  /** Ha true (alapértelmezett), a betegek aktuális stádium szerint csoportosítva jelennek meg.
   *  Egy beteg nézetnél kapcsold ki. */
  groupByCurrentStage?: boolean;
}

interface PatientRow {
  patientId: string;
  patientName: string;
  episodes: GanttEpisode[];
  openEpisode: GanttEpisode | null;
  /** Csoportosítási kulcs: nyitott epizód aktuális stádiuma, vagy CLOSED_GROUP_KEY */
  groupKey: string;
  /** A bal oldali badge stádium kódja: ha van nyitott epizód, annak aktuális stádiuma; ha nincs, az utolsó stádium */
  badgeStageCode: string | null;
  /** Hozzá tartozó stádium-kezdés (badge mellé "X napja") */
  badgeStageStart: string | null;
  /** A fő panasz (nyitott epizódból, vagy ha nincs, a legutóbbi lezártból) */
  chiefComplaint: string | null;
  /** Sortoláshoz: az aktuális (vagy legutolsó) stádiumba lépés ms-ben; lezárt csoportnál a legutóbbi closed_at */
  sortKey: number;
}

interface PatientGroup {
  key: string;
  stageCode: string | null;
  label: string;
  orderIndex: number;
  isClosedGroup: boolean;
  rows: PatientRow[];
}

export function StagesGanttChart({
  episodes,
  intervals,
  catalog,
  virtualWindows = [],
  episodeOrder,
  viewStart,
  viewEnd,
  groupByCurrentStage,
}: StagesGanttChartProps) {
  const intervalsByEpisode = useMemo(() => {
    const m = new Map<string, GanttInterval[]>();
    for (const iv of intervals) {
      if (!m.has(iv.episodeId)) m.set(iv.episodeId, []);
      m.get(iv.episodeId)!.push(iv);
    }
    return m;
  }, [intervals]);

  const enrichedEpisodes: GanttEpisode[] = useMemo(() => {
    return episodes.map((ep) => {
      if (ep.currentStageCode) return ep;
      const evs = (intervalsByEpisode.get(ep.id) ?? [])
        .slice()
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      const last = evs[evs.length - 1];
      return {
        ...ep,
        currentStageCode: last?.stageCode ?? null,
        currentStageStart: last?.start ?? null,
      };
    });
  }, [episodes, intervalsByEpisode]);

  const filteredEpisodes = useMemo(() => {
    if (!episodeOrder) return enrichedEpisodes;
    const allowed = new Set(episodeOrder);
    return enrichedEpisodes.filter((e) => allowed.has(e.id));
  }, [enrichedEpisodes, episodeOrder]);

  const catalogByCode = useMemo(() => new Map(catalog.map((c) => [c.code, c])), [catalog]);

  const patientRows: PatientRow[] = useMemo(() => {
    const byPatient = new Map<string, GanttEpisode[]>();
    for (const ep of filteredEpisodes) {
      if (!byPatient.has(ep.patientId)) byPatient.set(ep.patientId, []);
      byPatient.get(ep.patientId)!.push(ep);
    }
    return Array.from(byPatient.entries()).map(([patientId, eps]) => {
      const sorted = eps.slice().sort((a: GanttEpisode, b: GanttEpisode) =>
        new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
      );
      const openEpisodes = sorted.filter((e) => e.status === 'open');
      const openEpisode = openEpisodes.length > 0 ? openEpisodes[openEpisodes.length - 1] : null;
      const lastEpisode = sorted[sorted.length - 1];

      let badgeStageCode: string | null = null;
      let badgeStageStart: string | null = null;
      let chiefComplaint: string | null = null;
      let groupKey: string;
      let sortKey: number;

      if (openEpisode) {
        badgeStageCode = openEpisode.currentStageCode ?? null;
        badgeStageStart = openEpisode.currentStageStart ?? null;
        chiefComplaint = openEpisode.chiefComplaint;
        groupKey = badgeStageCode ?? NO_STAGE_KEY;
        sortKey = badgeStageStart ? new Date(badgeStageStart).getTime() : Number.POSITIVE_INFINITY;
      } else {
        badgeStageCode = lastEpisode?.currentStageCode ?? null;
        badgeStageStart = lastEpisode?.currentStageStart ?? null;
        chiefComplaint = lastEpisode?.chiefComplaint ?? null;
        groupKey = CLOSED_GROUP_KEY;
        const lastClosed = sorted
          .filter((e) => e.closedAt)
          .map((e) => new Date(e.closedAt as string).getTime())
          .sort((a, b) => b - a)[0];
        sortKey = lastClosed ? -lastClosed : Number.POSITIVE_INFINITY;
      }

      return {
        patientId,
        patientName: sorted[0]?.patientName ?? patientId,
        episodes: sorted,
        openEpisode,
        groupKey,
        badgeStageCode,
        badgeStageStart,
        chiefComplaint,
        sortKey,
      };
    });
  }, [filteredEpisodes]);

  const shouldGroup = groupByCurrentStage ?? !episodeOrder;

  const groups: PatientGroup[] = useMemo(() => {
    if (!shouldGroup) {
      return [
        {
          key: 'all',
          stageCode: null,
          label: 'Összes beteg',
          orderIndex: 0,
          isClosedGroup: false,
          rows: patientRows.slice().sort((a, b) => a.sortKey - b.sortKey),
        },
      ];
    }
    const byKey = new Map<string, PatientRow[]>();
    for (const row of patientRows) {
      if (!byKey.has(row.groupKey)) byKey.set(row.groupKey, []);
      byKey.get(row.groupKey)!.push(row);
    }
    const result: PatientGroup[] = Array.from(byKey.entries()).map(([key, rows]) => {
      const sortedRows = rows.slice().sort((a: PatientRow, b: PatientRow) => a.sortKey - b.sortKey);
      if (key === CLOSED_GROUP_KEY) {
        return {
          key,
          stageCode: null,
          label: 'Lezárt epizódok',
          orderIndex: Number.POSITIVE_INFINITY - 1,
          isClosedGroup: true,
          rows: sortedRows,
        };
      }
      if (key === NO_STAGE_KEY) {
        return {
          key,
          stageCode: null,
          label: 'Stádium nélkül',
          orderIndex: Number.POSITIVE_INFINITY - 2,
          isClosedGroup: false,
          rows: sortedRows,
        };
      }
      const cat = catalogByCode.get(key);
      return {
        key,
        stageCode: key,
        label: cat?.labelHu ?? key,
        orderIndex: cat?.orderIndex ?? 999,
        isClosedGroup: false,
        rows: sortedRows,
      };
    });
    result.sort((a: PatientGroup, b: PatientGroup) => a.orderIndex - b.orderIndex);
    return result;
  }, [shouldGroup, patientRows, catalogByCode]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasViewRange = viewStart && viewEnd;
  const virtualTimePoints = virtualWindows.flatMap((v) => [
    new Date(v.windowStartDate + 'T00:00:00').getTime(),
    new Date(v.windowEndDate + 'T23:59:59').getTime(),
  ]);
  const tMin = hasViewRange
    ? new Date(viewStart).getTime()
    : Math.min(
        ...intervals.map((i) => new Date(i.start).getTime()),
        ...filteredEpisodes.map((e) => new Date(e.openedAt).getTime()),
        ...(virtualTimePoints.length > 0 ? [Math.min(...virtualTimePoints)] : [])
      );
  const tMax = hasViewRange
    ? new Date(viewEnd).getTime()
    : Math.max(
        ...intervals.map((i) => new Date(i.end).getTime()),
        ...filteredEpisodes.map((e) => (e.closedAt ? new Date(e.closedAt).getTime() : Date.now())),
        ...(virtualTimePoints.length > 0 ? [Math.max(...virtualTimePoints)] : [])
      );
  const rangeMs = Math.max(tMax - tMin, 1);
  const toPercent = (t: number) => ((t - tMin) / rangeMs) * 100;
  const toPercentWidth = (start: number, end: number) => ((end - start) / rangeMs) * 100;

  const hasVirtuals = virtualWindows.length > 0;
  const rowHeight = 40;
  const virtualTrackHeight = 24;
  const patientRowHeight = hasVirtuals ? rowHeight + virtualTrackHeight : rowHeight;
  const headerHeight = 48;
  const groupHeaderHeight = 36;
  const leftLabelWidth = 280;

  const nowMs = Date.now();

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
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
          <span className="h-3 w-3 rounded bg-gray-400 opacity-40" />
          Lezárt epizód (halvány)
        </span>
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
            Beteg / Aktuális stádium
          </div>
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key}>
                {shouldGroup && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center gap-2 px-2 border-b border-gray-200 bg-gray-100 hover:bg-gray-200 text-left"
                    style={{ height: groupHeaderHeight }}
                    title={`${group.label} – ${group.rows.length} beteg`}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                    {group.stageCode && (
                      <span className={`h-3 w-3 rounded ${getStageColor(group.stageCode)}`} />
                    )}
                    {group.isClosedGroup && (
                      <span className="h-3 w-3 rounded bg-gray-400 opacity-40" />
                    )}
                    <span className="text-sm font-semibold text-gray-800 truncate">
                      {group.label}
                    </span>
                    <span className="ml-auto text-xs text-gray-500 tabular-nums">
                      {group.rows.length}
                    </span>
                  </button>
                )}
                {!isCollapsed &&
                  group.rows.map((row) => {
                    const stageLabel = row.badgeStageCode
                      ? catalogByCode.get(row.badgeStageCode)?.labelHu ?? row.badgeStageCode
                      : null;
                    const days = row.badgeStageStart ? daysBetween(row.badgeStageStart, nowMs) : null;
                    const episodeCount = row.episodes.length;
                    const isClosedRow = !row.openEpisode;
                    return (
                      <div
                        key={row.patientId}
                        className="flex flex-col justify-center px-2 border-b border-gray-100 text-sm"
                        style={{ height: patientRowHeight }}
                        title={`${row.patientName} – ${row.chiefComplaint || '–'}${
                          stageLabel
                            ? `\n${isClosedRow ? 'Utolsó (lezárt)' : 'Aktuális'}: ${stageLabel}${
                                days != null ? ` (${days} napja)` : ''
                              }`
                            : ''
                        }${episodeCount > 1 ? `\n${episodeCount} epizód` : ''}`}
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-medium text-gray-900 truncate">{row.patientName}</span>
                          {episodeCount > 1 && (
                            <span className="text-[10px] text-gray-500 bg-gray-200 rounded px-1 tabular-nums whitespace-nowrap">
                              {episodeCount} ep.
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          {row.badgeStageCode ? (
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset whitespace-nowrap ${getStageBadgeColor(
                                row.badgeStageCode
                              )} ${isClosedRow ? 'opacity-60' : ''}`}
                            >
                              {isClosedRow ? `Lezárt · ${stageLabel}` : stageLabel}
                            </span>
                          ) : isClosedRow ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset bg-gray-100 text-gray-600 ring-gray-200">
                              Lezárt
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400">–</span>
                          )}
                          {days != null && !isClosedRow && (
                            <span className="text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
                              {days} napja
                            </span>
                          )}
                          {row.chiefComplaint && (
                            <span className="text-xs text-gray-500 truncate ml-1">
                              · {row.chiefComplaint}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
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

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key}>
                {shouldGroup && (
                  <div
                    className="border-b border-gray-200 bg-gray-100"
                    style={{ height: groupHeaderHeight, minWidth: 800 }}
                  />
                )}
                {!isCollapsed &&
                  group.rows.map((row) => {
                    const allIntervals: Array<GanttInterval & { isClosedEpisode: boolean; episodeStatus: string }> = [];
                    const boundaryMarkers: Array<{ at: number; label: string }> = [];
                    for (const ep of row.episodes) {
                      const epIvs = intervalsByEpisode.get(ep.id) ?? [];
                      const isClosed = ep.status !== 'open';
                      for (const iv of epIvs) {
                        allIntervals.push({ ...iv, isClosedEpisode: isClosed, episodeStatus: ep.status });
                      }
                      if (isClosed && ep.closedAt) {
                        boundaryMarkers.push({
                          at: new Date(ep.closedAt).getTime(),
                          label: `Epizód lezárva: ${new Date(ep.closedAt).toLocaleDateString('hu-HU')}`,
                        });
                      }
                    }
                    const epVirtuals = virtualWindows.filter((v) =>
                      row.episodes.some((e) => e.id === v.episodeId)
                    );
                    const currentEp = row.openEpisode;
                    return (
                      <div
                        key={row.patientId}
                        className="relative border-b border-gray-100"
                        style={{ height: patientRowHeight, minWidth: 800 }}
                      >
                        {/* Track A: Stages from all episodes */}
                        <div className="absolute inset-x-0 top-0" style={{ height: rowHeight }}>
                          {allIntervals.map((iv) => {
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
                            const isCurrent =
                              !iv.isClosedEpisode &&
                              currentEp != null &&
                              currentEp.id === iv.episodeId &&
                              currentEp.currentStageStart === iv.start &&
                              currentEp.currentStageCode === iv.stageCode;
                            return (
                              <div
                                key={`${iv.episodeId}-${iv.stageCode}-${iv.start}`}
                                className={`absolute top-1 bottom-1 rounded ${getStageColor(iv.stageCode)} min-w-[4px] flex items-center justify-center overflow-hidden ${
                                  iv.isClosedEpisode ? 'opacity-40' : ''
                                } ${isCurrent ? 'ring-2 ring-gray-900/40 ring-offset-1' : ''}`}
                                style={{
                                  left: `${left}%`,
                                  width: `${Math.max(width, 2)}%`,
                                }}
                                title={`${label}: ${new Date(iv.start).toLocaleDateString('hu-HU')} – ${
                                  isCurrent
                                    ? 'most'
                                    : new Date(iv.end).toLocaleDateString('hu-HU')
                                }${isCurrent ? ' (aktuális)' : ''}${iv.isClosedEpisode ? ' · lezárt epizód' : ''}`}
                              >
                                {width > 8 && (
                                  <span className="text-xs text-white/90 truncate px-1">{label}</span>
                                )}
                              </div>
                            );
                          })}
                          {/* Episode boundary markers (closed_at) */}
                          {boundaryMarkers.map((m, idx) => {
                            if (hasViewRange && (m.at < tMin || m.at > tMax)) return null;
                            const left = toPercent(m.at);
                            return (
                              <div
                                key={`boundary-${idx}-${m.at}`}
                                className="absolute top-0 bottom-0 border-l-2 border-dotted border-gray-500 pointer-events-none"
                                style={{ left: `${left}%` }}
                                title={m.label}
                              />
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
            );
          })}
        </div>
      </div>

      {patientRows.length === 0 && (
        <div className="py-12 text-center text-gray-500 text-sm">
          Nincs megjeleníthető beteg a kiválasztott szűrőkkel.
        </div>
      )}
    </div>
  );
}
