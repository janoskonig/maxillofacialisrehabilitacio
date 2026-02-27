'use client';

import { startOfWeek, endOfWeek, eachDayOfInterval, format, isToday } from 'date-fns';
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

interface WeekViewProps {
  currentDate: Date;
  appointments: Appointment[];
  appointmentsByDate: Record<string, Appointment[]>;
  virtualAppointmentsByDate?: Record<string, any[]>;
  includeVirtual?: boolean;
  onAppointmentClick?: (appointment: Appointment) => void;
}

export function WeekView({
  currentDate,
  appointments,
  appointmentsByDate,
  virtualAppointmentsByDate = {},
  includeVirtual = false,
  onAppointmentClick,
}: WeekViewProps) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Collect all virtual items for the week
  const weekVirtualItems: any[] = [];
  if (includeVirtual) {
    const seen = new Set<string>();
    days.forEach((day) => {
      const dateKey = format(day, 'yyyy-MM-dd');
      (virtualAppointmentsByDate[dateKey] || []).forEach((v: any) => {
        if (!seen.has(v.virtualKey)) {
          seen.add(v.virtualKey);
          weekVirtualItems.push(v);
        }
      });
    });
  }

  // Show hours 07:00-17:00 (08:00-16:00 with buffer)
  const hours = Array.from({ length: 11 }, (_, i) => i + 7); // 7, 8, 9, ..., 17

  const getAppointmentsForDate = (date: Date): Appointment[] => {
    const dateKey = format(date, 'yyyy-MM-dd');
    return appointmentsByDate[dateKey] || [];
  };

  const getAppointmentsForHour = (date: Date, hour: number): Appointment[] => {
    const dayAppointments = getAppointmentsForDate(date);
    return dayAppointments.filter((apt) => {
      const aptDate = new Date(apt.startTime);
      return aptDate.getHours() === hour;
    });
  };

  return (
    <div className="bg-white rounded-lg border overflow-x-auto">
      <div className="min-w-full sm:min-w-[800px]">
        {/* Virtual lane - top */}
        {includeVirtual && weekVirtualItems.length > 0 && (
          <VirtualLane items={weekVirtualItems} mode="week" weekDates={days} />
        )}

        {/* Day headers */}
        <div className="grid grid-cols-8 border-b sticky top-0 bg-white z-10">
          <div className="p-2 border-r"></div>
          {days.map((day) => {
            const isCurrentDay = isToday(day);
            return (
              <div
                key={day.toISOString()}
                className={`p-2 text-center border-r ${
                  isCurrentDay ? 'bg-blue-50' : 'bg-gray-50'
                }`}
              >
                <div className="text-xs font-medium text-gray-600">
                  {format(day, 'EEEE', { locale: hu })}
                </div>
                <div
                  className={`text-lg font-bold ${
                    isCurrentDay ? 'text-blue-600' : 'text-gray-900'
                  }`}
                >
                  {format(day, 'd')}
                </div>
                <div className="text-xs text-gray-500">
                  {format(day, 'MMM', { locale: hu })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time slots */}
        <div className="grid grid-cols-8">
          {/* Hour labels */}
          <div className="border-r">
            {hours.map((hour) => (
              <div
                key={hour}
                className="h-16 border-b p-1 text-xs text-gray-500 text-right pr-2"
              >
                {hour.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => (
            <div key={day.toISOString()} className="border-r">
              {hours.map((hour) => {
                const hourAppointments = getAppointmentsForHour(day, hour);
                return (
                  <div
                    key={`${day.toISOString()}-${hour}`}
                    className="h-16 border-b p-1"
                  >
                    {hourAppointments.map((appointment) => (
                      <CalendarEvent
                        key={appointment.id}
                        appointment={appointment}
                        onClick={() => onAppointmentClick?.(appointment)}
                        compact
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

