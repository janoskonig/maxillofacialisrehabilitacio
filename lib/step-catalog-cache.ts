/**
 * Unmapped work-phase codes: pathway JSON vs work_phase_catalog (legacy step_catalog kept in DB).
 */

import { getDbPool } from './db';
import { tableExists } from './catalog-coverage';

const UNMAPPED_CACHE_TTL_MS = 5 * 60 * 1000; // 5 perc

let unmappedCache: { items: string[]; expiresAt: number } | null = null;

/**
 * Invalidate unmapped cache. Call after care_pathways PATCH/POST.
 */
export function invalidateUnmappedCache(): void {
  unmappedCache = null;
}

/**
 * Codes referenced in pathway JSON but missing from work_phase_catalog.
 * Cached with TTL.
 */
export async function getUnmappedStepCodes(): Promise<string[]> {
  const now = Date.now();
  if (unmappedCache && unmappedCache.expiresAt > now) {
    return unmappedCache.items;
  }

  const pool = getDbPool();

  // A táblalét-guard a közös lib/catalog-coverage.ts-ből — ugyanaz a védelem, mint
  // a fog-katalógus oldalán. (Az ellenőrzés iránya viszont más: itt a pathway
  // JSON-ban használt kódokat vetjük össze a katalógussal, nem fordítva.)
  if (!(await tableExists(pool, 'work_phase_catalog'))) {
    return [];
  }

  const result = await pool.query(`
    WITH pathway_elems AS (
      SELECT jsonb_array_elements(
        CASE
          WHEN work_phases_json IS NOT NULL AND jsonb_array_length(work_phases_json) > 0
          THEN work_phases_json
          ELSE steps_json
        END
      ) AS elem
      FROM care_pathways
    ),
    pathway_steps AS (
      SELECT DISTINCT COALESCE(elem->>'work_phase_code', elem->>'step_code') AS step_code
      FROM pathway_elems
      WHERE COALESCE(elem->>'work_phase_code', elem->>'step_code') IS NOT NULL
        AND COALESCE(elem->>'work_phase_code', elem->>'step_code') != ''
    ),
    catalog_steps AS (
      SELECT work_phase_code AS step_code FROM work_phase_catalog WHERE is_active = true
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
