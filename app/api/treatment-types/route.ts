import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler, authedHandler } from '@/lib/api/route-handler';
import { treatmentTypeCreateSchema } from '@/lib/admin-process-schemas';
import { logger } from '@/lib/logger';
import { getCached, setCache, invalidateCache, CATALOG_TTL } from '@/lib/catalog-cache';

export const dynamic = 'force-dynamic';

export const POST = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const body = await req.json();
  const auditReason =
    body.auditReason ?? req.nextUrl.searchParams.get('auditReason');
  const parsed = treatmentTypeCreateSchema.safeParse({ ...body, auditReason });
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e: { message: string }) => e.message).join('; ');
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const data = parsed.data;

  const pool = getDbPool();
  try {
    await pool.query('BEGIN');
    const r = await pool.query(
      `INSERT INTO treatment_types (code, label_hu)
       VALUES ($1, $2)
       RETURNING id, code, label_hu as "labelHu"`,
      [data.code, data.labelHu]
    );
    const row = r.rows[0];
    await pool.query(
      `INSERT INTO care_pathways (name, reason, treatment_type_id, steps_json, version, priority)
       VALUES ($1, NULL, $2, '[]'::jsonb, 1, 0)`,
      [row.labelHu, row.id]
    );
    await pool.query('COMMIT');
    console.info('[admin] treatment_type created', {
      id: row.id,
      code: row.code,
      by: auth.email ?? auth.userId,
      auditReason: data.auditReason,
    });

    invalidateCache('treatment-types');
    return NextResponse.json({ treatmentType: row });
  } catch (err: unknown) {
    await pool.query('ROLLBACK').catch(() => {});
    const msg = String(err ?? '');
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json(
        { error: 'A code már létezik.', code: 'CODE_EXISTS' },
        { status: 409 }
      );
    }
    throw err;
  }
});

const TT_CACHE_KEY = 'treatment-types';

export const GET = authedHandler(async (req, { auth }) => {
  const cached = getCached<any[]>(TT_CACHE_KEY);
  if (cached) return NextResponse.json({ treatmentTypes: cached });

  const pool = getDbPool();

  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'treatment_types'`
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ treatmentTypes: [] });
  }

  const r = await pool.query(
    `SELECT id, code, label_hu as "labelHu" FROM treatment_types ORDER BY label_hu ASC`
  );

  setCache(TT_CACHE_KEY, r.rows, CATALOG_TTL);
  return NextResponse.json({ treatmentTypes: r.rows });
});
