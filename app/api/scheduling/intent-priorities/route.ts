import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { computeIntentPriority, STARVATION_DAYS } from '@/lib/intent-priority';
import { logger } from '@/lib/logger';

/**
 * POST /api/scheduling/intent-priorities
 * Run intent priority update (ageing + starvation guard).
 * Updates slot_intents.priority for open intents.
 * Call from cron (e.g. daily).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Csak admin futtathatja' }, { status: 403 });
    }

    const pool = getDbPool();
    const now = new Date();

    const intents = await pool.query(
      `SELECT id, created_at, window_end, priority FROM slot_intents WHERE state = 'open'`
    );

    let updated = 0;
    let starvationCount = 0;

    for (const row of intents.rows) {
      const { priority, isStarvation } = computeIntentPriority(
        {
          created_at: row.created_at,
          window_end: row.window_end,
          priority: row.priority,
        },
        now
      );

      if (isStarvation) starvationCount++;

      await pool.query(
        `UPDATE slot_intents SET priority = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [priority, row.id]
      );
      updated++;
    }

    return NextResponse.json({
      updated,
      starvationCount,
      starvationThresholdDays: STARVATION_DAYS,
      message: starvationCount > 0
        ? `${starvationCount} intent(s) open > ${STARVATION_DAYS} days, escalated to admin review`
        : undefined,
    });
  } catch (error) {
    logger.error('Error updating intent priorities:', error);
    return NextResponse.json(
      { error: 'Hiba történt a prioritások frissítésekor' },
      { status: 500 }
    );
  }
}
