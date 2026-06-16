'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { CalendarCheck, CheckCircle2, Clock, AlertCircle, Stethoscope } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { AppointmentOutcomeList } from '@/components/appointments/AppointmentOutcomeList';
import type { OutcomeAppointment } from '@/hooks/useAppointmentOutcomes';

export default function TodaysAppointmentsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<OutcomeAppointment[]>([]);
  const [selectedDentist, setSelectedDentist] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push('/login');
          return;
        }
        setAuthorized(true);
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/appointments/today', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAppointments(data.appointments ?? []);
      }
    } catch (error) {
      console.error('Error fetching today\'s appointments:', error);
    }
  }, []);

  useEffect(() => {
    if (authorized) fetchData();
  }, [authorized, fetchData]);

  // Orvos-szűrő opciói: a mai időpontokban szereplő orvosok (csak akik közt van mit szűrni).
  const doctors = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of appointments) {
      if (a.dentistEmail) map.set(a.dentistEmail, a.dentistName || a.dentistEmail);
    }
    return Array.from(map, ([email, name]) => ({ email, name })).sort((x, y) => x.name.localeCompare(y.name, 'hu'));
  }, [appointments]);

  // A szűrő eldobása, ha a kiválasztott orvosnak már nincs mai időpontja (újratöltés után).
  useEffect(() => {
    if (selectedDentist && !doctors.some((d) => d.email === selectedDentist)) {
      setSelectedDentist(null);
    }
  }, [doctors, selectedDentist]);

  const visible = useMemo(
    () => (selectedDentist ? appointments.filter((a) => a.dentistEmail === selectedDentist) : appointments),
    [appointments, selectedDentist],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-pulse text-gray-500 dark:text-gray-400">Betöltés…</div>
      </div>
    );
  }
  if (!authorized) return null;

  const total = visible.length;
  const completed = visible.filter((a) => a.appointmentStatus === 'completed').length;
  const noShow = visible.filter((a) => a.appointmentStatus === 'no_show').length;
  const pending = visible.filter((a) => !a.appointmentStatus).length;
  const today = format(new Date(), 'yyyy. MMMM d., EEEE', { locale: hu });

  return (
    <AppShell title="Mai időpontok" backTo="/" maxWidth="xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-sm text-gray-500 dark:text-gray-400 capitalize">{today}</p>
          {doctors.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <Stethoscope className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <span className="text-gray-500 dark:text-gray-400 font-medium hidden sm:inline">Orvos:</span>
              <select
                value={selectedDentist ?? ''}
                onChange={(e) => setSelectedDentist(e.target.value || null)}
                className="form-input !w-auto !py-1.5 text-sm"
                aria-label="Szűrés orvosra"
              >
                <option value="">Összes orvos ({appointments.length})</option>
                {doctors.map((d) => (
                  <option key={d.email} value={d.email}>
                    {d.name} ({appointments.filter((a) => a.dentistEmail === d.email).length})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* KPI-k */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Mai összesen" value={total} icon={CalendarCheck} tone="primary" />
          <StatCard label="Teljesült" value={completed} icon={CheckCircle2} tone="success" />
          <StatCard label="Hátravan" value={pending} icon={Clock} tone="warning" delta={pending > 0 ? 'kimenetel rögzítendő' : undefined} />
          <StatCard label="Nem jelent meg" value={noShow} icon={AlertCircle} tone="error" />
        </div>

        {/* Lista */}
        {total === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title={selectedDentist ? 'Nincs időpont ehhez az orvoshoz' : 'Nincsenek mai időpontok'}
            description={
              selectedDentist
                ? 'A kiválasztott orvosnak ma nincs rögzített időpontja.'
                : 'Ma nincs rögzített időpont. A foglalások a Naptárban és az időpontkezelőben jelennek meg.'
            }
          />
        ) : (
          <div className="card !p-3 md:!p-4">
            <AppointmentOutcomeList
              key={selectedDentist ?? 'all'}
              appointments={visible}
              onUpdate={fetchData}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
