import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { emitSchedulingEvent } from '@/lib/scheduling-events';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/episodes/:id/steps/reorder
 * Reorder episode steps by providing the step IDs in the desired order.
 * Updates the `seq` column for each step.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }

    const allowedRoles = ['admin', 'sebészorvos', 'fogpótlástanász'];
    if (!allowedRoles.includes(auth.role ?? '')) {
      return NextResponse.json({ error: 'Nincs jogosultsága' }, { status: 403 });
    }

    const episodeId = params.id;
    const body = await request.json();
    const { stepIds } = body;

    if (!Array.isArray(stepIds) || stepIds.length === 0) {
      return NextResponse.json({ error: 'stepIds tömb kötelező' }, { status: 400 });
    }

    const pool = getDbPool();

    // Verify all stepIds belong to this episode
    const verification = await pool.query(
      `SELECT id FROM episode_steps WHERE episode_id = $1`,
      [episodeId]
    );
    const existingIds = new Set(verification.rows.map((r: { id: string }) => r.id));
    const invalidIds = stepIds.filter((id: string) => !existingIds.has(id));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: `Ismeretlen step ID-k: ${invalidIds.join(', ')}` },
        { status: 400 }
      );
    }

    // Tolerate count mismatch (concurrent add/delete) — just warn, don't reject.
    // Any steps not in stepIds keep their current seq (will be appended after reordered ones).
    const missingIds = Array.from(existingIds).filter((id) => !stepIds.includes(id));
    if (missingIds.length > 0) {
      console.warn(`[reorder] ${missingIds.length} step(s) not in stepIds — they will be appended after reordered steps`);
    }

    // Build batch update
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (let i = 0; i < stepIds.length; i++) {
        await client.query(
          `UPDATE episode_steps SET seq = $1 WHERE id = $2 AND episode_id = $3`,
          [i, stepIds[i], episodeId]
        );
      }

      // Append steps not in stepIds after the reordered ones
      if (missingIds.length > 0) {
        let nextSeq = stepIds.length;
        for (const missingId of missingIds) {
          await client.query(
            `UPDATE episode_steps SET seq = $1 WHERE id = $2 AND episode_id = $3`,
            [nextSeq, missingId, episodeId]
          );
          nextSeq++;
        }
      }

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    // Refresh scheduling cache
    try {
      await emitSchedulingEvent('episode', episodeId, 'steps_reordered');
    } catch { /* non-blocking */ }

    const allSteps = await pool.query(
      `SELECT id, episode_id as "episodeId", step_code as "stepCode",
              pathway_order_index as "pathwayOrderIndex", pool,
              duration_minutes as "durationMinutes",
              default_days_offset as "defaultDaysOffset",
              status, appointment_id as "appointmentId",
              created_at as "createdAt", completed_at as "completedAt",
              source_episode_pathway_id as "sourceEpisodePathwayId", seq,
              custom_label as "customLabel"
       FROM episode_steps WHERE episode_id = $1 ORDER BY COALESCE(seq, pathway_order_index)`,
      [episodeId]
    );

    return NextResponse.json({ steps: allSteps.rows });
  } catch (error) {
    console.error('Error in PATCH /episodes/:id/steps/reorder:', error);
    return NextResponse.json(
      { error: 'Hiba történt a lépések átrendezésekor' },
      { status: 500 }
    );
  }
}
