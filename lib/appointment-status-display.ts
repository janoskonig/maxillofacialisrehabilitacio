// Egyetlen forrás az időpont-státusz vizuális megjelenítéséhez (címke + szín + ikon).
// Korábban duplikált volt a components/CalendarEvent.tsx és a
// TodaysAppointmentsWidget.getStatusLabel között. A státusz-értékek kanonikus
// forrása változatlanul a lib/appointment-status.ts.

import { CheckCircle2, XCircle, AlertCircle, Clock, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BadgeTone } from '@/components/ui/Badge';

export interface AppointmentStatusDisplay {
  /** 'pending' = nincs státusz (és nem késett) — a hívó dönthet, hogy rejti-e. */
  key: 'pending' | 'late' | 'completed' | 'no_show' | 'cancelled_by_doctor' | 'cancelled_by_patient' | 'unsuccessful';
  label: string;
  /** Badge-tónus (globals.css .badge-*). */
  tone: BadgeTone;
  /** Teljes Tailwind színosztályok a naptár-blokkokhoz. */
  color: string;
  bgColor: string;
  borderColor: string;
  Icon: LucideIcon | null;
}

const PENDING: AppointmentStatusDisplay = {
  key: 'pending',
  label: 'Várható',
  tone: 'primary',
  color: 'text-blue-600 dark:text-blue-300',
  bgColor: 'bg-blue-50 dark:bg-blue-950/40',
  borderColor: 'border-blue-300 dark:border-blue-700',
  Icon: null,
};

const LATE: AppointmentStatusDisplay = {
  key: 'late',
  label: 'Késett',
  tone: 'warning',
  color: 'text-orange-600 dark:text-orange-300',
  bgColor: 'bg-orange-50 dark:bg-orange-950/40',
  borderColor: 'border-orange-300 dark:border-orange-700',
  Icon: Clock,
};

const BY_STATUS: Record<string, AppointmentStatusDisplay> = {
  completed: {
    key: 'completed',
    label: 'Sikeresen teljesült',
    tone: 'success',
    color: 'text-green-600 dark:text-green-300',
    bgColor: 'bg-green-50 dark:bg-green-950/40',
    borderColor: 'border-green-300 dark:border-green-700',
    Icon: CheckCircle2,
  },
  no_show: {
    key: 'no_show',
    label: 'Nem jelent meg',
    tone: 'error',
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-950/60',
    borderColor: 'border-red-400 dark:border-red-600',
    Icon: AlertCircle,
  },
  cancelled_by_doctor: {
    key: 'cancelled_by_doctor',
    label: 'Lemondta az orvos',
    tone: 'error',
    color: 'text-red-600 dark:text-red-300',
    bgColor: 'bg-red-50 dark:bg-red-950/40',
    borderColor: 'border-red-300 dark:border-red-700',
    Icon: XCircle,
  },
  cancelled_by_patient: {
    key: 'cancelled_by_patient',
    label: 'Lemondta a beteg',
    tone: 'warning',
    color: 'text-orange-600 dark:text-orange-300',
    bgColor: 'bg-orange-50 dark:bg-orange-950/40',
    borderColor: 'border-orange-300 dark:border-orange-700',
    Icon: XCircle,
  },
  unsuccessful: {
    key: 'unsuccessful',
    label: 'Sikertelen – újra kell',
    tone: 'warning',
    color: 'text-amber-600 dark:text-amber-300',
    bgColor: 'bg-amber-50 dark:bg-amber-950/40',
    borderColor: 'border-amber-300 dark:border-amber-700',
    Icon: RotateCcw,
  },
};

/**
 * Egy időpont státuszának megjelenítési leírója. A státusz felülírja a „késett"
 * jelzést; ha nincs státusz és nem késett, a `pending` (Várható) leírót adja
 * vissza — a hívó eldöntheti, hogy megjeleníti-e (a widget pl. ilyenkor inkább
 * az outcome-gombokat mutatja badge helyett).
 */
export function getAppointmentStatusDisplay(
  status: string | null | undefined,
  isLate?: boolean | null,
): AppointmentStatusDisplay {
  if (status && BY_STATUS[status]) return BY_STATUS[status];
  if (isLate) return LATE;
  return PENDING;
}
