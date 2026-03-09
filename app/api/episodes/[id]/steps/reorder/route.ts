import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { logger } from '@/lib/logger';
import { getFullStepQuery } from '@/lib/episode-step-select';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/episodes/:id/steps/reorder
 * Reorder episode steps by providing the step IDs in the desired order.
 *
 * After reordering, implements "appointment stays, step shifts":
 * if a future appointment was booked for a step that is no longer the next
 * pending step in the new order, the appointment is reassigned to the
 * new first pending step (same pool).
 */
export const PATCH = roleHandler(['admin', 'sebészorvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json();
  const { stepIds } = body;

  if (!Array.isArray(stepIds) || stepIds.length === 0) {
    return NextResponse.json({ error: 'stepIds tömb kötelező' }, { status: 400 });
  }

  const pool = getDbPool();

  // Fetch all steps; separate primary (not merged) from merged-into
  const verification = await pool.query(
    `SELECT id, merged_into_episode_step_id FROM episode_steps WHERE episode_id = $1`,
    [episodeId]
  );
  const allRows: Array<{ id: string; merged_into_episode_step_id: string | null }> = verification.rows;
  const existingIds = new Set(allRows.map((r) => r.id));
  const mergedIds = new Set(allRows.filter((r) => r.merged_into_episode_step_id).map((r) => r.id));

  // stepIds should contain only primary (non-merged) steps
  const invalidIds = stepIds.filter((id: string) => !existingIds.has(id));
  if (invalidIds.length > 0) {
    return NextResponse.json(
      { error: `Ismeretlen step ID-k: ${invalidIds.join(', ')}` },
      { status: 400 }
    );
  }

  const primaryIds = new Set(allRows.filter((r) => !r.merged_into_episode_step_id).map((r) => r.id));
  const missingPrimaryIds = Array.from(primaryIds).filter((id) => !stepIds.includes(id));
  if (missingPrimaryIds.length > 0) {
    console.warn(`[reorder] ${missingPrimaryIds.length} primary step(s) not in stepIds — appending`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update seq for primary steps
    for (let i = 0; i < stepIds.length; i++) {
      await client.query(
        `UPDATE episode_steps SET seq = $1 WHERE id = $2 AND episode_id = $3`,
        [i, stepIds[i], episodeId]
      );
    }

    // Append missing primary steps
    if (missingPrimaryIds.length > 0) {
      let nextSeq = stepIds.length;
      for (const missingId of missingPrimaryIds) {
        await client.query(
          `UPDATE episode_steps SET seq = $1 WHERE id = $2 AND episode_id = $3`,
          [nextSeq, missingId, episodeId]
        );
        nextSeq++;
      }
    }

    // Merged steps inherit their primary's seq
    if (mergedIds.size > 0) {
      await client.query(
        `UPDATE episode_steps child SET seq = parent.seq
         FROM episode_steps parent
         WHERE child.merged_into_episode_step_id = parent.id
           AND child.episode_id = $1`,
        [episodeId]
      );
    }

    // 2. Appointment-stays-step-shifts: reassign future appointments if the
    //    step order changed such that the "next pending" step is different
    //    from what the appointment was booked for.
    try {
      await shiftAppointmentsAfterReorder(client, episodeId);
    } catch (shiftErr) {
      logger.error('[reorder] appointment shift failed (non-fatal):', shiftErr);
    }

    await client.query('COMMIT');
  } catch (txError) {
    await client.query('ROLLBACK');
    throw txError;
  } finally {
    client.release();
  }

  try {
    await emitSchedulingEvent('episode', episodeId, 'steps_reordered');
  } catch { /* non-blocking */ }

  const allSteps = await getFullStepQuery(pool, episodeId);

  return NextResponse.json({ steps: allSteps.rows });
});

// ────────────────────────────────────────────────────────────────────────────
// Appointment-stays-step-shifts logic
// ────────────────────────────────────────────────────────────────────────────

async function shiftAppointmentsAfterReorder(
  client: PoolClient,
  episodeId: string
) {
  // Find future active appointments for this episode
  const apptResult = await client.query(
    `SELECT a.id, a.step_code as "stepCode", a.step_seq as "stepSeq",
            a.slot_intent_id as "slotIntentId", a.pool
     FROM appointments a
     WHERE a.episode_id = $1
       AND a.is_future = true
       AND a.is_active_status = true
     ORDER BY a.start_time ASC`,
    [episodeId]
  );

  if (apptResult.rows.length === 0) return;

  // Get all steps in new order
  const stepsResult = await client.query(
    `SELECT id, step_code as "stepCode", pathway_order_index as "pathwayOrderIndex",
            seq, status, pool
     FROM episode_steps
     WHERE episode_id = $1
     ORDER BY COALESCE(seq, pathway_order_index) ASC`,
    [episodeId]
  );
  const steps: Array<{
    id: string; stepCode: string; pathwayOrderIndex: number;
    seq: number | null; status: string; pool: string;
  }> = stepsResult.rows;

  // For each future appointment, check if it needs reassignment.
  // Group by pool since different pools are independent (work, consult, control).
  for (const appt of apptResult.rows) {
    const newNextStep = steps.find(
      (s) => (s.status === 'pending' || s.status === 'scheduled') && s.pool === appt.pool
    );

    if (!newNextStep) continue;

    // If the appointment's step_code already matches the first pending step, no change needed
    if (appt.stepCode === newNextStep.stepCode && appt.stepSeq === newNextStep.pathwayOrderIndex) {
      continue;
    }

    // The next pending step changed — reassign the appointment
    logger.info(
      `[reorder] Shifting appointment ${appt.id}: ${appt.stepCode}(seq=${appt.stepSeq}) → ${newNextStep.stepCode}(idx=${newNextStep.pathwayOrderIndex})`
    );

    // Update appointment to point to the new step
    await client.query(
      `UPDATE appointments SET step_code = $1, step_seq = $2 WHERE id = $3`,
      [newNextStep.stepCode, newNextStep.pathwayOrderIndex, appt.id]
    );

    // Clear appointment_id from old step (whichever step previously held this appointment)
    await client.query(
      `UPDATE episode_steps SET appointment_id = NULL
       WHERE episode_id = $1 AND appointment_id = $2`,
      [episodeId, appt.id]
    );

    // Set appointment_id on the new target step and mark it as scheduled
    await client.query(
      `UPDATE episode_steps SET appointment_id = $1, status = 'scheduled'
       WHERE id = $2`,
      [appt.id, newNextStep.id]
    );

    // Revert the old step (the one that lost the appointment) back to pending
    // — find it by matching the original step_code/step_seq
    const oldStep = steps.find(
      (s) => s.stepCode === appt.stepCode && s.pathwayOrderIndex === appt.stepSeq && s.id !== newNextStep.id
    );
    if (oldStep && oldStep.status === 'scheduled') {
      await client.query(
        `UPDATE episode_steps SET status = 'pending', appointment_id = NULL WHERE id = $1`,
        [oldStep.id]
      );
    }

    // Update linked slot_intent if present
    if (appt.slotIntentId) {
      await client.query(
        `UPDATE slot_intents SET step_code = $1, step_seq = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND state = 'converted'`,
        [newNextStep.stepCode, newNextStep.pathwayOrderIndex, appt.slotIntentId]
      );
    }
  }
}
