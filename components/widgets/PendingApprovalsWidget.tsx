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
        <div className="text-center py-6 text-gray-500">
          <CheckCircle className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Nincsenek függőben lévő időpontok</p>
        </div>
      ) : (
        <div className="space-y-2">
        {approvals.map((approval) => {
          const startTime = new Date(approval.startTime);
          
          return (
            <div
              key={approval.id}
              onClick={() => handleAppointmentClick(approval.patientId)}
              className="p-3 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 cursor-pointer transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span className="font-semibold text-sm sm:text-base text-gray-900">
                      {format(startTime, 'yyyy. MMMM d. HH:mm', { locale: hu })}
                    </span>
                  </div>
                  <div className="font-medium text-sm sm:text-base text-gray-900 truncate">
                    {approval.patientName || 'Névtelen beteg'}
                  </div>
                  {approval.patientTaj && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      TAJ: {approval.patientTaj}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                    <User className="w-3 h-3" />
                    <span>Létrehozta: {approval.createdBy}</span>
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

