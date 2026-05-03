/**
 * Feature flags for scheduling (overbooking, auto-convert, auto-rebalance,
 * strict one-hard-next, enforce one-hard-next).
 * Default: all disabled for safe rollout.
 *
 * `enforce_one_hard_next` is the master switch for the one-hard-next invariant
 * (≤1 future hard work appointment per episode). When `false` (default), the
 * rule is OFF — bookings proceed without that check. When `true`, the existing
 * application-level check runs (and `strict_one_hard_next` then controls
 * whether admin/beutaló orvos override is allowed).
 */

import { getDbPool } from './db';

export type SchedulingFeatureFlagKey =
  | 'overbooking'
  | 'auto_convert_intents'
  | 'auto_rebalance'
  | 'strict_one_hard_next'
  | 'enforce_one_hard_next';

let cache: Map<string, boolean> | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

function isCacheValid(): boolean {
  return cache !== null && Date.now() < cacheExpiry;
}

async function loadFlags(): Promise<Map<string, boolean>> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT key, enabled FROM scheduling_feature_flags`
  );
  const m = new Map<string, boolean>();
  for (const row of r.rows) {
    m.set(row.key, row.enabled === true);
  }
  return m;
}

/**
 * Get a feature flag value. Cached for 1 minute.
 */
export async function getSchedulingFeatureFlag(key: SchedulingFeatureFlagKey): Promise<boolean> {
  if (!isCacheValid()) {
    cache = await loadFlags();
    cacheExpiry = Date.now() + CACHE_TTL_MS;
  }
  return cache!.get(key) ?? false;
}

/**
 * Get all feature flags. Cached for 1 minute.
 */
export async function getAllSchedulingFeatureFlags(): Promise<Record<string, boolean>> {
  if (!isCacheValid()) {
    cache = await loadFlags();
    cacheExpiry = Date.now() + CACHE_TTL_MS;
  }
  return Object.fromEntries(cache!);
}

/**
 * Invalidate cache (call after updating flags).
 */
export function invalidateSchedulingFeatureFlagsCache(): void {
  cache = null;
}
