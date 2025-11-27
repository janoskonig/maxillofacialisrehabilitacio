'use client';

import { DashboardWidget } from '../DashboardWidget';
import { Calendar, Clock, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

interface Appointment {
  id: string;
  patientId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  cim: string | null;
  teremszam: string | null;
  appointmentStatus?: string | null;
}

interface TodaysAppointmentsWidgetProps {
  appointments: Appointment[];
}

export function TodaysAppointmentsWidget({ appointments }: TodaysAppointmentsWidgetProps) {
  const router = useRouter();

  const handleAppointmentClick = (patientId: string) => {
    router.push(`/?patientId=${patientId}`);
  };

  if (appointments.length === 0) {
    return (
      <DashboardWidget title="Következő időpontok (ma)" icon={<Calendar className="w-5 h-5" />}>
        <div className="text-center py-6 text-gray-500">
          <Calendar className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Nincsenek mai időpontok</p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget title="Következő időpontok (ma)" icon={<Calendar className="w-5 h-5" />} collapsible>
      <div className="space-y-2">
        {appointments.map((appointment) => {
          const startTime = new Date(appointment.startTime);
          const isUpcoming = startTime > new Date();
          
          return (
            <div
              key={appointment.id}
              onClick={() => handleAppointmentClick(appointment.patientId)}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                isUpcoming
                  ? 'border-blue-200 bg-blue-50 hover:bg-blue-100'
                  : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span className="font-semibold text-sm sm:text-base text-gray-900">
                      {format(startTime, 'HH:mm', { locale: hu })}
                    </span>
                    {!isUpcoming && (
                      <span className="text-xs text-gray-500">(már elmúlt)</span>
                    )}
                  </div>
                  <div className="font-medium text-sm sm:text-base text-gray-900 truncate">
                    {appointment.patientName || 'Névtelen beteg'}
                  </div>
                  {appointment.patientTaj && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      TAJ: {appointment.patientTaj}
                    </div>
                  )}
                  {(appointment.cim || appointment.teremszam) && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                      <MapPin className="w-3 h-3" />
                      {appointment.cim && <span>{appointment.cim}</span>}
                      {appointment.teremszam && <span>• {appointment.teremszam}. terem</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DashboardWidget>
  );
}

