'use client';

import { CalendarClock } from 'lucide-react';

export interface VirtualAppointmentItem {
  virtualKey: string;
  episodeId: string;
  patientName: string;
  stepCode: string;
  stepLabel: string;
  pool: string;
  durationMinutes: number;
  windowStartDate: string;
  windowEndDate: string;
  worklistUrl: string;
  assignedProviderName?: string | null;
}

interface VirtualCalendarChipProps {
  item: VirtualAppointmentItem;
  onClick?: () => void;
  compact?: boolean;
}

export function VirtualCalendarChip({ item, onClick, compact = false }: VirtualCalendarChipProps) {
  const windowLabel =
    item.windowStartDate === item.windowEndDate
      ? item.windowStartDate
      : `${item.windowStartDate} – ${item.windowEndDate}`;

  const tooltip = [
    item.patientName,
    item.stepLabel,
    `Ablak: ${windowLabel}`,
    `${item.durationMinutes} perc`,
    item.pool,
    item.assignedProviderName ? `Orvos: ${item.assignedProviderName}` : null,
    'Még nem foglalt – foglalás a munkalistából',
  ]
    .filter(Boolean)
    .join('\n');

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          if (onClick) {
            onClick();
          } else {
            window.location.href = item.worklistUrl;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (onClick) onClick();
            else window.location.href = item.worklistUrl;
          }
        }}
        className="opacity-60 border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-xs cursor-pointer hover:opacity-80 hover:bg-amber-100 transition-all rounded"
        title={tooltip}
      >
        <div className="flex items-center gap-1">
          <CalendarClock className="w-3 h-3 text-amber-600 flex-shrink-0" />
          <span className="font-medium text-amber-800 truncate">
            {item.patientName} – {item.stepLabel}
          </span>
        </div>
        <div className="text-[10px] text-amber-600 truncate mt-0.5">{windowLabel}</div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) {
          onClick();
        } else {
          window.location.href = item.worklistUrl;
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onClick) onClick();
          else window.location.href = item.worklistUrl;
        }
      }}
      className="opacity-60 border-2 border-dashed border-amber-400 bg-amber-50 px-3 py-2 rounded-r cursor-pointer hover:opacity-80 hover:bg-amber-100 transition-all"
      title={tooltip}
    >
      <div className="flex items-start gap-2">
        <CalendarClock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-amber-900 truncate">{item.patientName}</div>
          <div className="text-sm text-amber-700 truncate">{item.stepLabel}</div>
          <div className="text-xs text-amber-600 mt-0.5">Ablak: {windowLabel}</div>
          <div className="text-xs text-amber-500 mt-0.5">Nem foglalt – kattintson a munkalistához</div>
        </div>
      </div>
    </div>
  );
}
