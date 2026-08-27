import { ConditionalAppointmentOffers } from './ConditionalAppointmentOffers';

interface ConditionalAppointmentBookingProps {
  patientId?: string | null;
  patientEmail?: string | null;
  onBookingComplete?: () => void;
}

/**
 * Vékony kompatibilitási wrapper — a feltételes időpont-ajánlatok UI a
 * ConditionalAppointmentOffers komponensben él (WP-1.4).
 */
export function ConditionalAppointmentBooking(props: ConditionalAppointmentBookingProps) {
  return <ConditionalAppointmentOffers {...props} />;
}
