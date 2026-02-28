export type AppointmentType = 'elso_konzultacio' | 'munkafazis' | 'kontroll';

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  elso_konzultacio: 'Első konzultáció',
  munkafazis: 'Munkafázis',
  kontroll: 'Kontroll',
};

export const APPOINTMENT_TYPE_OPTIONS: { value: AppointmentType; label: string }[] = [
  { value: 'elso_konzultacio', label: 'Első konzultáció' },
  { value: 'munkafazis', label: 'Munkafázis' },
  { value: 'kontroll', label: 'Kontroll' },
];

export function getAppointmentTypeLabel(type: string | null | undefined): string {
  if (!type) return '';
  return APPOINTMENT_TYPE_LABELS[type as AppointmentType] ?? type;
}
