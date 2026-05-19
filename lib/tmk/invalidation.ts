/**
 * Bounded invalidation policy + queue enqueue for quality recompute.
 */

import type { Pool, PoolClient } from 'pg';
import {
  DEPENDENCY_GRAPH_V1,
  aggregateLocalTargets,
  transitiveInvalidationTargets,
} from './dependency-graph';
import { getDomainRevision } from './entity-revision';
import { getComplianceFeatureFlag } from './feature-flags';

type Db = Pool | PoolClient;

export interface InvalidationResult {
  dirtyEntities: Array<{ entityType: string; entityId: string; reason: string }>;
  enqueuedJobs: number;
}

/**
 * Mark downstream entities dirty and optionally enqueue quality recompute.
 * Uses aggregate-local edges by default; materialized edges only when `includeMaterialized`.
 */
export async function invalidateFromSource(
  db: Db,
  sourceType: string,
  sourceId: string,
  opts: { includeMaterialized?: boolean; patientId?: string } = {}
): Promise<InvalidationResult> {
  const graph = DEPENDENCY_GRAPH_V1;
  const targets = opts.includeMaterialized
    ? transitiveInvalidationTargets(graph, sourceType)
    : aggregateLocalTargets(graph, sourceType);

  const dirtyEntities: InvalidationResult['dirtyEntities'] = [];
  const reason = `invalidated_by_${sourceType}:${sourceId}`;

  for (const target of targets) {
    if (target === 'entity_quality_state') {
      const entityType = sourceType === 'episode' ? 'episode' : 'patient';
      const entityId = entityType === 'patient' ? sourceId : (opts.patientId ?? sourceId);
      await db.query(
        `INSERT INTO entity_invalidation_state (entity_type, entity_id, dirty_reason, dirty_since, target_revision)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
         ON CONFLICT (entity_type, entity_id) DO UPDATE SET
           dirty_reason = EXCLUDED.dirty_reason,
           dirty_since = CURRENT_TIMESTAMP,
           target_revision = EXCLUDED.target_revision`,
        [entityType, entityId, reason, await getDomainRevision(db, entityType as 'patient' | 'episode', entityId)]
      );
      dirtyEntities.push({ entityType, entityId, reason });
    }
  }

  let enqueuedJobs = 0;
  if (await getComplianceFeatureFlag('quality_recompute_queue')) {
    for (const d of dirtyEntities) {
      enqueuedJobs += await enqueueQualityRecompute(db, d.entityType, d.entityId);
    }
  }

  return { dirtyEntities, enqueuedJobs };
}

export async function enqueueQualityRecompute(
  db: Db,
  entityType: string,
  entityId: string,
  jobGeneration = 1
): Promise<number> {
  const revision =
    entityType === 'patient'
      ? await getDomainRevision(db, 'patient', entityId)
      : entityType === 'episode'
        ? await getDomainRevision(db, 'episode', entityId)
        : 1;

  const r = await db.query(
    `INSERT INTO quality_recompute_jobs (entity_type, entity_id, target_revision, job_generation, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (entity_type, entity_id, target_revision, job_generation) DO NOTHING
     RETURNING id`,
    [entityType, entityId, revision, jobGeneration]
  );
  return r.rowCount ?? 0;
}
