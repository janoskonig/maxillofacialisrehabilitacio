import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import type { StageCatalogEntry, ReasonType } from '@/lib/types';

const REASON_VALUES: ReasonType[] = ['traumás sérülés', 'veleszületett rendellenesség', 'onkológiai kezelés utáni állapot'];

/**
 * Get stage catalog, optionally filtered by reason
 * GET /api/stage-catalog?reason=onkológiai kezelés utáni állapot
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    const pool = getDbPool();
    const reason = request.nextUrl.searchParams.get('reason') as ReasonType | null;

    const tableExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stage_catalog'`
    );
    if (tableExists.rows.length === 0) {
      return NextResponse.json({ catalog: [] });
    }

    let query = `
      SELECT code, reason, label_hu as "labelHu", order_index as "orderIndex", is_terminal as "isTerminal", default_duration_days as "defaultDurationDays"
      FROM stage_catalog
    `;
    const params: string[] = [];
    if (reason && REASON_VALUES.includes(reason)) {
      query += ` WHERE reason = $1`;
      params.push(reason);
    }
    query += ` ORDER BY order_index ASC`;

    const result = await pool.query(query, params);
    const catalog: StageCatalogEntry[] = result.rows.map((row) => ({
      code: row.code,
      reason: row.reason,
      labelHu: row.labelHu,
      orderIndex: row.orderIndex,
      isTerminal: row.isTerminal,
      defaultDurationDays: row.defaultDurationDays ?? null,
    }));

    return NextResponse.json({ catalog });
  } catch (error) {
    console.error('Error fetching stage catalog:', error);
    return NextResponse.json(
      { error: 'Hiba történt a katalógus lekérdezésekor' },
      { status: 500 }
    );
  }
}
