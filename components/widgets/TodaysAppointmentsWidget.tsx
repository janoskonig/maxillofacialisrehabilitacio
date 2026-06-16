'use client';

import Link from 'next/link';
import { Calendar, Clock, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { hu } from 'date-fns/locale';
import { DashboardWidget } from '../DashboardWidget';
import { getAppointmentTypeChip } from '@/lib/appointment-constants';

interface Appointment {
  id: string;
  patientId: string;
  startTime: string;
  patientName: string | null;
  teremszam?: string | null;
  appointmentStatus?: string | null;
  appointmentType?: string | null;
  typeLabel?: string | null;
  rebookNeeded?: boolean | null;
}

interface TodaysAppointmentsWidgetProps {
  appointments: Appointment[];
  // Megtartva a Dashboard hívási kompatibilitásért; a teljes kimenetel-kezelés a
  // dedikált /today oldalon él (AppointmentOutcomeList).
  onUpdate?: () => void;
}

/**
 * Kompakt főoldali összegzés a mai időpontokról: darabszámok + a legközelebbi
 * 1–2 időpont + link a teljes „Mai időpontok" oldalra (/today), ahol a kimenetel
 * rögzítése és az újrafoglalás történik.
 */
export function TodaysAppointmentsWidget({ appointments }: TodaysAppointmentsWidgetProps) {
  if (!appointments || appointments.length === 0) {
    return (
      <DashboardWidget title="Mai időpontok" icon={<Calendar className="w-5 h-5" />}>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
            <Calendar className="w-8 h-8 text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-body-sm">Nincsenek mai időpontok</p>
        </div>
      </DashboardWidget>
    );
  }

  const total = appointments.length;
  const completed = appointments.filter((a) => a.appointmentStatus === 'completed').length;
  const pending = appointments.filter((a) => !a.appointmentStatus).length;
  const rebook = appointments.filter((a) => a.rebookNeeded).length;
  // A legközelebbi, még kimenetel nélküli időpontok (ezek igényelnek figyelmet).
  const upcoming = appointments.filter((a) => !a.appointmentStatus).slice(0, 2);
  const preview = upcoming.length ? upcoming : appointments.slice(0, 2);

  return (
    <DashboardWidget title="Mai időpontok" icon={<Calendar className="w-5 h-5" />} collapsible>
      <div className="space-y-3">
        {/* Összegző számok */}
        <div className="grid grid-cols-3 gap-2">
          <SummaryStat label="Ma" value={total} tone="primary" />
          <SummaryStat label="Teljesült" value={completed} tone="success" Icon={CheckCircle2} />
          <SummaryStat label="Hátravan" value={pending} tone="warning" Icon={Clock} />
        </div>

        {rebook > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 flex-shrink-0" />
            <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
              {rebook} időpont újrafoglalást igényel
            </span>
          </div>
        )}

        {/* Legközelebbi időpontok előnézete */}
        <div className="space-y-1.5">
          {preview.map((a) => {
            const chip = getAppointmentTypeChip(a.appointmentType, a.typeLabel);
            return (
              <Link
                key={a.id}
                href={`/patients/${a.patientId}/view`}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/50 hover:border-medical-primary/30 hover:bg-medical-primary/5 transition-colors"
              >
                <span className="font-bold text-sm text-gray-900 dark:text-gray-100 tabular-nums">
                  {format(new Date(a.startTime), 'HH:mm', { locale: hu })}
                </span>
                <span className="text-sm text-gray-800 dark:text-gray-200 truncate flex-1 min-w-0">
                  {a.patientName || 'Névtelen beteg'}
                </span>
                {chip && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 flex-shrink-0 ${chip.className}`}>
                    <span aria-hidden>{chip.emoji}</span>
                    <span className="truncate max-w-[90px]">{chip.label}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <Link
          href="/today"
          className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg bg-medical-primary/10 text-medical-primary font-semibold text-sm hover:bg-medical-primary/20 transition-colors"
        >
          Összes mai időpont megnyitása
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DashboardWidget>
  );
}

function SummaryStat({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: 'primary' | 'success' | 'warning';
  Icon?: typeof CheckCircle2;
}) {
  const color =
    tone === 'success'
      ? 'text-medical-success'
      : tone === 'warning'
      ? 'text-medical-warning'
      : 'text-medical-primary';
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-2 py-2 text-center">
      <div className={`flex items-center justify-center gap-1 text-xl font-bold tabular-nums ${color}`}>
        {Icon && <Icon className="w-4 h-4" />}
        {value}
      </div>
      <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}
