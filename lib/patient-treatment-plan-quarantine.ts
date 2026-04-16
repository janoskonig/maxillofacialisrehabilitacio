import type { Pool } from 'pg';
import { createHash } from 'crypto';

export type QuarantineInsertInput = {
  patientId: string;
  location: string | null;
  payloadSnapshot: unknown;
  /** If omitted, derived from stable JSON stringification of payloadSnapshot */
  sourceFingerprint?: string;
  resolverVersion: number;
  migrationRunId?: string | null;
};

function defaultFingerprint(payload: unknown): string {
  const s = JSON.stringify(payload);
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Immutable ingest row for patient_treatment_plan_json_quarantine.
 * Caller must enforce WRITE_PLAN_ITEMS / admin policy at the API boundary.
 */
export async function insertTreatmentPlanJsonQuarantine(pool: Pool, input: QuarantineInsertInput) {
  const fp = input.sourceFingerprint?.trim() || defaultFingerprint(input.payloadSnapshot);
  const res = await pool.query(
    `INSERT INTO patient_treatment_plan_json_quarantine (
       patient_id, location, payload_snapshot, source_fingerprint, resolver_version,
       resolution_status, migration_run_id
     ) VALUES ($1, $2, $3::jsonb, $4, $5, 'pending', $6)
     RETURNING id, created_at`,
    [
      input.patientId,
      input.location,
      JSON.stringify(input.payloadSnapshot ?? {}),
      fp,
      input.resolverVersion,
      input.migrationRunId ?? null,
    ]
  );
  return res.rows[0] as { id: string; created_at: Date };
}
