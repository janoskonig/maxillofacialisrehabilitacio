import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { computeIntentPriority, STARVATION_DAYS } from '@/lib/intent-priority';

export const POST = roleHandler(['admin'], async (req, { auth }) => {
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
});
