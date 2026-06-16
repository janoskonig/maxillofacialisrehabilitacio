'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { format, startOfMonth, endOfMonth, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isToday, isSameDay } from 'date-fns';
import { hu } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Settings as SettingsIcon } from 'lucide-react';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { CalendarFilters } from './CalendarFilters';
import { getAppointmentStatusDisplay } from '@/lib/appointment-status-display';

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

  // Mobilon a vízszintesen görgő heti rács helyett a napi agenda-nézet az alapértelmezett
  // (egymás alatti kártyák, prev/köv nap léptetés). Csak felcsatoláskor egyszer.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setViewType('day');
    }
  }, []);

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

  // Orvosok listája (fogpótlástanász + sebész is), hogy mindenki láthassa a naptárt és szűrhessen orvosra
  useEffect(() => {
    const fetchDentists = async () => {
      try {
        const response = await fetch('/api/users/doctors', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          const dentistList = (data.doctors || []).map((d: { email: string; name: string | null }) => ({
            email: d.email,
            name: d.name || d.email || null,
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

  // Tapping a day (esp. on mobile, where month cells only show a count) opens that
  // day in the detailed day view.
  const handleDateClick = (date: Date) => {
    setCurrentDate(date);
    setViewType('day');
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
        <CalendarIcon className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-4 animate-pulse" />
        <p className="text-gray-500 dark:text-gray-400">Betöltés...</p>
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
          <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-gray-100 min-w-0 flex-1 truncate">
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
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-700 divide-x divide-gray-300 dark:divide-gray-700 overflow-hidden flex-1 sm:flex-initial">
            <button
              onClick={() => setViewType('month')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewType === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              Hónap
            </button>
            <button
              onClick={() => setViewType('week')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewType === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              Hét
            </button>
            <button
              onClick={() => setViewType('day')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewType === 'day'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
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
              className="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-800 text-amber-600 dark:text-amber-300 focus:ring-amber-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Virtuális időpontok</span>
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
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Bal sáv (asztali) + naptár-nézet */}
      <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-4 lg:items-start">
        <aside className="hidden lg:flex lg:flex-col lg:gap-4 lg:sticky lg:top-4">
          <MiniMonth
            currentDate={currentDate}
            appointmentsByDate={appointmentsByDate}
            onDateClick={handleDateClick}
          />
          <CalendarLegend />
          <Link
            href="/settings"
            className="card !p-3 flex items-center gap-2 hover:border-medical-primary/30 transition-colors"
          >
            <span className="p-1.5 rounded-md bg-medical-primary/10 text-medical-primary flex-shrink-0">
              <SettingsIcon className="w-4 h-4" />
            </span>
            <span className="text-xs leading-snug text-gray-600 dark:text-gray-400">
              <span className="font-semibold text-gray-800 dark:text-gray-200">Google Naptár szinkron</span>
              <br />beállítása a Beállításokban
            </span>
          </Link>
        </aside>

        <div className="min-w-0">
          {viewType === 'month' && (
            <MonthView
              currentDate={currentDate}
              appointments={appointments}
              appointmentsByDate={appointmentsByDate}
              virtualAppointments={includeVirtual ? virtualAppointments : []}
              virtualAppointmentsByDate={includeVirtual ? virtualAppointmentsByDate : {}}
              includeVirtual={includeVirtual}
              onDateClick={handleDateClick}
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
      </div>
    </div>
  );
}

// Kompakt hónap-navigátor a bal sávban: a napokon pötty jelzi a foglalást,
// a mai nap kiemelve, kattintásra az adott nap megnyílik (napi nézet).
function MiniMonth({
  currentDate,
  appointmentsByDate,
  onDateClick,
}: {
  currentDate: Date;
  appointmentsByDate: Record<string, { id: string }[]>;
  onDateClick: (date: Date) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weekDays = ['H', 'K', 'Sz', 'Cs', 'P', 'Sz', 'V'];

  return (
    <div className="card !p-3">
      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2 capitalize text-center">
        {format(currentDate, 'yyyy. MMMM', { locale: hu })}
      </p>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {weekDays.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-gray-400 dark:text-gray-500">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day, i) => {
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);
          const selected = isSameDay(day, currentDate);
          const has = (appointmentsByDate[format(day, 'yyyy-MM-dd')] || []).length > 0;
          return (
            <button
              key={i}
              onClick={() => onDateClick(day)}
              className={`relative h-7 rounded-md text-[11px] font-medium transition-colors ${
                today
                  ? 'bg-medical-primary text-white'
                  : selected
                  ? 'bg-medical-primary/15 text-medical-primary'
                  : inMonth
                  ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  : 'text-gray-300 dark:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {format(day, 'd')}
              {has && !today && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-medical-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Státusz-jelmagyarázat a naptár-blokkok színkódjához (az egységes display-helperből).
function CalendarLegend() {
  const items = [
    getAppointmentStatusDisplay(null, false),
    getAppointmentStatusDisplay('completed'),
    getAppointmentStatusDisplay(null, true),
    getAppointmentStatusDisplay('no_show'),
    getAppointmentStatusDisplay('cancelled_by_doctor'),
  ];
  return (
    <div className="card !p-3">
      <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">Jelmagyarázat</p>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-sm border-l-2 ${it.bgColor} ${it.borderColor}`} />
            <span className="text-xs text-gray-600 dark:text-gray-400">{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

