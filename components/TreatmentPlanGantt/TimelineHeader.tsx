import { memo } from 'react';

export interface TimelineHeaderProps {
  t0: number;
  t1: number;
  toPercent: (tMs: number) => number;
  todayPercent: number;
  trackMinWidth: number;
  height?: number;
}

export const TimelineHeader = memo(function TimelineHeader({
  t0,
  t1,
  toPercent,
  todayPercent,
  trackMinWidth,
  height = 40,
}: TimelineHeaderProps) {
  const months: { left: number; label: string; key: string }[] = [];
  const start = new Date(t0);
  const end = new Date(t1);
  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d.getTime() <= end.getTime()) {
    if (d.getTime() <= t1) {
      const left = toPercent(d.getTime());
      months.push({
        left,
        label: d.toLocaleDateString('hu-HU', { month: 'short', year: '2-digit' }),
        key: `${d.getFullYear()}-${d.getMonth()}`,
      });
    }
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }

  const showToday = todayPercent >= -1 && todayPercent <= 101;

  return (
    <div
      className="relative border-b border-gray-200 bg-gray-50/90 shrink-0"
      style={{ height, minWidth: trackMinWidth }}
      role="presentation"
    >
      {months.map((m) => (
        <div
          key={m.key}
          className="absolute top-0 bottom-0 text-[11px] text-gray-500 border-l border-gray-200 pl-1 pt-1 pointer-events-none select-none"
          style={{ left: `${Math.max(0, m.left)}%` }}
        >
          {m.label}
        </div>
      ))}
      {showToday && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-[1] pointer-events-none"
          style={{ left: `${Math.min(100, Math.max(0, todayPercent))}%` }}
          aria-label="Ma"
        />
      )}
    </div>
  );
});
