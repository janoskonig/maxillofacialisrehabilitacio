import type { TimelineStepStatus } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const STATUS_CONFIG: Record<
  TimelineStepStatus,
  { bg: string; border: string; text: string; label: string; pattern?: string }
> = {
  completed: { bg: 'bg-emerald-500', border: 'border-emerald-600', text: 'text-white', label: 'Teljesítve' },
  booked: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-white', label: 'Foglalt' },
  planned: {
    bg: 'bg-amber-50',
    border: 'border-amber-400 border-dashed',
    text: 'text-amber-800',
    label: 'Tervezett',
    pattern: 'stripes',
  },
};

export const STATUS_DOT: Record<TimelineStepStatus, string> = {
  completed: '#10b981',
  booked: '#3b82f6',
  planned: '#f59e0b',
};

export const ZOOM_LABELS: Record<string, string> = {
  '14d': '14 nap',
  '30d': '30 nap',
  '90d': '90 nap',
  auto: 'Automatikus',
};

export const LEFT_COL_W = { md: 280, sm: 200 } as const;
