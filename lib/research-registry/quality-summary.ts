/**
 * Aggregated quality metrics from entity_quality_state (read model).
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';
import { getComplianceFeatureFlag } from './feature-flags';

export interface QualitySummary {
  enabled: boolean;
  totalEntities: number;
  byState: Array<{ state: string; count: number }>;
  avgCompleteness: number | null;
  lowCompletenessCount: number;
  staleCount: number;
  withContradictions: number;
  queuePending: number;
  queueFailed: number;
  queueQuarantined: number;
}

const LOW_COMPLETENESS_THRESHOLD = 80;
const STALE_DAYS_THRESHOLD = 90;

export async function fetchQualitySummary(pool?: Pool): Promise<QualitySummary> {
  const enabled = await getComplianceFeatureFlag('quality_recompute_queue');
  const empty: QualitySummary = {
    enabled,
    totalEntities: 0,
    byState: [],
    avgCompleteness: null,
    lowCompletenessCount: 0,
    staleCount: 0,
    withContradictions: 0,
    queuePending: 0,
    queueFailed: 0,
    queueQuarantined: 0,
  };

  if (!enabled) return empty;

  const db = pool ?? getDbPool();

  try {
    const [stateAgg, metricsAgg, queueAgg] = await Promise.all([
      db.query(`
        SELECT quality_state AS state, COUNT(*)::int AS count
        FROM entity_quality_state
        GROUP BY quality_state
        ORDER BY count DESC
      `),
      db.query(`
        SELECT
          COUNT(*)::int AS total,
          ROUND(AVG(completeness_score)::numeric, 2) AS avg_completeness,
          COUNT(*) FILTER (WHERE completeness_score IS NOT NULL AND completeness_score < $1)::int AS low_completeness,
          COUNT(*) FILTER (WHERE stale_days IS NOT NULL AND stale_days >= $2)::int AS stale_count,
          COUNT(*) FILTER (
            WHERE contradiction_flags IS NOT NULL
              AND contradiction_flags::text != '[]'
          )::int AS with_contradictions
        FROM entity_quality_state
      `, [LOW_COMPLETENESS_THRESHOLD, STALE_DAYS_THRESHOLD]),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'quarantined')::int AS quarantined
        FROM quality_recompute_jobs
      `),
    ]);

    const m = metricsAgg.rows[0] ?? {};
    const q = queueAgg.rows[0] ?? {};

    return {
      enabled: true,
      totalEntities: Number(m.total ?? 0),
      byState: stateAgg.rows.map((r) => ({
        state: String(r.state),
        count: Number(r.count),
      })),
      avgCompleteness: m.avg_completeness != null ? Number(m.avg_completeness) : null,
      lowCompletenessCount: Number(m.low_completeness ?? 0),
      staleCount: Number(m.stale_count ?? 0),
      withContradictions: Number(m.with_contradictions ?? 0),
      queuePending: Number(q.pending ?? 0),
      queueFailed: Number(q.failed ?? 0),
      queueQuarantined: Number(q.quarantined ?? 0),
    };
  } catch {
    return empty;
  }
}
