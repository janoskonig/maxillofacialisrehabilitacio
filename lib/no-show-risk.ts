/**
 * No-show risk formula (non-ML, rule-based).
 * Computed on appointment creation.
 * Coefficients from no_show_risk_config when available; defaults otherwise.
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

const DEFAULT_COEFFS = {
  base: 0.05,
  noShow1: 0.15,
  noShow2: 0.1,
  leadTime: 0.05,
  earlyMorning: 0.05,
  confirmThreshold: 0.2,
  shortHoldThreshold: 0.35,
};

async function getCoeffs(): Promise<typeof DEFAULT_COEFFS> {
  try {
    const pool = getDbPool();
    const r = await pool.query(
      `SELECT key, value::float FROM no_show_risk_config WHERE key IN ('base_risk','no_show_1_penalty','no_show_2_penalty','lead_time_penalty','early_morning_penalty','requires_confirmation_threshold','short_hold_threshold')`
    );
    const m = Object.fromEntries(r.rows.map((row: { key: string; value: number }) => [row.key, row.value]));
    return {
      base: m.base_risk ?? DEFAULT_COEFFS.base,
      noShow1: m.no_show_1_penalty ?? DEFAULT_COEFFS.noShow1,
      noShow2: m.no_show_2_penalty ?? DEFAULT_COEFFS.noShow2,
      leadTime: m.lead_time_penalty ?? DEFAULT_COEFFS.leadTime,
      earlyMorning: m.early_morning_penalty ?? DEFAULT_COEFFS.earlyMorning,
      confirmThreshold: m.requires_confirmation_threshold ?? DEFAULT_COEFFS.confirmThreshold,
      shortHoldThreshold: m.short_hold_threshold ?? DEFAULT_COEFFS.shortHoldThreshold,
    };
  } catch {
    return DEFAULT_COEFFS;
  }
}

export function computeNoShowRisk(input: NoShowRiskInput): NoShowRiskResult {
  return computeNoShowRiskSync(input, DEFAULT_COEFFS);
}

export function computeNoShowRiskSync(input: NoShowRiskInput, coeffs: typeof DEFAULT_COEFFS): NoShowRiskResult {
  let risk = coeffs.base;
  if (input.patientNoShowsLast12m >= 1) risk += coeffs.noShow1;
  if (input.patientNoShowsLast12m >= 2) risk += coeffs.noShow2;
  if (input.leadTimeDays > 21) risk += coeffs.leadTime;
  if (input.appointmentStartHour >= 7 && input.appointmentStartHour <= 9) risk += coeffs.earlyMorning;
  risk = Math.max(0, Math.min(0.95, risk));
  const requiresConfirmation = risk >= coeffs.confirmThreshold;
  const holdHours = risk >= coeffs.shortHoldThreshold ? 24 : 48;
  return { risk, requiresConfirmation, holdHours };
}

export async function computeNoShowRiskWithConfig(input: NoShowRiskInput): Promise<NoShowRiskResult> {
  const coeffs = await getCoeffs();
  return computeNoShowRiskSync(input, coeffs);
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
