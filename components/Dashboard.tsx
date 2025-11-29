'use client';

import { useState, useEffect } from 'react';
import { TodaysAppointmentsWidget } from './widgets/TodaysAppointmentsWidget';
import { PendingApprovalsWidget } from './widgets/PendingApprovalsWidget';
import { ChevronDown, ChevronUp, LayoutDashboard } from 'lucide-react';

interface DashboardData {
  nextAppointments: any[];
  pendingAppointments: any[];
}

interface DashboardProps {
  userRole: string;
}

export function Dashboard({ userRole }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/dashboard', {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Hiba történt a dashboard adatok betöltésekor');
        }

        const dashboardData = await response.json();
        setData(dashboardData);
        setError(null);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError(err instanceof Error ? err.message : 'Ismeretlen hiba');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-medical-primary"></div>
          <span className="ml-3 text-gray-600">Dashboard betöltése...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border border-red-200 shadow-sm p-6">
        <div className="text-center py-4">
          <p className="text-red-600">Hiba: {error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Dashboard Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-medical-primary" />
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h2>
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 p-2"
        >
          {isCollapsed ? (
            <>
              <ChevronDown className="w-4 h-4" />
              <span className="hidden sm:inline">Kibontás</span>
            </>
          ) : (
            <>
              <ChevronUp className="w-4 h-4" />
              <span className="hidden sm:inline">Összecsukás</span>
            </>
          )}
        </button>
      </div>

      {!isCollapsed && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Next 3 Appointments Today */}
          <TodaysAppointmentsWidget appointments={data.nextAppointments} />

          {/* Pending Appointments */}
          {data.pendingAppointments.length > 0 && (
            <PendingApprovalsWidget approvals={data.pendingAppointments} />
          )}
        </div>
      )}
    </div>
  );
}

