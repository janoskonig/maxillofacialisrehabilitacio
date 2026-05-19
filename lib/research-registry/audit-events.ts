/**
 * Unified append-only audit_events writer.
 */

import type { Pool, PoolClient } from 'pg';
import { getComplianceFeatureFlag } from './feature-flags';

type Db = Pool | PoolClient;

export interface AuditEventInput {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string | null;
  actorEmail?: string | null;
  reason?: string | null;
  oldState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditEvent(db: Db, input: AuditEventInput): Promise<string | null> {
  if (!(await getComplianceFeatureFlag('unified_audit_events'))) {
    return null;
  }

  const r = await db.query(
    `INSERT INTO audit_events (
       entity_type, entity_id, action, actor_id, actor_email, reason,
       old_state, new_state, correlation_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.entityType,
      input.entityId,
      input.action,
      input.actorId ?? null,
      input.actorEmail ?? null,
      input.reason ?? null,
      input.oldState ? JSON.stringify(input.oldState) : null,
      input.newState ? JSON.stringify(input.newState) : null,
      input.correlationId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  return r.rows[0]?.id ?? null;
}
