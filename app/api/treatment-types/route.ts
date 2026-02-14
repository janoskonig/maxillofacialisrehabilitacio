import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';

/**
 * GET /api/treatment-types — lookup for care pathway treatment types (dropdown, reports)
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

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

    return NextResponse.json({ treatmentTypes: r.rows });
  } catch (error) {
    console.error('Error fetching treatment types:', error);
    return NextResponse.json(
      { error: 'Hiba történt a kezelési típusok lekérdezésekor' },
      { status: 500 }
    );
  }
}
