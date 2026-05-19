/**
 * Manual quality state overrides (audited).
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { writeAuditEvent } from './audit-events';
import {
  assertQualityTransition,
  type QualityState,
  QUALITY_STATES,
} from './quality-state';

type Db = Pool | PoolClient;

export interface QualityOverrideInput {
  entityType: string;
  entityId: string;
  newState: QualityState;
  overrideReason: string;
  overrideActor: string;
  overrideExpiry?: string | null;
}

export interface QualityOverrideResult {
  overrideId: string;
  previousState: string | null;
  newState: QualityState;
}

export async function applyQualityManualOverride(
  input: QualityOverrideInput,
  pool?: Pool
): Promise<QualityOverrideResult> {
  if (!QUALITY_STATES.includes(input.newState)) {
    throw new Error(`Invalid quality state: ${input.newState}`);
  }
  if (!input.overrideReason.trim()) {
    throw new Error('override_reason is required');
  }

  const db = pool ?? getDbPool();

  const current = await db.query(
    `SELECT quality_state FROM entity_quality_state
     WHERE entity_type = $1 AND entity_id = $2`,
    [input.entityType, input.entityId]
  );

  const previousState = (current.rows[0]?.quality_state as string | undefined) ?? null;

  if (previousState) {
    assertQualityTransition(previousState as QualityState, input.newState);
  }

  await db.query(
    `INSERT INTO entity_quality_state (entity_type, entity_id, quality_state, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       quality_state = EXCLUDED.quality_state,
       updated_at = CURRENT_TIMESTAMP`,
    [input.entityType, input.entityId, input.newState]
  );

  const overrideResult = await db.query(
    `INSERT INTO quality_manual_overrides (
       entity_type, entity_id, override_reason, override_actor,
       override_expiry, previous_state, new_state
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.entityType,
      input.entityId,
      input.overrideReason.trim(),
      input.overrideActor,
      input.overrideExpiry ?? null,
      previousState,
      input.newState,
    ]
  );

  const overrideId = overrideResult.rows[0].id as string;

  await writeAuditEvent(db, {
    entityType: input.entityType,
    entityId: input.entityId,
    action: 'quality_manual_override',
    actorEmail: input.overrideActor,
    reason: input.overrideReason,
    oldState: previousState ? { quality_state: previousState } : null,
    newState: { quality_state: input.newState, override_id: overrideId },
  });

  return {
    overrideId,
    previousState,
    newState: input.newState,
  };
}
