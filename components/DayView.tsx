'use client';

import { format, isToday, isSameDay } from 'date-fns';
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

interface DayViewProps {
  currentDate: Date;
  appointments: Appointment[];
  appointmentsByDate: Record<string, Appointment[]>;
  onAppointmentClick?: (appointment: Appointment) => void;
}

export function DayView({
  currentDate,
  appointments,
  appointmentsByDate,
  onAppointmentClick,
}: DayViewProps) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const dateKey = format(currentDate, 'yyyy-MM-dd');
  const dayAppointments = appointmentsByDate[dateKey] || [];
  const isCurrentDay = isToday(currentDate);

  // Group appointments by hour
  const appointmentsByHour: Record<number, Appointment[]> = {};
  dayAppointments.forEach((appointment) => {
    const hour = new Date(appointment.startTime).getHours();
    if (!appointmentsByHour[hour]) {
      appointmentsByHour[hour] = [];
    }
    appointmentsByHour[hour].push(appointment);
  });

  // Sort appointments within each hour by minute
  Object.keys(appointmentsByHour).forEach((hour) => {
    appointmentsByHour[parseInt(hour)].sort((a, b) => {
      const aMinute = new Date(a.startTime).getMinutes();
      const bMinute = new Date(b.startTime).getMinutes();
      return aMinute - bMinute;
    });
  });

  return (
    <div className="bg-white rounded-lg border">
      {/* Day header */}
      <div className={`p-3 sm:p-4 border-b ${isCurrentDay ? 'bg-blue-50' : 'bg-gray-50'}`}>
        <div className="text-base sm:text-lg font-bold text-gray-900">
          {format(currentDate, 'EEEE, yyyy. MMMM d.', { locale: hu })}
        </div>
        <div className="text-sm text-gray-600 mt-1">
          {dayAppointments.length} időpont
        </div>
      </div>

      {/* Time slots */}
      <div className="divide-y">
        {hours.map((hour) => {
          const hourAppointments = appointmentsByHour[hour] || [];
          return (
            <div key={hour} className="grid grid-cols-12 gap-2 sm:gap-4 p-2 sm:p-3 hover:bg-gray-50">
              <div className="col-span-3 sm:col-span-2 text-sm font-medium text-gray-600 text-right pr-2 sm:pr-4">
                {hour.toString().padStart(2, '0')}:00
              </div>
              <div className="col-span-9 sm:col-span-10">
                {hourAppointments.length > 0 ? (
                  <div className="space-y-2">
                    {hourAppointments.map((appointment) => (
                      <CalendarEvent
                        key={appointment.id}
                        appointment={appointment}
                        onClick={() => onAppointmentClick?.(appointment)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">Nincs időpont</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {dayAppointments.length === 0 && (
        <div className="p-8 text-center text-gray-500">
          Nincs időpont erre a napra
        </div>
      )}
    </div>
  );
}

