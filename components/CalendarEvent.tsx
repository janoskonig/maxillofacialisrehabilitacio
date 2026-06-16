'use client';

import { getAppointmentStatusDisplay } from '@/lib/appointment-status-display';

interface CalendarEventProps {
  appointment: {
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
  };
  onClick?: () => void;
  compact?: boolean;
}

export function CalendarEvent({ appointment, onClick, compact = false }: CalendarEventProps) {
  const statusInfo = getAppointmentStatusDisplay(appointment.appointmentStatus, appointment.isLate);
  const StatusIcon = statusInfo.Icon;
  const startTime = new Date(appointment.startTime);
  const timeString = startTime.toLocaleTimeString('hu-HU', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`${statusInfo.bgColor} ${statusInfo.borderColor} border-l-2 rounded-r px-1.5 py-1 sm:px-2 text-xs cursor-pointer hover:opacity-80 transition-opacity`}
        title={`${appointment.patientName || 'Név nélküli'} - ${timeString}${appointment.dentistName ? ` - ${appointment.dentistName}` : ''}`}
      >
        <div className="flex items-center gap-1">
          {StatusIcon && <StatusIcon className={`w-3 h-3 flex-shrink-0 ${statusInfo.color}`} />}
          <div className="flex-1 min-w-0">
            <div className={`font-medium ${statusInfo.color} truncate`}>
              {timeString} {appointment.patientName || 'Név nélküli'}
            </div>
            {appointment.dentistName && (
              <div className="text-gray-600 dark:text-gray-400 truncate text-[10px] mt-0.5">
                {appointment.dentistName}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`${statusInfo.bgColor} ${statusInfo.borderColor} border-l-4 px-3 py-2 rounded-r cursor-pointer hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {StatusIcon && <StatusIcon className={`w-4 h-4 ${statusInfo.color}`} />}
            <span className={`font-semibold ${statusInfo.color} text-sm`}>
              {timeString}
            </span>
          </div>
          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
            {appointment.patientName || 'Név nélküli'}
          </div>
          {appointment.dentistName && (
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-0.5">
              Orvos: {appointment.dentistName}
            </div>
          )}
          {appointment.patientTaj && (
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              TAJ: {appointment.patientTaj}
            </div>
          )}
          {appointment.teremszam && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Terem: {appointment.teremszam}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

