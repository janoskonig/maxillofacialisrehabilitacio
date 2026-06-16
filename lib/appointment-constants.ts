export type AppointmentType = 'elso_konzultacio' | 'munkafazis' | 'kontroll' | 'recall' | 'egyeb';

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  elso_konzultacio: 'Első konzultáció',
  munkafazis: 'Munkafázis',
  kontroll: 'Kontroll',
  recall: 'Recall',
  egyeb: 'Egyéb',
};

export const APPOINTMENT_TYPE_OPTIONS: { value: AppointmentType; label: string }[] = [
  { value: 'elso_konzultacio', label: 'Első konzultáció' },
  { value: 'munkafazis', label: 'Munkafázis' },
  { value: 'kontroll', label: 'Kontroll' },
  { value: 'recall', label: 'Recall' },
  { value: 'egyeb', label: 'Egyéb' },
];

/** Canonical allowed values — mirror of the DB CHECK in migration 060. */
export const APPOINTMENT_TYPE_VALUES: AppointmentType[] = APPOINTMENT_TYPE_OPTIONS.map((o) => o.value);

export function isAppointmentType(value: unknown): value is AppointmentType {
  return typeof value === 'string' && (APPOINTMENT_TYPE_VALUES as string[]).includes(value);
}

export function getAppointmentTypeLabel(type: string | null | undefined): string {
  if (!type) return '';
  return APPOINTMENT_TYPE_LABELS[type as AppointmentType] ?? type;
}

/** Visual chip for the dashboard "today" list: emoji + Tailwind classes per type. */
export interface AppointmentTypeChip {
  label: string;
  emoji: string;
  /** Tailwind text+bg classes (light + dark). */
  className: string;
}

const TYPE_CHIP: Record<AppointmentType, AppointmentTypeChip> = {
  elso_konzultacio: { label: 'Konzultáció', emoji: '💬', className: 'text-purple-700 bg-purple-50 dark:text-purple-300 dark:bg-purple-950/40' },
  munkafazis: { label: 'Munkafázis', emoji: '🦷', className: 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40' },
  kontroll: { label: 'Kontroll', emoji: '🔁', className: 'text-cyan-700 bg-cyan-50 dark:text-cyan-300 dark:bg-cyan-950/40' },
  recall: { label: 'Recall', emoji: '🔁', className: 'text-pink-700 bg-pink-50 dark:text-pink-300 dark:bg-pink-950/40' },
  egyeb: { label: 'Egyéb', emoji: '✎', className: 'text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-gray-800' },
};

/** Catch-all chip used when no/unknown type is set but a free-text label exists. */
const FREE_TEXT_CHIP: AppointmentTypeChip = {
  label: 'Egyéb',
  emoji: '✎',
  className: 'text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-gray-800',
};

/**
 * Resolve the chip to render for an appointment. A free-text `typeLabel` (when
 * present) overrides the chip label so e.g. "implantátum kontroll 6h" shows
 * verbatim; otherwise the canonical per-type chip is used. Returns `null` when
 * there is nothing to show (no type and no label).
 */
export function getAppointmentTypeChip(
  type: string | null | undefined,
  typeLabel?: string | null,
): AppointmentTypeChip | null {
  const label = typeof typeLabel === 'string' ? typeLabel.trim() : '';
  if (isAppointmentType(type)) {
    const base = TYPE_CHIP[type];
    return label ? { ...base, label } : base;
  }
  if (label) {
    return { ...FREE_TEXT_CHIP, label };
  }
  return null;
}
