'use client';

import { useAppointmentOutcomes, type OutcomeAppointment } from '@/hooks/useAppointmentOutcomes';
import { AppointmentOutcomeRow } from './AppointmentOutcomeRow';

interface Props {
  appointments: OutcomeAppointment[];
  onUpdate?: () => void;
  className?: string;
}

/**
 * A mai időpontok kimenetel-kezelő listája (gombok, edit/retry, rebook). A dedikált
 * Mai időpontok oldal fő tartalma; a teljes logika a useAppointmentOutcomes hookból jön.
 */
export function AppointmentOutcomeList({ appointments, onUpdate, className = '' }: Props) {
  const c = useAppointmentOutcomes(appointments, onUpdate);
  return (
    <div className={`space-y-2 ${className}`.trim()}>
      {c.appointments.map((appointment) => (
        <AppointmentOutcomeRow key={appointment.id} appointment={appointment} c={c} />
      ))}
    </div>
  );
}
