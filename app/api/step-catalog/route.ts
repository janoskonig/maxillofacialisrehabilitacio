import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { getCached, setCache, CATALOG_TTL, invalidateCachePrefix } from '@/lib/catalog-cache';
import { probeColumnExists } from '@/lib/schema-probe';
import { stepCatalogCreateSchema, slugifyLabel, canonicalizeStepCode } from '@/lib/admin-process-schemas';
import { invalidateStepLabelCache } from '@/lib/step-labels';
import { invalidateUnmappedCache } from '@/lib/step-catalog-cache';

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

/**
 * POST /api/step-catalog — új generikus (sablon-független) fázis a felületről:
 * „mentés a palettára". Body: { labelHu, labelEn?, addToPalette?, defaultDurationMinutes?, defaultPool? }
 *
 * A kód a címkéből képzett `gen_<slug>`; ütközésnél `_2`, `_3`… A paletta-
 * sorrend a lista végére (max+10). A legacy step_catalog tükröt is írja.
 * Auth: admin + fogpótlástanász (mint a PATCH).
 */
export const POST = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = stepCatalogCreateSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const data = parsed.data;
  const pool = getDbPool();

  const hasPalette = await probeColumnExists(pool, 'work_phase_catalog', 'palette_order');
  if (!hasPalette) {
    return NextResponse.json(
      { error: 'A palettához a 091-es migráció szükséges (npm run migrate)', code: 'MIGRATION_PENDING' },
      { status: 503 }
    );
  }

  const base = canonicalizeStepCode(`gen_${slugifyLabel(data.labelHu)}`).replace(/_+/g, '_').replace(/_$/, '');
  if (!base || base === 'gen') {
    return NextResponse.json({ error: 'A címkéből nem képezhető kód' }, { status: 400 });
  }
  let code = base;
  for (let n = 2; n < 50; n++) {
    const exists = await pool.query(`SELECT 1 FROM work_phase_catalog WHERE work_phase_code = $1`, [code]);
    if (exists.rows.length === 0) break;
    code = `${base}_${n}`;
  }

  const orderRow = await pool.query(
    `SELECT COALESCE(MAX(palette_order), 0) + 10 AS next_order FROM work_phase_catalog`
  );
  const paletteOrder = data.addToPalette ? Number(orderRow.rows[0].next_order) : null;

  const inserted = await pool.query(
    `INSERT INTO work_phase_catalog
       (work_phase_code, label_hu, label_en, is_active, updated_at, updated_by,
        palette_order, default_duration_minutes, default_pool)
     VALUES ($1, $2, $3, true, now(), $4, $5, $6, $7)
     RETURNING work_phase_code as "stepCode", label_hu as "labelHu", label_en as "labelEn",
               is_active as "isActive", updated_at as "updatedAt",
               palette_order as "paletteOrder", default_duration_minutes as "defaultDurationMinutes",
               default_pool as "defaultPool"`,
    [
      code,
      data.labelHu.trim(),
      data.labelEn ?? null,
      auth.userId ?? null,
      paletteOrder,
      data.defaultDurationMinutes,
      data.defaultPool,
    ]
  );
  // Legacy tükör (a PATCH is szinkronizál ide).
  await pool.query(
    `INSERT INTO step_catalog (step_code, label_hu, label_en, is_active, updated_at, updated_by)
     VALUES ($1, $2, $3, true, now(), $4)
     ON CONFLICT (step_code) DO NOTHING`,
    [code, data.labelHu.trim(), data.labelEn ?? null, auth.userId ?? null]
  ).catch(() => {
    /* legacy tábla hiányozhat — nem kritikus */
  });

  invalidateCachePrefix('work-phase-catalog');
  invalidateStepLabelCache();
  invalidateUnmappedCache();

  return NextResponse.json({ item: inserted.rows[0] }, { status: 201 });
});
