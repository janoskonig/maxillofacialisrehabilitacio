'use client';

import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { VirtualCalendarChip, type VirtualAppointmentItem } from './VirtualCalendarChip';

interface VirtualLaneProps {
  label?: string;
  items: VirtualAppointmentItem[];
  /** For day view: show as list. For week: show chips in day columns. For month: show count + popover. */
  mode: 'day' | 'week' | 'month';
  /** For week view: dates to show columns for */
  weekDates?: Date[];
  /** For day view: current date key */
  dateKey?: string;
  /** For month: date of the cell */
  cellDate?: Date;
  maxVisible?: number;
}

export function VirtualLane({
  label = 'Foglalásra vár (virtuális)',
  items,
  mode,
  weekDates,
  dateKey,
  cellDate,
  maxVisible = 5,
}: VirtualLaneProps) {
  if (items.length === 0) return null;

  if (mode === 'month' && cellDate) {
    const dayKey = format(cellDate, 'yyyy-MM-dd');
    const dayItems = items.filter((v) => {
      const start = v.windowStartDate;
      const end = v.windowEndDate;
      return dayKey >= start && dayKey <= end;
    });
    if (dayItems.length === 0) return null;
    return (
      <div className="mt-1 space-y-0.5">
        {dayItems.slice(0, maxVisible).map((item) => (
          <VirtualCalendarChip key={item.virtualKey} item={item} compact />
        ))}
        {dayItems.length > maxVisible && (
          <div className="text-xs text-amber-600 px-1">
            +{dayItems.length - maxVisible} további
          </div>
        )}
      </div>
    );
  }

  if (mode === 'week' && weekDates) {
    return (
      <div className="grid grid-cols-8 border-b border-amber-100 bg-amber-50/50">
        <div className="p-2 border-r border-amber-200 text-xs font-medium text-amber-800 flex items-center">
          {label}
        </div>
        {weekDates.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd');
          const dayItems = items.filter((v) => dayKey >= v.windowStartDate && dayKey <= v.windowEndDate);
          return (
            <div
              key={dayKey}
              className="p-1 border-r border-amber-100 min-h-[2rem] space-y-1"
            >
              {dayItems.slice(0, 3).map((item) => (
                <VirtualCalendarChip key={item.virtualKey} item={item} compact />
              ))}
              {dayItems.length > 3 && (
                <div className="text-[10px] text-amber-600">+{dayItems.length - 3}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // mode === 'day' or fallback
  const displayItems = dateKey
    ? items.filter((v) => dateKey >= v.windowStartDate && dateKey <= v.windowEndDate)
    : items;

  if (displayItems.length === 0) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50/50 p-3">
      <div className="text-xs font-medium text-amber-800 mb-2">{label}</div>
      <div className="space-y-2">
        {displayItems.slice(0, maxVisible).map((item) => (
          <VirtualCalendarChip key={item.virtualKey} item={item} />
        ))}
        {displayItems.length > maxVisible && (
          <div className="text-xs text-amber-600">
            +{displayItems.length - maxVisible} további virtuális időpont
          </div>
        )}
      </div>
    </div>
  );
}
