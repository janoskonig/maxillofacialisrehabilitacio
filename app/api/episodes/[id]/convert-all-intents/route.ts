import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { convertIntentToAppointment } from '@/lib/convert-slot-intent';

/**
 * POST /api/episodes/:id/convert-all-intents
 * Convert all open slot_intents for the episode to appointments (batch).
 * Does not run one-hard-next check so multiple future work appointments can be created.
 * Response: { converted, appointmentIds, skipped: Array<{ intentId, reason }> }
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const intentsResult = await pool.query(
    `SELECT si.id
     FROM slot_intents si
     WHERE si.episode_id = $1 AND si.state = 'open'
     ORDER BY si.step_seq ASC`,
    [episodeId]
  );

  const intents = intentsResult.rows as Array<{ id: string }>;
  if (intents.length === 0) {
    return NextResponse.json(
      { converted: 0, appointmentIds: [], skipped: [] },
      { status: 200 }
    );
  }

  const appointmentIds: string[] = [];
  const skipped: Array<{ intentId: string; reason: string }> = [];

  for (const row of intents) {
    const result = await convertIntentToAppointment(pool, row.id, auth, {
      skipOneHardNext: true,
    });

    if (result.ok) {
      appointmentIds.push(result.appointmentId);
    } else {
      skipped.push({ intentId: row.id, reason: result.error });
    }
  }

  return NextResponse.json({
    converted: appointmentIds.length,
    appointmentIds,
    skipped,
  });
});
