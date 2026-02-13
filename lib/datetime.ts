/**
 * Datetime formatter contract – Europe/Budapest.
 * Minden timestamp komponens ezt használja.
 */

const BUDAPEST_TZ = 'Europe/Budapest';

/**
 * Budapest start-of-day (00:00) ISO string – YYYY-MM-DD boundary.
 * A window end exclusive; window start inclusive.
 */
export function toBudapestStartOfDayISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Abszolút formátum: YYYY-MM-DD HH:mm (Europe/Budapest display).
 */
export function formatAbsDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('hu-HU', {
    timeZone: BUDAPEST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Relatív formátum: „3 nap múlva" / „2 órája".
 */
export function formatRelDateTime(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  const diffMins = Math.round(diffMs / (60 * 1000));

  if (diffDays > 0) {
    if (diffDays === 1) return '1 nap múlva';
    return `${diffDays} nap múlva`;
  }
  if (diffDays < 0) {
    if (diffDays === -1) return '1 napja';
    return `${Math.abs(diffDays)} napja`;
  }
  if (diffHours > 0) {
    if (diffHours === 1) return '1 óra múlva';
    return `${diffHours} óra múlva`;
  }
  if (diffHours < 0) {
    if (diffHours === -1) return '1 órája';
    return `${Math.abs(diffHours)} órája`;
  }
  if (diffMins > 0) return `${diffMins} perc múlva`;
  if (diffMins < 0) return `${Math.abs(diffMins)} perce`;
  return 'most';
}

/**
 * Rövid dátum: 02.12–02.19 (window display).
 */
export function formatShortDateRange(startISO: string, endISO: string): string {
  const s = startISO.split('T')[0];
  const e = endISO.split('T')[0];
  if (!s || !e) return '';
  const [sy, sm, sd] = s.split('-');
  const [ey, em, ed] = e.split('-');
  return `${sd}.${sm}–${ed}.${em}`;
}
