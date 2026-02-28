import { AppointmentBooking } from './AppointmentBooking';

interface ConditionalAppointmentBookingProps {
  patientId?: string | null;
  patientEmail?: string | null;
  onBookingComplete?: () => void;
}

export function ConditionalAppointmentBooking(props: ConditionalAppointmentBookingProps) {
  return <AppointmentBooking {...props} mode="conditional" />;
}
