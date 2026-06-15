'use client';

import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameMonth, isToday, startOfWeek, endOfWeek } from 'date-fns';
import { hu } from 'date-fns/locale';
import { CalendarEvent } from './CalendarEvent';
import { VirtualLane } from './VirtualLane';

interface Appointment {
  id: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  dentistEmail: string;
  dentistName?: string | null;
  appointmentStatus?: 'cancelled_by_doctor' | 'cancelled_by_patient' | 'completed' | 'no_show' | null;
  isLate?: boolean;
  cim?: string | null;
  teremszam?: string | null;
}

interface MonthViewProps {
  currentDate: Date;
  appointments: Appointment[];
  appointmentsByDate: Record<string, Appointment[]>;
  virtualAppointments?: any[];
  virtualAppointmentsByDate?: Record<string, any[]>;
  includeVirtual?: boolean;
  onDateClick?: (date: Date) => void;
  onAppointmentClick?: (appointment: Appointment) => void;
}

export function MonthView({
  currentDate,
  appointments,
  appointmentsByDate,
  virtualAppointments = [],
  virtualAppointmentsByDate = {},
  includeVirtual = false,
  onDateClick,
  onAppointmentClick,
}: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  
  const weekDays = ['H', 'K', 'Sz', 'Cs', 'P', 'Sz', 'V'];

  const getAppointmentsForDate = (date: Date): Appointment[] => {
    const dateKey = format(date, 'yyyy-MM-dd');
    return appointmentsByDate[dateKey] || [];
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
      {/* Week day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800">
        {weekDays.map((day, index) => (
          <div
            key={index}
            className="p-1 sm:p-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const dayAppointments = getAppointmentsForDate(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isCurrentDay = isToday(day);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          return (
            <div
              key={index}
              className={`min-h-[64px] sm:min-h-[100px] border-r border-b border-gray-200 dark:border-gray-800 p-0.5 sm:p-1 ${
                !isCurrentMonth
                  ? 'bg-gray-50 dark:bg-gray-950/40'
                  : isWeekend
                  ? 'bg-gray-50 dark:bg-gray-800/40'
                  : 'bg-white dark:bg-gray-900'
              } cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors`}
              onClick={() => onDateClick?.(day)}
            >
              <div
                className={`text-xs font-medium mb-0.5 sm:mb-1 ${
                  isCurrentDay
                    ? 'bg-blue-600 text-white rounded-full w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center mx-auto'
                    : isCurrentMonth
                    ? 'text-gray-900 dark:text-gray-100 text-center'
                    : 'text-gray-400 dark:text-gray-600 text-center'
                }`}
              >
                {format(day, 'd')}
              </div>
              <div className="space-y-0.5 hidden sm:block">
                {dayAppointments.slice(0, 3).map((appointment) => (
                  <div
                    key={appointment.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAppointmentClick?.(appointment);
                    }}
                  >
                    <CalendarEvent
                      appointment={appointment}
                      onClick={() => onAppointmentClick?.(appointment)}
                      compact
                    />
                  </div>
                ))}
                {includeVirtual && (virtualAppointmentsByDate[format(day, 'yyyy-MM-dd')] || []).length > 0 && (
                  <VirtualLane
                    items={virtualAppointmentsByDate[format(day, 'yyyy-MM-dd')] || []}
                    mode="month"
                    cellDate={day}
                    maxVisible={2}
                  />
                )}
                {dayAppointments.length > 3 && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 px-1">
                    +{dayAppointments.length - 3} további
                  </div>
                )}
              </div>
              {/* Mobile: count pill (tap the day to open it) */}
              {dayAppointments.length > 0 && (
                <div className="sm:hidden flex justify-center mt-1">
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-blue-600 text-white text-[11px] font-semibold leading-none">
                    {dayAppointments.length}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

