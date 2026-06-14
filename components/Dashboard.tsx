'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { TodaysAppointmentsWidget } from './widgets/TodaysAppointmentsWidget';
import { PendingApprovalsWidget } from './widgets/PendingApprovalsWidget';
import { ClipboardList, MessageCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import { Patient } from '@/lib/types';
import { EmptyState } from './ui/EmptyState';
import { useStaffTaskSummary } from '@/hooks/useStaffTaskSummary';
import { useStaffInboxSummary } from '@/hooks/useStaffInboxSummary';

interface DashboardData {
  nextAppointments: any[];
  pendingAppointments: any[];
  newRegistrations: any[];
}

interface DashboardProps {
  userRole: string;
  onViewPatient?: (patient: Patient) => void;
  onEditPatient?: (patient: Patient) => void;
  onViewOP?: (patient: Patient) => void;
  onViewFoto?: (patient: Patient) => void;
}

/**
 * Teendő-központú főoldali panel: a napi, ténylegesen elvégzendő dolgokat
 * emeli ki (jóváhagyásra váró időpontok, mai időpontok) + gyors belépők a
 * nyitott feladatokhoz és olvasatlan üzenetekhez. A korábbi tabos „Dashboard"
 * (GANTT / terhelés / pipeline) kikerült a saját oldalaira.
 */
export function Dashboard(_props: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { summary: taskSummary } = useStaffTaskSummary(true);
  const { summary: inboxSummary } = useStaffInboxSummary(true);

  const refreshData = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard', { credentials: 'include' });
      if (response.ok) {
        setData(await response.json());
      }
    } catch (err) {
      console.error('Error refreshing dashboard data:', err);
    }
  }, []);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/dashboard', { credentials: 'include' });
        if (!response.ok) {
          throw new Error('Hiba történt a dashboard adatok betöltésekor');
        }
        setData(await response.json());
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
      <div className="card">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-medical-primary/20 border-t-medical-primary"></div>
          <span className="ml-3 text-body-sm">Teendők betöltése...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-medical-error/20 bg-medical-error/5">
        <div className="text-center py-4">
          <p className="text-medical-error font-medium">Hiba: {error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const openTasks = taskSummary?.totalOpen ?? 0;
  const unviewedTasks = taskSummary?.unviewed ?? 0;
  const unreadMessages = (inboxSummary?.patientUnread ?? 0) + (inboxSummary?.doctorUnread ?? 0);
  const urgentMessages = (inboxSummary?.patientUnread ?? 0) > 0;

  const hasPending = data.pendingAppointments.length > 0;
  const hasToday = data.nextAppointments.length > 0;
  const hasChips = openTasks > 0 || unreadMessages > 0;
  const nothingToDo = !hasPending && !hasToday && !hasChips;

  return (
    <section className="space-y-3 md:space-y-4" aria-label="Teendőim">
      <h2 className="text-heading-3">Teendőim</h2>

      {nothingToDo ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nincs sürgős teendőd."
          description="Nincs jóváhagyásra váró kérés, mai időpont, nyitott feladat vagy olvasatlan üzenet."
        />
      ) : (
        <>
          {hasChips && (
            <div className="flex flex-wrap gap-2">
              {openTasks > 0 && (
                <Link
                  href="/tasks"
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    unviewedTasks > 0
                      ? 'border-medical-error/30 bg-medical-error/5 text-medical-error hover:bg-medical-error/10'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <ClipboardList className="w-4 h-4" />
                  <span className="font-medium">{openTasks}</span>
                  nyitott feladat
                  <ChevronRight className="w-4 h-4 opacity-60" />
                </Link>
              )}
              {unreadMessages > 0 && (
                <Link
                  href="/messages"
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    urgentMessages
                      ? 'border-medical-error/30 bg-medical-error/5 text-medical-error hover:bg-medical-error/10'
                      : 'border-medical-warning/30 bg-medical-warning/5 text-medical-warning hover:bg-medical-warning/10'
                  }`}
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="font-medium">{unreadMessages}</span>
                  olvasatlan üzenet
                  <ChevronRight className="w-4 h-4 opacity-60" />
                </Link>
              )}
            </div>
          )}

          {(hasPending || hasToday) && (
            <div className={`grid gap-4 ${hasPending && hasToday ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
              {hasPending && <PendingApprovalsWidget approvals={data.pendingAppointments} />}
              {hasToday && (
                <TodaysAppointmentsWidget appointments={data.nextAppointments} onUpdate={refreshData} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
