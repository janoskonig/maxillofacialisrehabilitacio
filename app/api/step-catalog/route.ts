import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/step-catalog — list step catalog ORDER BY step_code
 * Auth: admin + fogpótlástanász
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultság' }, { status: 403 });
    }

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
  } catch (error) {
    logger.error('Error fetching step catalog:', error);
    return NextResponse.json(
      { error: 'Hiba történt a lépés katalógus lekérdezésekor' },
      { status: 500 }
    );
  }
}
