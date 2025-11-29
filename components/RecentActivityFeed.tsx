'use client';

import { useState } from 'react';
import { DashboardWidget } from './DashboardWidget';
import { Activity, User, Clock } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { hu } from 'date-fns/locale';
import { useRouter } from 'next/navigation';

interface ActivityItem {
  id: string;
  userEmail: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

interface RecentActivityFeedProps {
  activities: ActivityItem[];
  maxItems?: number;
}

const actionLabels: Record<string, string> = {
  'patient_created': 'Új beteg létrehozva',
  'patient_updated': 'Beteg adatai frissítve',
  'patient_viewed': 'Beteg megtekintve',
  'patient_deleted': 'Beteg törölve',
  'appointment_created': 'Időpont létrehozva',
  'appointment_updated': 'Időpont frissítve',
  'appointment_cancelled': 'Időpont törölve',
  'appointment_approved': 'Időpont jóváhagyva',
  'appointment_rejected': 'Időpont elutasítva',
  'document_uploaded': 'Dokumentum feltöltve',
  'document_deleted': 'Dokumentum törölve',
  'time_slot_created': 'Időpont létrehozva',
  'time_slot_updated': 'Időpont frissítve',
  'time_slot_deleted': 'Időpont törölve',
};

function getActionLabel(action: string): string {
  return actionLabels[action] || action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function extractPatientId(detail: string | null): string | null {
  if (!detail) return null;
  const match = detail.match(/Patient ID: ([a-f0-9-]+)/i);
  return match ? match[1] : null;
}

export function RecentActivityFeed({ activities, maxItems = 10 }: RecentActivityFeedProps) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  
  const displayedActivities = showAll ? activities : activities.slice(0, maxItems);

  if (activities.length === 0) {
    return (
      <DashboardWidget title="Legutóbbi aktivitás" icon={<Activity className="w-5 h-5" />}>
        <div className="text-center py-6 text-gray-500">
          <Activity className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">Nincs aktivitás</p>
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget title="Legutóbbi aktivitás" icon={<Activity className="w-5 h-5" />} collapsible>
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {displayedActivities.map((activity) => {
          const createdAt = new Date(activity.createdAt);
          const patientId = extractPatientId(activity.detail);
          
          return (
            <div
              key={activity.id}
              className={`p-3 rounded-lg border ${
                patientId ? 'cursor-pointer hover:bg-gray-50' : ''
              } border-gray-200 transition-colors`}
              onClick={() => {
                if (patientId) {
                  router.push(`/?patientId=${patientId}`);
                }
              }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-8 h-8 rounded-full bg-medical-primary/10 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-medical-primary" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="font-medium text-sm sm:text-base text-gray-900">
                      {getActionLabel(activity.action)}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">
                      <Clock className="w-3 h-3" />
                      <span>{formatDistanceToNow(createdAt, { addSuffix: true, locale: hu })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <User className="w-3 h-3" />
                    <span className="truncate">{activity.userEmail}</span>
                  </div>
                  {activity.detail && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                      {activity.detail}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {format(createdAt, 'yyyy. MMMM d. HH:mm', { locale: hu })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {activities.length > maxItems && !showAll && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setShowAll(true)}
            className="text-sm text-medical-primary hover:text-medical-primary/80 font-medium"
          >
            Összes megjelenítése ({activities.length})
          </button>
        </div>
      )}
      {showAll && activities.length > maxItems && (
        <div className="mt-4 text-center">
          <button
            onClick={() => setShowAll(false)}
            className="text-sm text-medical-primary hover:text-medical-primary/80 font-medium"
          >
            Kevesebb megjelenítése
          </button>
        </div>
      )}
    </DashboardWidget>
  );
}

