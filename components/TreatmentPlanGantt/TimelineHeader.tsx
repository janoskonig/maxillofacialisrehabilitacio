import { memo } from 'react';
import { DAY_MS } from './constants';

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
  height = 48,
}: TimelineHeaderProps) {
  const topH = Math.round(height / 2);

  // Felső sor: hónaphatárok TELJES évszámmal. A korábbi `{month:'short',
  // year:'2-digit'}` formátum „26. jún."-t adott, amit dátumnak (jún. 26.)
  // lehetett olvasni. A négyjegyű év egyértelmű; az évet csak akkor ismételjük,
  // ha vált (vagy az első hónapnál), különben elég a hónapnév.
  const months: { left: number; label: string; key: string }[] = [];
  {
    let d = new Date(new Date(t0).getFullYear(), new Date(t0).getMonth(), 1);
    let prevYear: number | null = null;
    while (d.getTime() <= t1) {
      const sameYear = prevYear === d.getFullYear();
      months.push({
        left: toPercent(d.getTime()),
        label: sameYear
          ? d.toLocaleDateString('hu-HU', { month: 'long' })
          : `${d.getFullYear()}. ${d.toLocaleDateString('hu-HU', { month: 'long' })}`,
        key: `m-${d.getFullYear()}-${d.getMonth()}`,
      });
      prevYear = d.getFullYear();
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }

  // Alsó sor: minden hétfőhöz tick + napi dátum. Szűk nézetben (kis heti
  // pixelszélesség) a tickek megmaradnak, de a címkét elhagyjuk az átfedés ellen.
  const rangeMs = Math.max(1, t1 - t0);
  const weekPx = (trackMinWidth * 7 * DAY_MS) / rangeMs;
  const showMondayLabels = weekPx >= 26;
  const mondays: { left: number; label: string; key: string }[] = [];
  {
    let m = new Date(t0);
    m.setHours(0, 0, 0, 0);
    while (m.getDay() !== 1) m = new Date(m.getTime() + DAY_MS); // ugrás az első hétfőre
    for (; m.getTime() <= t1; m = new Date(m.getTime() + 7 * DAY_MS)) {
      // A hónap első hétfője (1–7-e) kapja a hónap rövidítését is a kontextusért.
      const isFirstMondayOfMonth = m.getDate() <= 7;
      const label = isFirstMondayOfMonth
        ? `${m.toLocaleDateString('hu-HU', { month: 'short' })} ${m.getDate()}`
        : String(m.getDate());
      mondays.push({ left: toPercent(m.getTime()), label, key: `w-${m.getTime()}` });
    }
  }

  const showToday = todayPercent >= -1 && todayPercent <= 101;

  return (
    <div
      className="relative border-b border-gray-200 bg-gray-50/90 shrink-0"
      style={{ height, minWidth: trackMinWidth }}
      role="presentation"
    >
      {/* Hétfő-tickek + napi dátum (alsó sor) */}
      {mondays.map((w) => (
        <div
          key={w.key}
          className="absolute bottom-0 text-[10px] leading-none text-gray-400 border-l border-gray-100 pl-0.5 pt-0.5 pointer-events-none select-none"
          style={{ left: `${Math.max(0, w.left)}%`, top: topH }}
        >
          {showMondayLabels ? w.label : ''}
        </div>
      ))}
      {/* Hónap + év (felső sor) */}
      {months.map((m) => (
        <div
          key={m.key}
          className="absolute top-0 text-[11px] font-medium text-gray-600 border-l border-gray-300 pl-1 pt-0.5 pointer-events-none select-none"
          style={{ left: `${Math.max(0, m.left)}%`, height: topH }}
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
