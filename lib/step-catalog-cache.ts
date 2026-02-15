/**
 * Step catalog cache: unmapped step codes (care_pathways.steps_json - step_catalog)
 * Invalidate on care_pathways PATCH/POST.
 */

import { getDbPool } from './db';

const UNMAPPED_CACHE_TTL_MS = 5 * 60 * 1000; // 5 perc

let unmappedCache: { items: string[]; expiresAt: number } | null = null;

/**
 * Invalidate unmapped cache. Call after care_pathways PATCH/POST.
 */
export function invalidateUnmappedCache(): void {
  unmappedCache = null;
}

/**
 * Get step_code-ok from care_pathways.steps_json that are not in step_catalog.
 * Cached with TTL.
 */
export async function getUnmappedStepCodes(): Promise<string[]> {
  const now = Date.now();
  if (unmappedCache && unmappedCache.expiresAt > now) {
    return unmappedCache.items;
  }

  const pool = getDbPool();

  const stepCatalogExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'step_catalog'`
  );
  if (stepCatalogExists.rows.length === 0) {
    return [];
  }

  const result = await pool.query(`
    WITH pathway_steps AS (
      SELECT DISTINCT elem->>'step_code' AS step_code
      FROM care_pathways,
           jsonb_array_elements(steps_json) AS elem
      WHERE elem->>'step_code' IS NOT NULL AND elem->>'step_code' != ''
    ),
    catalog_steps AS (
      SELECT step_code FROM step_catalog WHERE is_active = true
    )
    SELECT ps.step_code
    FROM pathway_steps ps
    EXCEPT
    SELECT cs.step_code FROM catalog_steps cs
    ORDER BY step_code
  `);

  const items = result.rows.map((r) => r.step_code as string);
  unmappedCache = { items, expiresAt: now + UNMAPPED_CACHE_TTL_MS };
  return items;
}
