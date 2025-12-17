'use client';

import { CheckCircle2, XCircle, AlertCircle, Clock as ClockIcon } from 'lucide-react';

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
  const getStatusInfo = () => {
    if (appointment.isLate) {
      return { 
        label: 'Késett', 
        color: 'text-orange-600', 
        bgColor: 'bg-orange-50', 
        borderColor: 'border-orange-200',
        icon: ClockIcon 
      };
    }
    switch (appointment.appointmentStatus) {
      case 'cancelled_by_doctor':
        return { 
          label: 'Lemondva (orvos)', 
          color: 'text-red-600', 
          bgColor: 'bg-red-50', 
          borderColor: 'border-red-200',
          icon: XCircle 
        };
      case 'cancelled_by_patient':
        return { 
          label: 'Lemondva (beteg)', 
          color: 'text-orange-600', 
          bgColor: 'bg-orange-50', 
          borderColor: 'border-orange-200',
          icon: XCircle 
        };
      case 'completed':
        return { 
          label: 'Teljesült', 
          color: 'text-green-600', 
          bgColor: 'bg-green-50', 
          borderColor: 'border-green-200',
          icon: CheckCircle2 
        };
      case 'no_show':
        return { 
          label: 'Nem jelent meg', 
          color: 'text-red-700', 
          bgColor: 'bg-red-100', 
          borderColor: 'border-red-300',
          icon: AlertCircle 
        };
      default:
        return { 
          label: 'Várható', 
          color: 'text-blue-600', 
          bgColor: 'bg-blue-50', 
          borderColor: 'border-blue-200',
          icon: null 
        };
    }
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;
  const startTime = new Date(appointment.startTime);
  const timeString = startTime.toLocaleTimeString('hu-HU', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`${statusInfo.bgColor} ${statusInfo.borderColor} border-l-2 px-2 py-1 text-xs cursor-pointer hover:opacity-80 transition-opacity`}
        title={`${appointment.patientName || 'Név nélküli'} - ${timeString}${appointment.dentistName ? ` - ${appointment.dentistName}` : ''}`}
      >
        <div className="flex items-center gap-1">
          {StatusIcon && <StatusIcon className={`w-3 h-3 ${statusInfo.color}`} />}
          <div className="flex-1 min-w-0">
            <div className={`font-medium ${statusInfo.color} truncate`}>
              {timeString} {appointment.patientName || 'Név nélküli'}
            </div>
            {appointment.dentistName && (
              <div className="text-gray-600 truncate text-[10px] mt-0.5">
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
          <div className="font-medium text-gray-900 truncate">
            {appointment.patientName || 'Név nélküli'}
          </div>
          {appointment.dentistName && (
            <div className="text-xs font-medium text-gray-700 mt-0.5">
              Orvos: {appointment.dentistName}
            </div>
          )}
          {appointment.patientTaj && (
            <div className="text-xs text-gray-600 mt-0.5">
              TAJ: {appointment.patientTaj}
            </div>
          )}
          {appointment.teremszam && (
            <div className="text-xs text-gray-500 mt-0.5">
              Terem: {appointment.teremszam}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

