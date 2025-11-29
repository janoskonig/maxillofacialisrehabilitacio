'use client';

import { DashboardWidget } from '../DashboardWidget';
import { AlertCircle, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface PendingTreatment {
  id: string;
  patientName: string | null;
  patientTaj: string | null;
  pendingFelso: number;
  pendingAlso: number;
  pendingArcotErinto: number;
}

interface PendingTreatmentsWidgetProps {
  treatments: PendingTreatment[];
}

export function PendingTreatmentsWidget({ treatments }: PendingTreatmentsWidgetProps) {
  const router = useRouter();

  const handlePatientClick = (patientId: string) => {
    router.push(`/?patientId=${patientId}`);
  };

  if (treatments.length === 0) {
    return (
      <DashboardWidget title="Függőben lévő kezelések" icon={<AlertCircle className="w-5 h-5" />}>
        <div className="text-center py-6 text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Nincsenek függőben lévő kezelések</p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget title="Függőben lévő kezelések" icon={<AlertCircle className="w-5 h-5" />} collapsible>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {treatments.map((treatment) => {
          const totalPending = treatment.pendingFelso + treatment.pendingAlso + treatment.pendingArcotErinto;
          
          return (
            <div
              key={treatment.id}
              onClick={() => handlePatientClick(treatment.id)}
              className="p-3 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 cursor-pointer transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm sm:text-base text-gray-900 truncate">
                    {treatment.patientName || 'Névtelen beteg'}
                  </div>
                  {treatment.patientTaj && (
                    <div className="text-xs text-gray-600 mt-0.5">
                      TAJ: {treatment.patientTaj}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {treatment.pendingFelso > 0 && (
                      <span className="text-xs px-2 py-1 bg-white rounded border border-orange-200">
                        Felső: {treatment.pendingFelso}
                      </span>
                    )}
                    {treatment.pendingAlso > 0 && (
                      <span className="text-xs px-2 py-1 bg-white rounded border border-orange-200">
                        Alsó: {treatment.pendingAlso}
                      </span>
                    )}
                    {treatment.pendingArcotErinto > 0 && (
                      <span className="text-xs px-2 py-1 bg-white rounded border border-orange-200">
                        Arcot érintő: {treatment.pendingArcotErinto}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <span className="text-lg font-bold text-orange-600">{totalPending}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </DashboardWidget>
  );
}

