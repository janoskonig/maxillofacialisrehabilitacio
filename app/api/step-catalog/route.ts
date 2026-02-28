import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const dynamic = 'force-dynamic';

export const GET = roleHandler(['admin', 'fogpótlástanász'], async (req, { auth }) => {
  const pool = getDbPool();

  const tableExists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'step_catalog'`
  );
  if (tableExists.rows.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const result = await pool.query(
    `SELECT step_code as "stepCode", label_hu as "labelHu", label_en as "labelEn",
            is_active as "isActive", updated_at as "updatedAt"
     FROM step_catalog
     ORDER BY step_code`
  );

  const items = result.rows.map((row) => ({
    stepCode: row.stepCode,
    labelHu: row.labelHu,
    labelEn: row.labelEn ?? null,
    isActive: row.isActive ?? true,
    updatedAt: row.updatedAt,
  }));

  return NextResponse.json({ items });
});
