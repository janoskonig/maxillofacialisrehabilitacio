/**
 * registry compliance feature flags (default off for safe rollout).
 */

import { getDbPool } from '@/lib/db';

export type ComplianceFeatureFlagKey =
  | 'unified_audit_events'
  | 'entity_revision_locking'
  | 'quality_recompute_queue'
  | 'research_export_pipeline'
  | 'tighten_snapshot_changes_access';

let cache: Map<string, boolean> | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000;

async function loadFlags(): Promise<Map<string, boolean>> {
  const pool = getDbPool();
  try {
    const r = await pool.query(
      `SELECT key, enabled FROM compliance_feature_flags`
    );
    const m = new Map<string, boolean>();
    for (const row of r.rows) {
      m.set(row.key, row.enabled === true);
    }
    return m;
  } catch {
    return new Map();
  }
}

export async function getComplianceFeatureFlag(
  key: ComplianceFeatureFlagKey
): Promise<boolean> {
  if (!cache || Date.now() >= cacheExpiry) {
    cache = await loadFlags();
    cacheExpiry = Date.now() + CACHE_TTL_MS;
  }
  return cache.get(key) ?? false;
}

export function invalidateComplianceFeatureFlagsCache(): void {
  cache = null;
}
