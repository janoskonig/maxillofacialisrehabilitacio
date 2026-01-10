'use client';

import { DashboardWidget } from '../DashboardWidget';
import { CheckCircle, Clock, User } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

interface PendingApproval {
  id: string;
  patientId: string;
  startTime: string;
  patientName: string | null;
  patientTaj: string | null;
  createdBy: string;
  dentistEmail?: string | null;
  dentistName?: string | null;
}

interface PendingApprovalsWidgetProps {
  approvals: PendingApproval[];
}

export function PendingApprovalsWidget({ approvals }: PendingApprovalsWidgetProps) {
  const router = useRouter();

  const handleAppointmentClick = (patientId: string) => {
    router.push(`/?patientId=${patientId}`);
  };

  return (
    <DashboardWidget title="Függőben lévő időpontok" icon={<CheckCircle className="w-5 h-5" />} collapsible>
      {approvals.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <div className="p-4 bg-gray-100 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-gray-400" />
          </div>
          <p className="text-body-sm">Nincsenek függőben lévő időpontok</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        {approvals.map((approval) => {
          const startTime = new Date(approval.startTime);
          
          return (
            <div
              key={approval.id}
              onClick={() => handleAppointmentClick(approval.patientId)}
              className="p-2 rounded-lg border border-medical-warning/30 bg-gradient-to-br from-medical-warning/10 to-medical-error/5 hover:shadow-soft cursor-pointer transition-all duration-200 animate-fade-in"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-medical-warning flex-shrink-0" />
                    <span className="font-semibold text-sm text-gray-900">
                      {format(startTime, 'yyyy. MMMM d. HH:mm', { locale: hu })}
                    </span>
                    <span className="badge badge-warning text-xs px-1.5 py-0.5">Függőben</span>
                  </div>
                  <div className="font-medium text-sm text-gray-900 truncate mb-0.5">
                    {approval.patientName || 'Névtelen beteg'}
                  </div>
                  {approval.dentistName && (
                    <div className="text-xs text-gray-700 mt-0.5">
                      {approval.dentistName}
                    </div>
                  )}
                  {approval.patientTaj && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      TAJ: {approval.patientTaj}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-500">
                    <User className="w-3 h-3" />
                    <span>{approval.createdBy}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      )}
    </DashboardWidget>
  );
}

