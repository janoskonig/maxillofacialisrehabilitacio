'use client';

import { DashboardWidget } from '../DashboardWidget';
import { Calendar, Clock, Users, CheckCircle, AlertCircle } from 'lucide-react';

interface QuickStatsWidgetProps {
  todaysAppointmentsCount: number;
  upcomingAppointmentsCount: number;
  pendingTreatmentsCount: number;
  pendingApprovalsCount?: number;
  availableSlotsCount?: number;
  recentPatientsCount: number;
}

export function QuickStatsWidget({
  todaysAppointmentsCount,
  upcomingAppointmentsCount,
  pendingTreatmentsCount,
  pendingApprovalsCount = 0,
  availableSlotsCount = 0,
  recentPatientsCount,
}: QuickStatsWidgetProps) {
  const stats = [
    {
      label: 'Mai időpontok',
      value: todaysAppointmentsCount,
      icon: Calendar,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Következő 7 nap',
      value: upcomingAppointmentsCount,
      icon: Clock,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      label: 'Függőben lévő kezelések',
      value: pendingTreatmentsCount,
      icon: AlertCircle,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
    },
    {
      label: 'Új betegek (7 nap)',
      value: recentPatientsCount,
      icon: Users,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  // Add role-specific stats
  if (pendingApprovalsCount > 0) {
    stats.push({
      label: 'Jóváhagyásra vár',
      value: pendingApprovalsCount,
      icon: CheckCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    });
  }

  if (availableSlotsCount > 0) {
    stats.push({
      label: 'Elérhető időpontok',
      value: availableSlotsCount,
      icon: Clock,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
    });
  }

  return (
    <DashboardWidget title="Gyors statisztikák" icon={<Calendar className="w-5 h-5" />}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div
              key={index}
              className={`${stat.bgColor} rounded-lg p-3 flex flex-col items-center justify-center text-center`}
            >
              <Icon className={`w-6 h-6 sm:w-8 sm:h-8 ${stat.color} mb-2`} />
              <div className="text-2xl sm:text-3xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-xs sm:text-sm text-gray-600 mt-1">{stat.label}</div>
            </div>
          );
        })}
      </div>
    </DashboardWidget>
  );
}

