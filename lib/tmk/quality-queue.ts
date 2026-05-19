/**
 * Async quality recompute queue processor (at-least-once with dedupe guard).
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';
import { computeQualityMetrics } from './quality-metrics';
import { logger } from '@/lib/logger';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

export async function processQualityRecomputeBatch(pool?: Pool): Promise<number> {
  const db = pool ?? getDbPool();
  const pending = await db.query(
    `SELECT id, entity_type, entity_id, target_revision, job_generation, attempt_count
     FROM quality_recompute_jobs
     WHERE status = 'pending'
     ORDER BY enqueued_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [BATCH_SIZE]
  );

  let processed = 0;
  for (const job of pending.rows) {
    await db.query(
      `UPDATE quality_recompute_jobs SET status = 'processing', started_at = CURRENT_TIMESTAMP, attempt_count = attempt_count + 1 WHERE id = $1`,
      [job.id]
    );

    try {
      if (job.entity_type === 'patient') {
        await recomputePatientQuality(db, job.entity_id, job.target_revision);
      }
      await db.query(
        `UPDATE quality_recompute_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [job.id]
      );
      await db.query(
        `UPDATE entity_invalidation_state SET last_recomputed_at = CURRENT_TIMESTAMP, dirty_reason = NULL WHERE entity_type = $1 AND entity_id = $2`,
        [job.entity_type, job.entity_id]
      );
      processed++;
    } catch (err) {
      const attempts = Number(job.attempt_count) + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'quarantined' : 'failed';
      await db.query(
        `UPDATE quality_recompute_jobs SET status = $1, last_error = $2 WHERE id = $3`,
        [status, err instanceof Error ? err.message : String(err), job.id]
      );
      if (status === 'quarantined') {
        logger.error('[TMK] Quality job quarantined', { jobId: job.id, entityId: job.entity_id });
      }
    }
  }
  return processed;
}

async function recomputePatientQuality(
  db: Pool,
  patientId: string,
  targetRevision: number
): Promise<void> {
  const patientResult = await db.query(`SELECT * FROM patients WHERE id = $1`, [patientId]);
  if (patientResult.rows.length === 0) return;

  const currentRevision = Number(patientResult.rows[0].domain_revision ?? 1);
  if (currentRevision !== Number(targetRevision)) {
    return;
  }

  const docsResult = await db.query(
    `SELECT id, tags FROM patient_documents WHERE patient_id = $1`,
    [patientId]
  );

  const metrics = computeQualityMetrics(
    patientResult.rows[0] as never,
    docsResult.rows as never,
    patientResult.rows[0].updated_at
  );

  await db.query(
    `INSERT INTO entity_quality_state (
       entity_type, entity_id, completeness_score, missing_critical_fields,
       contradiction_flags, stale_days, source_revision, computed_at, updated_at
     ) VALUES ('patient', $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       completeness_score = EXCLUDED.completeness_score,
       missing_critical_fields = EXCLUDED.missing_critical_fields,
       contradiction_flags = EXCLUDED.contradiction_flags,
       stale_days = EXCLUDED.stale_days,
       source_revision = EXCLUDED.source_revision,
       computed_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     WHERE entity_quality_state.source_revision IS NULL
        OR entity_quality_state.source_revision <= EXCLUDED.source_revision`,
    [
      patientId,
      metrics.completenessScore,
      JSON.stringify(metrics.missingCriticalFields),
      JSON.stringify(metrics.contradictionFlags),
      metrics.staleDays,
      targetRevision,
    ]
  );
}
