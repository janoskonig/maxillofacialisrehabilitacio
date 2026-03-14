import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { convertIntentToAppointment } from '@/lib/convert-slot-intent';
import { projectRemainingSteps } from '@/lib/slot-intent-projector';

/**
 * POST /api/episodes/:id/convert-all-intents
 * Convert all open slot_intents for the episode to appointments (batch).
 * If no open intents exist, runs slot-intent projection first so pending pathway steps get intents.
 * Does not run one-hard-next check so multiple future work appointments can be created.
 * Response: { converted, appointmentIds, skipped: Array<{ intentId, reason }> }
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  // Always run the projector so expired/stale intents are re-opened and new steps get intents.
  // The projector is idempotent (UPSERT) and skips converted/cancelled intents.
  await projectRemainingSteps(episodeId);

  const intentsResult = await pool.query(
    `SELECT si.id, si.step_code
     FROM slot_intents si
     WHERE si.episode_id = $1 AND si.state = 'open'
     ORDER BY si.step_seq ASC`,
    [episodeId]
  );

  const intents = intentsResult.rows as Array<{ id: string; step_code?: string }>;

  if (intents.length === 0) {
    return NextResponse.json(
      { converted: 0, appointmentIds: [], skipped: [] },
      { status: 200 }
    );
  }

  const appointmentIds: string[] = [];
  const skipped: Array<{ intentId: string; reason: string; code?: string; stepCode?: string }> = [];

  for (const row of intents) {
    const result = await convertIntentToAppointment(pool, row.id, auth, {
      skipOneHardNext: true,
    });

    if (result.ok) {
      appointmentIds.push(result.appointmentId);
    } else {
      skipped.push({
        intentId: row.id,
        reason: result.error,
        code: result.code,
        stepCode: row.step_code,
      });
    }
  }

  return NextResponse.json({
    converted: appointmentIds.length,
    appointmentIds,
    skipped,
  });
});
