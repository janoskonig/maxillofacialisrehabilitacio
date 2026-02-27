'use client';

import { useState, useEffect, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, startOfWeek, endOfWeek } from 'date-fns';
import { hu } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { CalendarFilters } from './CalendarFilters';
import { CalendarEvent } from './CalendarEvent';

type ViewType = 'month' | 'week' | 'day';

interface Appointment {
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
  appointmentType?: 'elso_konzultacio' | 'munkafazis' | 'kontroll' | null;
}

interface CalendarViewProps {
  onAppointmentClick?: (appointment: Appointment) => void;
}

export function CalendarView({ onAppointmentClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<ViewType>('week');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsByDate, setAppointmentsByDate] = useState<Record<string, Appointment[]>>({});
  const [virtualAppointments, setVirtualAppointments] = useState<any[]>([]);
  const [virtualAppointmentsByDate, setVirtualAppointmentsByDate] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dentists, setDentists] = useState<Array<{ email: string; name: string | null }>>([]);
  const [selectedDentist, setSelectedDentist] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [includeVirtual, setIncludeVirtual] = useState(false);

  // Calculate date range based on view type
  const dateRange = useMemo(() => {
    let start: Date;
    let end: Date;

    switch (viewType) {
      case 'month':
        start = startOfMonth(currentDate);
        end = endOfMonth(currentDate);
        // Add buffer for week view
        start = startOfWeek(start, { weekStartsOn: 1 });
        end = endOfWeek(end, { weekStartsOn: 1 });
        break;
      case 'week':
        start = startOfWeek(currentDate, { weekStartsOn: 1 });
        end = endOfWeek(currentDate, { weekStartsOn: 1 });
        break;
      case 'day':
        start = new Date(currentDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
        break;
    }

    return { start, end };
  }, [currentDate, viewType]);

  // Fetch appointments
  useEffect(() => {
    const fetchAppointments = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          startDate: dateRange.start.toISOString(),
          endDate: dateRange.end.toISOString(),
          includeAvailableSlots: 'false',
        });

        if (selectedDentist) {
          params.append('dentistEmail', selectedDentist);
        }

        if (selectedStatus) {
          params.append('status', selectedStatus);
        }

        if (includeVirtual) {
          params.append('includeVirtual', 'true');
        }

        const response = await fetch(`/api/appointments/calendar?${params.toString()}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Nem sikerült betölteni az időpontokat');
        }

        const data = await response.json();
        setAppointments(data.appointments || []);
        setAppointmentsByDate(data.appointmentsByDate || {});
        setVirtualAppointments(data.virtualAppointments || []);
        setVirtualAppointmentsByDate(data.virtualAppointmentsByDate || {});
      } catch (err) {
        console.error('Error fetching appointments:', err);
        setError(err instanceof Error ? err.message : 'Hiba történt');
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, [dateRange.start, dateRange.end, selectedDentist, selectedStatus, includeVirtual]);

  // Fetch dentists list
  useEffect(() => {
    const fetchDentists = async () => {
      try {
        const response = await fetch('/api/users/fogpotlastanasz', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          const dentistList = (data.users || []).map((user: any) => ({
            email: user.email,
            name: user.doktor_neve || user.displayName || null,
          }));
          setDentists(dentistList);
        }
      } catch (err) {
        console.error('Error fetching dentists:', err);
      }
    };

    fetchDentists();
  }, []);

  const navigateDate = (direction: 'prev' | 'next') => {
    setCurrentDate((prev) => {
      switch (viewType) {
        case 'month':
          return direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1);
        case 'week':
          return direction === 'next' ? addWeeks(prev, 1) : subWeeks(prev, 1);
        case 'day':
          return direction === 'next' ? addDays(prev, 1) : subDays(prev, 1);
      }
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const getDateLabel = () => {
    switch (viewType) {
      case 'month':
        return format(currentDate, 'yyyy. MMMM', { locale: hu });
      case 'week':
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
        return `${format(weekStart, 'MMM d.', { locale: hu })} - ${format(weekEnd, 'MMM d., yyyy', { locale: hu })}`;
      case 'day':
        return format(currentDate, 'yyyy. MMMM d.', { locale: hu });
    }
  };

  if (loading && appointments.length === 0) {
    return (
      <div className="card p-8 text-center">
        <CalendarIcon className="w-12 h-12 text-gray-400 mx-auto mb-4 animate-pulse" />
        <p className="text-gray-500">Betöltés...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          <button
            onClick={() => navigateDate('prev')}
            className="btn-secondary p-2 flex-shrink-0"
            aria-label="Előző"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => navigateDate('next')}
            className="btn-secondary p-2 flex-shrink-0"
            aria-label="Következő"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <h2 className="text-base sm:text-xl font-bold text-gray-900 min-w-0 flex-1 truncate">
            {getDateLabel()}
          </h2>
          <button
            onClick={goToToday}
            className="btn-secondary text-sm px-3 py-1.5 flex-shrink-0"
          >
            Ma
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View type switcher */}
          <div className="flex rounded-lg border overflow-hidden flex-1 sm:flex-initial">
            <button
              onClick={() => setViewType('month')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewType === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Hónap
            </button>
            <button
              onClick={() => setViewType('week')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors border-l ${
                viewType === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Hét
            </button>
            <button
              onClick={() => setViewType('day')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors border-l ${
                viewType === 'day'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Nap
            </button>
          </div>

          {/* Virtual appointments toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeVirtual}
              onChange={(e) => setIncludeVirtual(e.target.checked)}
              className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-sm text-gray-700">Virtuális időpontok</span>
          </label>

          {/* Filters */}
          <CalendarFilters
            dentists={dentists}
            selectedDentist={selectedDentist}
            selectedStatus={selectedStatus}
            onDentistChange={setSelectedDentist}
            onStatusChange={setSelectedStatus}
            onClear={() => {
              setSelectedDentist(null);
              setSelectedStatus(null);
            }}
          />
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Calendar view */}
      {viewType === 'month' && (
        <MonthView
          currentDate={currentDate}
          appointments={appointments}
          appointmentsByDate={appointmentsByDate}
          virtualAppointments={includeVirtual ? virtualAppointments : []}
          virtualAppointmentsByDate={includeVirtual ? virtualAppointmentsByDate : {}}
          includeVirtual={includeVirtual}
          onAppointmentClick={onAppointmentClick}
        />
      )}

      {viewType === 'week' && (
        <WeekView
          currentDate={currentDate}
          appointments={appointments}
          appointmentsByDate={appointmentsByDate}
          virtualAppointmentsByDate={includeVirtual ? virtualAppointmentsByDate : {}}
          includeVirtual={includeVirtual}
          onAppointmentClick={onAppointmentClick}
        />
      )}

      {viewType === 'day' && (
        <DayView
          currentDate={currentDate}
          appointments={appointments}
          appointmentsByDate={appointmentsByDate}
          virtualAppointmentsByDate={includeVirtual ? virtualAppointmentsByDate : {}}
          includeVirtual={includeVirtual}
          onAppointmentClick={onAppointmentClick}
        />
      )}
    </div>
  );
}

