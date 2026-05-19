/**
 * Entity revision + optimistic locking for patient / episode / appointment aggregates.
 */

import type { Pool, PoolClient } from 'pg';
import { getComplianceFeatureFlag } from './feature-flags';

export type RevisionEntityType = 'patient' | 'episode' | 'appointment';

const TABLE_MAP: Record<RevisionEntityType, { table: string; idColumn: string }> = {
  patient: { table: 'patients', idColumn: 'id' },
  episode: { table: 'patient_episodes', idColumn: 'id' },
  appointment: { table: 'appointments', idColumn: 'id' },
};

export class RevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT';
  constructor(
    public readonly entityType: RevisionEntityType,
    public readonly entityId: string,
    public readonly expected: number,
    public readonly actual: number
  ) {
    super(
      `Revision conflict on ${entityType}:${entityId} (expected ${expected}, actual ${actual})`
    );
    this.name = 'RevisionConflictError';
  }
}

type Db = Pool | PoolClient;

export async function getDomainRevision(
  db: Db,
  entityType: RevisionEntityType,
  entityId: string
): Promise<number> {
  const { table, idColumn } = TABLE_MAP[entityType];
  const r = await db.query(
    `SELECT domain_revision FROM ${table} WHERE ${idColumn} = $1`,
    [entityId]
  );
  return Number(r.rows[0]?.domain_revision ?? 1);
}

/**
 * Increment domain_revision with optional optimistic check.
 * Returns the new revision number.
 */
export async function bumpDomainRevision(
  db: Db,
  entityType: RevisionEntityType,
  entityId: string,
  expectedRevision?: number
): Promise<number> {
  const lockingEnabled = await getComplianceFeatureFlag('entity_revision_locking');
  const { table, idColumn } = TABLE_MAP[entityType];

  if (lockingEnabled && expectedRevision != null) {
    const r = await db.query(
      `UPDATE ${table}
       SET domain_revision = domain_revision + 1,
           recorded_at = COALESCE(recorded_at, CURRENT_TIMESTAMP),
           effective_at = CURRENT_TIMESTAMP
       WHERE ${idColumn} = $1 AND domain_revision = $2
       RETURNING domain_revision`,
      [entityId, expectedRevision]
    );
    if (r.rowCount === 0) {
      const actual = await getDomainRevision(db, entityType, entityId);
      throw new RevisionConflictError(entityType, entityId, expectedRevision, actual);
    }
    return Number(r.rows[0].domain_revision);
  }

  const r = await db.query(
    `UPDATE ${table}
     SET domain_revision = domain_revision + 1,
         recorded_at = COALESCE(recorded_at, CURRENT_TIMESTAMP),
         effective_at = CURRENT_TIMESTAMP
     WHERE ${idColumn} = $1
     RETURNING domain_revision`,
    [entityId]
  );
  return Number(r.rows[0]?.domain_revision ?? 1);
}

/** Invalidate downstream approval when parent aggregate revision changes. */
export async function invalidateApprovalOnRevisionChange(
  db: Db,
  entityType: RevisionEntityType,
  entityId: string
): Promise<void> {
  if (entityType === 'appointment') {
    await db.query(
      `UPDATE appointments
       SET approval_status = CASE
         WHEN approval_status = 'approved' THEN 'pending'
         ELSE approval_status
       END,
       approved_at = NULL
       WHERE id = $1 AND approval_status = 'approved'`,
      [entityId]
    );
  }
  if (entityType === 'patient' || entityType === 'episode') {
    await db.query(
      `UPDATE entity_quality_state
       SET quality_state = CASE
         WHEN quality_state IN ('CENTER_APPROVED', 'REGISTRY_APPROVED', 'LOCKED_FOR_ANALYSIS')
           THEN 'LOCAL_REVIEW'
         ELSE quality_state
       END,
       updated_at = CURRENT_TIMESTAMP
       WHERE entity_type = $1 AND entity_id = $2`,
      [entityType === 'patient' ? 'patient' : 'episode', entityId]
    );
  }
}
