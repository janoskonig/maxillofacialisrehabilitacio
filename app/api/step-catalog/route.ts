import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { getCached, setCache, CATALOG_TTL } from '@/lib/catalog-cache';
import { probeColumnExists } from '@/lib/schema-probe';

export const dynamic = 'force-dynamic';

/**
 * In-memory cache key; rows come from work_phase_catalog (API path kept as
 * /api/step-catalog). A v2 a paletta-mezőket (091) is hordozza.
 */
const CACHE_KEY = 'work-phase-catalog:v2';

export interface StepCatalogApiItem {
  stepCode: string;
  labelHu: string;
  labelEn: string | null;
  isActive: boolean;
  updatedAt: string | Date | null;
  /** 091: a kezelési terv bal hasábjának sorrendje; null = csak keresésből érhető el. */
  paletteOrder: number | null;
  /** 091: alapértelmezett időtartam a palettáról hozzáadáskor. */
  defaultDurationMinutes: number | null;
  /** 091: alapértelmezett slot-pool a palettáról hozzáadáskor. */
  defaultPool: 'consult' | 'work' | 'control' | null;
}

export const GET = roleHandler(['admin', 'fogpótlástanász'], async () => {
  const cached = getCached<StepCatalogApiItem[]>(CACHE_KEY);
  if (cached) return NextResponse.json({ items: cached });

  const pool = getDbPool();

  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_phase_catalog'`
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ items: [] });
  }

  // A 091 előtti sémán a paletta-oszlopok hiányoznak — a probe modulszinten
  // cache-elt (lib/schema-probe.ts), nem kerül request-enként DB-be.
  const hasPalette = await probeColumnExists(pool, 'work_phase_catalog', 'palette_order');
  const paletteCols = hasPalette
    ? `, palette_order as "paletteOrder", default_duration_minutes as "defaultDurationMinutes", default_pool as "defaultPool"`
    : '';

  const result = await pool.query(
    `SELECT work_phase_code as "stepCode", label_hu as "labelHu", label_en as "labelEn",
            is_active as "isActive", updated_at as "updatedAt"${paletteCols}
     FROM work_phase_catalog
     ORDER BY work_phase_code`
  );

  const items: StepCatalogApiItem[] = result.rows.map((row) => ({
    stepCode: row.stepCode,
    labelHu: row.labelHu,
    labelEn: row.labelEn ?? null,
    isActive: row.isActive ?? true,
    updatedAt: row.updatedAt,
    paletteOrder: row.paletteOrder != null ? Number(row.paletteOrder) : null,
    defaultDurationMinutes:
      row.defaultDurationMinutes != null ? Number(row.defaultDurationMinutes) : null,
    defaultPool:
      row.defaultPool === 'consult' || row.defaultPool === 'work' || row.defaultPool === 'control'
        ? row.defaultPool
        : null,
  }));

  setCache(CACHE_KEY, items, CATALOG_TTL);
  return NextResponse.json({ items });
});
