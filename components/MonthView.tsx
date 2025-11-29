'use client';

import { startOfMonth, endOfMonth, eachDayOfInterval, format, isSameMonth, isToday, isSameDay, startOfWeek, endOfWeek } from 'date-fns';
import { hu } from 'date-fns/locale';
import { CalendarEvent } from './CalendarEvent';

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
  onDateClick?: (date: Date) => void;
  onAppointmentClick?: (appointment: Appointment) => void;
}

export function MonthView({
  currentDate,
  appointments,
  appointmentsByDate,
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
    <div className="bg-white rounded-lg border overflow-hidden">
      {/* Week day headers */}
      <div className="grid grid-cols-7 border-b">
        {weekDays.map((day, index) => (
          <div
            key={index}
            className="p-1 sm:p-2 text-center text-xs font-semibold text-gray-600 bg-gray-50"
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
              className={`min-h-[60px] sm:min-h-[100px] border-r border-b p-0.5 sm:p-1 ${
                !isCurrentMonth ? 'bg-gray-50' : 'bg-white'
              } ${isWeekend ? 'bg-gray-50' : ''} cursor-pointer hover:bg-blue-50 transition-colors`}
              onClick={() => onDateClick?.(day)}
            >
              <div
                className={`text-xs font-medium mb-0.5 sm:mb-1 ${
                  isCurrentDay
                    ? 'bg-blue-600 text-white rounded-full w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center mx-auto'
                    : isCurrentMonth
                    ? 'text-gray-900 text-center'
                    : 'text-gray-400 text-center'
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
                {dayAppointments.length > 3 && (
                  <div className="text-xs text-gray-500 px-1">
                    +{dayAppointments.length - 3} további
                  </div>
                )}
              </div>
              {/* Mobile: Show dot indicator */}
              {dayAppointments.length > 0 && (
                <div className="sm:hidden flex justify-center mt-0.5">
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

