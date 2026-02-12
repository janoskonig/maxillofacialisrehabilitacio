/**
 * No-show risk formula (non-ML, rule-based).
 * Computed on appointment creation.
 * requires_confirmation = (risk >= 0.20)
 * hold_expires_at = now() + (risk >= 0.35 ? 24h : 48h)
 */

import { getDbPool } from './db';

export interface NoShowRiskInput {
  patientId: string;
  leadTimeDays: number;
  appointmentStartHour: number; // 0-23
  patientNoShowsLast12m: number;
}

export interface NoShowRiskResult {
  risk: number;
  requiresConfirmation: boolean;
  holdHours: number;
}

export function computeNoShowRisk(input: NoShowRiskInput): NoShowRiskResult {
  let risk = 0.05;

  if (input.patientNoShowsLast12m >= 1) risk += 0.15;
  if (input.patientNoShowsLast12m >= 2) risk += 0.1;
  if (input.leadTimeDays > 21) risk += 0.05;
  if (input.appointmentStartHour >= 7 && input.appointmentStartHour <= 9) risk += 0.05; // early morning

  risk = Math.max(0, Math.min(0.95, risk));

  const requiresConfirmation = risk >= 0.2;
  const holdHours = risk >= 0.35 ? 24 : 48;

  return { risk, requiresConfirmation, holdHours };
}

/** Get patient no-show count in last 12 months */
export async function getPatientNoShowsLast12m(patientId: string): Promise<number> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM appointments a
     WHERE a.patient_id = $1 AND a.appointment_status = 'no_show'
     AND a.created_at > CURRENT_TIMESTAMP - INTERVAL '12 months'`,
    [patientId]
  );
  return r.rows[0]?.cnt ?? 0;
}
