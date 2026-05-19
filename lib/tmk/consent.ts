/**
 * Consent lifecycle helpers.
 * NOTE: Withdrawal impact on frozen exports requires legal/compliance decision.
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';

export type ConsentStatus = 'unknown' | 'pending' | 'granted' | 'withdrawn' | 'expired';

export interface ConsentWithdrawalPolicy {
  /** 'exclude_future_only' | 'tombstone_artifact' | 'hard_delete' — legal decision required */
  frozenExportPolicy: 'exclude_future_only' | 'tombstone_artifact' | 'hard_delete';
}

/** Default until legal review — safest technical default. */
export const DEFAULT_WITHDRAWAL_POLICY: ConsentWithdrawalPolicy = {
  frozenExportPolicy: 'exclude_future_only',
};

export async function recordConsentWithdrawal(
  patientId: string,
  pool?: Pool
): Promise<void> {
  const db = pool ?? getDbPool();
  await db.query(
    `UPDATE patients
     SET consent_status = 'withdrawn',
         consent_withdrawn_at = CURRENT_TIMESTAMP,
         research_usable_until = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [patientId]
  );

  await db.query(
    `UPDATE consent_export_manifest
     SET excluded_at = CURRENT_TIMESTAMP, exclusion_reason = 'consent_withdrawn'
     WHERE patient_id = $1 AND excluded_at IS NULL`,
    [patientId]
  );
}

export async function isPatientResearchUsable(
  patientId: string,
  pool?: Pool
): Promise<boolean> {
  const db = pool ?? getDbPool();
  const r = await db.query(
    `SELECT consent_status, research_usable_until, consent_withdrawn_at
     FROM patients WHERE id = $1`,
    [patientId]
  );
  if (r.rows.length === 0) return false;
  const row = r.rows[0];
  if (row.consent_status === 'withdrawn') return false;
  if (row.research_usable_until && new Date(row.research_usable_until) < new Date()) {
    return false;
  }
  return row.consent_status === 'granted' || row.consent_status === 'unknown';
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
