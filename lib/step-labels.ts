/**
 * Step labels: step_code → megjelenítési címke (step_catalog)
 * Cache TTL, invalidation step_catalog + care_pathways PATCH/POST után.
 */

import { getDbPool } from './db';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 perc

let cache: { map: Map<string, string>; expiresAt: number } | null = null;

/**
 * Invalidate step label cache. Call after step_catalog PATCH or care_pathways PATCH/POST.
 */
export function invalidateStepLabelCache(): void {
  cache = null;
}

/**
 * Fetch step_code → label_hu map from step_catalog. Cached with TTL.
 */
export async function getStepLabelMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.map;
  }

  const pool = getDbPool();
  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'step_catalog'`
  );
  if (tableExists.rows.length === 0) {
    cache = { map: new Map(), expiresAt: now + CACHE_TTL_MS };
    return cache.map;
  }

  const result = await pool.query(
    `SELECT step_code, label_hu FROM step_catalog WHERE is_active = true ORDER BY step_code`
  );

  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.step_code as string, row.label_hu as string);
  }

  cache = { map, expiresAt: now + CACHE_TTL_MS };
  return map;
}

/**
 * Get label for step_code. Fallback: stepCode if not in catalog.
 */
export async function getStepLabel(stepCode: string): Promise<string> {
  const map = await getStepLabelMap();
  return map.get(stepCode) ?? stepCode;
}
