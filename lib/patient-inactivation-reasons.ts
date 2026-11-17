/**
 * Beteg-inaktiválási okok (117-es migráció CHECK constraint-jével egyezően).
 * Kliens- és szerveroldalon is importálható (nincs szerver-függősége).
 */

export const PATIENT_INACTIVATION_REASONS = [
  'nem_celcsoport',
  'mashova_iranyitva',
  'beteg_visszalepett',
  'duplikatum',
  'egyeb',
] as const;

export type PatientInactivationReason = (typeof PATIENT_INACTIVATION_REASONS)[number];

export const PATIENT_INACTIVATION_REASON_LABELS: Record<PatientInactivationReason, string> = {
  nem_celcsoport: 'Nem célcsoport (pl. egyszerű fogpótlástani beteg)',
  mashova_iranyitva: 'Máshová irányítva',
  beteg_visszalepett: 'A beteg visszalépett / nem kéri az ellátást',
  duplikatum: 'Duplikált rekord',
  egyeb: 'Egyéb',
};

export function isPatientInactivationReason(value: unknown): value is PatientInactivationReason {
  return typeof value === 'string' && (PATIENT_INACTIVATION_REASONS as readonly string[]).includes(value);
}

/** Megjegyzés kötelező-e az adott okhoz. */
export function inactivationNoteRequired(reason: PatientInactivationReason): boolean {
  return reason === 'egyeb';
}

/** A GET/POST/DELETE /api/patients/[id]/inactivation válaszának állapota. */
export interface PatientInactivationState {
  patientId: string;
  inaktivalvaAt: string | null;
  inaktivalasOka: PatientInactivationReason | null;
  inaktivalasMegjegyzes: string | null;
  inaktivaltaNev: string | null;
  /** Jövőbeli, aktív (nem lemondott) időpontok száma — inaktiváláskor figyelmeztetéshez. */
  futureAppointmentCount: number;
}
