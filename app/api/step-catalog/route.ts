import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { getCached, setCache, CATALOG_TTL } from '@/lib/catalog-cache';

export const dynamic = 'force-dynamic';

/** In-memory cache key; rows come from work_phase_catalog (API path kept as /api/step-catalog). */
const CACHE_KEY = 'work-phase-catalog';

export const GET = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const cached = getCached<any[]>(CACHE_KEY);
  if (cached) return NextResponse.json({ items: cached });

  const pool = getDbPool();

  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_phase_catalog'`
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const result = await pool.query(
    `SELECT work_phase_code as "stepCode", label_hu as "labelHu", label_en as "labelEn",
            is_active as "isActive", updated_at as "updatedAt"
     FROM work_phase_catalog
     ORDER BY work_phase_code`
  );

  const items = result.rows.map((row) => ({
    stepCode: row.stepCode,
    labelHu: row.labelHu,
    labelEn: row.labelEn ?? null,
    isActive: row.isActive ?? true,
    updatedAt: row.updatedAt,
  }));

  setCache(CACHE_KEY, items, CATALOG_TTL);
  return NextResponse.json({ items });
});
