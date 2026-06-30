/**
 * Consent lifecycle helpers.
 * Withdrawal policy: exclude_future_only (see operational-policy.ts).
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';
import { CONSENT_WITHDRAWAL_POLICY } from './operational-policy';

export type ConsentStatus =
  | 'unknown'
  | 'pending'
  | 'granted'
  | 'withdrawn'
  | 'expired'
  | 'declined';

export interface ConsentWithdrawalPolicy {
  frozenExportPolicy: 'exclude_future_only' | 'tombstone_artifact' | 'hard_delete';
}

export const DEFAULT_WITHDRAWAL_POLICY: ConsentWithdrawalPolicy = {
  frozenExportPolicy: CONSENT_WITHDRAWAL_POLICY.frozenExportPolicy,
};

export async function recordConsentWithdrawal(
  patientId: string,
  pool?: Pool
): Promise<void> {
  const db = pool ?? getDbPool();
  await db.query(
    // set_config(...): hozzájárulás-visszavonás szerver/portál-kezelt mellék-írás
    // → őrizze meg a beteg optimista zár tokenjét. Lásd database/migrations/062.
    `UPDATE patients
     SET consent_status = 'withdrawn',
         consent_withdrawn_at = CURRENT_TIMESTAMP,
         research_usable_until = CURRENT_TIMESTAMP
     WHERE id = $1 AND set_config('app.skip_updated_at','on',true) IS NOT NULL`,
    [patientId]
  );

  await db.query(
    `UPDATE consent_export_manifest
     SET excluded_at = CURRENT_TIMESTAMP, exclusion_reason = 'consent_withdrawn'
     WHERE patient_id = $1 AND excluded_at IS NULL`,
    [patientId]
  );
}

const TRANSITIONAL_COMPLIANCE = new Set(['LEGACY_UNVERIFIED', 'IMPORTED_LEGACY']);

export async function isPatientResearchUsable(
  patientId: string,
  pool?: Pool
): Promise<boolean> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT consent_status, research_usable_until, consent_withdrawn_at, legacy_compliance_status
     FROM patients WHERE id = $1`,
    [patientId]
  );
  if (r.rows.length === 0) return false;
  const row = r.rows[0];
  if (row.consent_status === 'withdrawn' || row.consent_status === 'expired') return false;
  if (row.consent_status !== 'granted') return false;
  if (row.research_usable_until && new Date(row.research_usable_until) < new Date()) {
    return false;
  }
  const legacy = row.legacy_compliance_status as string | null;
  if (legacy && TRANSITIONAL_COMPLIANCE.has(legacy)) return false;
  return true;
}

/** Returns export IDs that included a withdrawn subject (for compliance review). */
export async function getAffectedExportsForPatient(
  patientId: string,
  pool?: Pool
): Promise<string[]> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT export_id FROM consent_export_manifest WHERE patient_id = $1`,
    [patientId]
  );
  return r.rows.map((row) => row.export_id as string);
}
