export const PATIENT_SCOPE_VALUES = ['all', 'mine'] as const;
export type PatientScope = (typeof PATIENT_SCOPE_VALUES)[number];

export const PATIENT_QUICK_VIEW_VALUES = [
  'all',
  'consult',
  'preparatory',
  'prosthetic',
  'followup',
  'action_required',
] as const;
export type PatientQuickView = (typeof PATIENT_QUICK_VIEW_VALUES)[number];

export const PATIENT_ADDITIONAL_FILTER_VALUES = [
  'no_next_appointment',
  'next_consilium',
  'missing_data',
  'missing_docs',
  'stale_stage',
  'no_doctor',
  'no_active_episode',
] as const;
export type PatientAdditionalFilter = (typeof PATIENT_ADDITIONAL_FILTER_VALUES)[number];

export type PatientFilterCounts = {
  scopes: Record<PatientScope, number>;
  quickViews: Record<PatientQuickView, number>;
  additional: Record<PatientAdditionalFilter, number>;
};

export function isPatientScope(value: string | null): value is PatientScope {
  return value != null && (PATIENT_SCOPE_VALUES as readonly string[]).includes(value);
}

export function isPatientQuickView(value: string | null): value is PatientQuickView {
  return value != null && (PATIENT_QUICK_VIEW_VALUES as readonly string[]).includes(value);
}

export function isPatientAdditionalFilter(value: string): value is PatientAdditionalFilter {
  return (PATIENT_ADDITIONAL_FILTER_VALUES as readonly string[]).includes(value);
}
