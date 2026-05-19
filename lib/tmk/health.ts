/**
 * Operational health checks against TMK SLO targets.
 */

import type { Pool } from 'pg';
import { getDbPool } from '@/lib/db';
import {
  EXPORT_QUEUE_SLA,
  QUALITY_RECOMPUTE_SLA,
  RESEARCH_CONSISTENCY_SLA,
  type SloTarget,
} from './slo-config';

export type SloStatus = 'ok' | 'warning' | 'critical';

export interface SloCheckResult {
  slo: SloTarget;
  status: SloStatus;
  measuredMs: number | null;
  detail: string;
}

export interface TmkHealthReport {
  timestamp: string;
  checks: SloCheckResult[];
  summary: {
    ok: number;
    warning: number;
    critical: number;
  };
  queue: {
    pendingJobs: number;
    oldestPendingLagMs: number | null;
    failedJobs: number;
    quarantinedJobs: number;
  };
  invalidation: {
    dirtyEntities: number;
    oldestDirtyLagMs: number | null;
  };
}

function statusFromLag(lagMs: number, slo: SloTarget): SloStatus {
  const alert = slo.alertThresholdMs ?? slo.maxStaleDurationMs;
  if (lagMs >= alert) return 'critical';
  if (lagMs >= slo.maxStaleDurationMs) return 'warning';
  return 'ok';
}

export async function collectTmkHealth(pool?: Pool): Promise<TmkHealthReport> {
  const db = pool ?? getDbPool();
  const now = Date.now();

  const [queueStats, dirtyStats, exportStats] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'quarantined')::int AS quarantined,
        MIN(enqueued_at) FILTER (WHERE status = 'pending') AS oldest_pending
      FROM quality_recompute_jobs
    `).catch(() => ({ rows: [{}] })),
    db.query(`
      SELECT
        COUNT(*)::int AS dirty_count,
        MIN(dirty_since) AS oldest_dirty
      FROM entity_invalidation_state
      WHERE dirty_reason IS NOT NULL
    `).catch(() => ({ rows: [{}] })),
    db.query(`
      SELECT MIN(created_at) AS oldest_pending_export
      FROM analysis_exports
      WHERE status IN ('pending', 'processing')
    `).catch(() => ({ rows: [{}] })),
  ]);

  const q = queueStats.rows[0] ?? {};
  const d = dirtyStats.rows[0] ?? {};
  const e = exportStats.rows[0] ?? {};

  const oldestPending = q.oldest_pending ? new Date(q.oldest_pending).getTime() : null;
  const queueLagMs = oldestPending != null ? now - oldestPending : null;

  const oldestDirty = d.oldest_dirty ? new Date(d.oldest_dirty).getTime() : null;
  const dirtyLagMs = oldestDirty != null ? now - oldestDirty : null;

  const oldestExport = e.oldest_pending_export
    ? new Date(e.oldest_pending_export).getTime()
    : null;
  const exportLagMs = oldestExport != null ? now - oldestExport : null;

  const checks: SloCheckResult[] = [];

  checks.push({
    slo: QUALITY_RECOMPUTE_SLA,
    status:
      queueLagMs == null
        ? 'ok'
        : statusFromLag(queueLagMs, QUALITY_RECOMPUTE_SLA),
    measuredMs: queueLagMs,
    detail:
      queueLagMs == null
        ? 'No pending quality recompute jobs'
        : `Oldest pending job lag ${Math.round(queueLagMs / 1000)}s`,
  });

  checks.push({
    slo: RESEARCH_CONSISTENCY_SLA,
    status:
      dirtyLagMs == null
        ? 'ok'
        : statusFromLag(dirtyLagMs, RESEARCH_CONSISTENCY_SLA),
    measuredMs: dirtyLagMs,
    detail:
      dirtyLagMs == null
        ? 'No dirty invalidation markers'
        : `Oldest dirty entity ${Math.round(dirtyLagMs / 1000)}s`,
  });

  checks.push({
    slo: EXPORT_QUEUE_SLA,
    status:
      exportLagMs == null ? 'ok' : statusFromLag(exportLagMs, EXPORT_QUEUE_SLA),
    measuredMs: exportLagMs,
    detail:
      exportLagMs == null
        ? 'No pending analysis exports'
        : `Oldest pending export ${Math.round(exportLagMs / 1000)}s`,
  });

  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warning: checks.filter((c) => c.status === 'warning').length,
    critical: checks.filter((c) => c.status === 'critical').length,
  };

  return {
    timestamp: new Date().toISOString(),
    checks,
    summary,
    queue: {
      pendingJobs: Number(q.pending ?? 0),
      oldestPendingLagMs: queueLagMs,
      failedJobs: Number(q.failed ?? 0),
      quarantinedJobs: Number(q.quarantined ?? 0),
    },
    invalidation: {
      dirtyEntities: Number(d.dirty_count ?? 0),
      oldestDirtyLagMs: dirtyLagMs,
    },
  };
}
