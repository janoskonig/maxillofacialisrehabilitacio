import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { logger } from '@/lib/logger';
import { getFullWorkPhaseQuery } from '@/lib/episode-work-phase-select';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/episodes/:id/work-phases/reorder
 * Reorder episode steps by providing the step IDs in the desired order.
 *
 * After reordering, implements "appointment stays, step shifts":
 * if a future appointment was booked for a step that is no longer the next
 * pending step in the new order, the appointment is reassigned to the
 * new first pending step (same pool).
 */
export const PATCH = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json();
  const { stepIds } = body;

  if (!Array.isArray(stepIds) || stepIds.length === 0) {
    return NextResponse.json({ error: 'stepIds tömb kötelező' }, { status: 400 });
  }

  const pool = getDbPool();

  let shiftFailed = false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Epizód-státusz kapu a tranzakción BELÜL, sor-zárral (TOCTOU-védelem):
    // korábban a kapu a tranzakción kívül, zárolás nélkül olvasott, így ha a
    // kapu-ellenőrzés és a COMMIT között egy párhuzamos kérés lezárta az
    // epizódot, az átrendezés mégis commitolódott a már lezárt epizódon.
    // A FOR SHARE ütközik a lezáró UPDATE-tel (az megvárja a COMMIT-unkat),
    // olvasókkal viszont nem; FOR UPDATE szándékosan nincs, hogy a
    // deadlock-felület kicsi maradjon.
    const episodeRes = await client.query(
      `SELECT status FROM patient_episodes WHERE id = $1 FOR SHARE`,
      [episodeId]
    );
    if (episodeRes.rows.length === 0) {
      throw new HttpError(404, 'Az epizód nem található', 'EPISODE_NOT_FOUND');
    }
    const episodeStatus: string = episodeRes.rows[0].status;
    if (episodeStatus !== 'open') {
      throw new HttpError(
        409,
        episodeStatus === 'closed'
          ? 'Ez az epizód le van zárva, ezért az átrendezést nem mentettük el. Az epizód újranyitása után a terv ismét szerkeszthető.'
          : 'Ez az epizód jelenleg szünetel, ezért az átrendezést nem mentettük el. Az epizód folytatása után a terv ismét szerkeszthető.',
        'EPISODE_NOT_OPEN'
      );
    }

    // Fetch all steps; separate primary (not merged) from merged-into.
    // A tranzakción belül olvasunk, hogy a seq-átírás ugyanarra az állapotra
    // épüljön, amit itt validálunk.
    const verification = await client.query(
      `SELECT id, merged_into_episode_work_phase_id FROM episode_work_phases WHERE episode_id = $1`,
      [episodeId]
    );
    const allRows: Array<{ id: string; merged_into_episode_work_phase_id: string | null }> = verification.rows;
    const existingIds = new Set(allRows.map((r) => r.id));
    const mergedIds = new Set(allRows.filter((r) => r.merged_into_episode_work_phase_id).map((r) => r.id));

    // stepIds should contain only primary (non-merged) steps
    const invalidIds = stepIds.filter((id: string) => !existingIds.has(id));
    if (invalidIds.length > 0) {
      throw new HttpError(400, `Ismeretlen step ID-k: ${invalidIds.join(', ')}`, 'UNKNOWN_STEP_IDS');
    }

    const primaryIds = new Set(allRows.filter((r) => !r.merged_into_episode_work_phase_id).map((r) => r.id));
    const missingPrimaryIds = Array.from(primaryIds).filter((id) => !stepIds.includes(id));
    if (missingPrimaryIds.length > 0) {
      console.warn(`[reorder] ${missingPrimaryIds.length} primary step(s) not in stepIds — appending`);
    }

    // 1. Update seq for primary steps
    for (let i = 0; i < stepIds.length; i++) {
      await client.query(
        `UPDATE episode_work_phases SET seq = $1 WHERE id = $2 AND episode_id = $3`,
        [i, stepIds[i], episodeId]
      );
    }

    // Append missing primary steps
    if (missingPrimaryIds.length > 0) {
      let nextSeq = stepIds.length;
      for (const missingId of missingPrimaryIds) {
        await client.query(
          `UPDATE episode_work_phases SET seq = $1 WHERE id = $2 AND episode_id = $3`,
          [nextSeq, missingId, episodeId]
        );
        nextSeq++;
      }
    }

    // Merged steps inherit their primary's seq
    if (mergedIds.size > 0) {
      await client.query(
        `UPDATE episode_work_phases child SET seq = parent.seq
         FROM episode_work_phases parent
         WHERE child.merged_into_episode_work_phase_id = parent.id
           AND child.episode_id = $1`,
        [episodeId]
      );
    }

    // 2. Appointment-stays-step-shifts: reassign future appointments if the
    //    step order changed such that the "next pending" step is different
    //    from what the appointment was booked for.
    //
    //    SAVEPOINT-tal védve: e nélkül egy hibás statement (pl. unique-ütközés)
    //    az EGÉSZ tranzakciót abortálná — a COMMIT ilyenkor nem dob, hanem
    //    ROLLBACK command taggel tér vissza, a seq-átírások is elvesznének,
    //    és a válasz a rendezés ELŐTTI sorokkal adna néma 200-at.
    //    Minta: withSavepoint, lib/slot-intent-projector.ts.
    await client.query('SAVEPOINT sp_reorder_shift');
    try {
      await shiftAppointmentsAfterReorder(client, episodeId);
      await client.query('RELEASE SAVEPOINT sp_reorder_shift');
    } catch (shiftErr) {
      await client.query('ROLLBACK TO SAVEPOINT sp_reorder_shift');
      shiftFailed = true;
      logger.error(
        '[reorder] appointment shift failed (rolled back to savepoint, seq changes kept):',
        shiftErr
      );
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

  const allPhases = await getFullWorkPhaseQuery(pool, episodeId);

  const responseBody: { workPhases: unknown[]; partial?: boolean; message?: string } = {
    workPhases: allPhases.rows,
  };
  if (shiftFailed) {
    responseBody.partial = true;
    responseBody.message =
      'A sorrend mentve, de a meglévő időpontok automatikus átkötése nem sikerült — az időpontok az eredeti munkafázisokhoz kapcsolódnak.';
  }

  return NextResponse.json(responseBody);
});

// ────────────────────────────────────────────────────────────────────────────
// Appointment-stays-step-shifts logic
// ────────────────────────────────────────────────────────────────────────────

type PlannedShift = {
  appointmentId: string;
  slotIntentId: string | null;
  newStepId: string;
  newStepCode: string;
  newStepSeq: number;
  /** Korábbi 'scheduled' EWP sor, amit vissza kell állítani 'pending'-re. */
  oldStepId: string | null;
};

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
    `SELECT id, work_phase_code as "stepCode", pathway_order_index as "pathwayOrderIndex",
            seq, status, pool,
            merged_into_episode_work_phase_id as "mergedIntoId"
     FROM episode_work_phases
     WHERE episode_id = $1
     ORDER BY COALESCE(seq, pathway_order_index) ASC`,
    [episodeId]
  );
  const steps: Array<{
    id: string; stepCode: string; pathwayOrderIndex: number;
    seq: number | null; status: string; pool: string;
    mergedIntoId: string | null;
  }> = stepsResult.rows;

  // For each future appointment, check if it needs reassignment.
  // Group by pool since different pools are independent (work, consult, control).
  // Track claimed step IDs so multiple appointments in the same pool each get
  // a distinct pending step (avoids unique-constraint violation on appointments).
  const claimedStepIds = new Set<string>();
  const planned: PlannedShift[] = [];

  for (const appt of apptResult.rows) {
    // Összevont (rejtett) al-fázisra nem kötünk át időpontot — csak elsődleges
    // (nem merged) sor lehet a cél.
    const newNextStep = steps.find(
      (s) =>
        (s.status === 'pending' || s.status === 'scheduled') &&
        s.pool === appt.pool &&
        !s.mergedIntoId &&
        !claimedStepIds.has(s.id)
    );

    if (!newNextStep) continue;

    claimedStepIds.add(newNextStep.id);

    // If the appointment's step_code already matches the target step, no change needed
    if (appt.stepCode === newNextStep.stepCode && appt.stepSeq === newNextStep.pathwayOrderIndex) {
      continue;
    }

    logger.info(
      `[reorder] Shifting appointment ${appt.id}: ${appt.stepCode}(seq=${appt.stepSeq}) → ${newNextStep.stepCode}(idx=${newNextStep.pathwayOrderIndex})`
    );

    // A korábbi 'scheduled' sor visszaáll 'pending'-re — de csak akkor, ha nem
    // célpontja egy másik (korábbi) átkötésnek, különben felülírnánk a linkjét.
    const oldStep = steps.find(
      (s) => s.stepCode === appt.stepCode && s.pathwayOrderIndex === appt.stepSeq && s.id !== newNextStep.id
    );
    const resetOldStep = !!oldStep && oldStep.status === 'scheduled' && !claimedStepIds.has(oldStep.id);

    planned.push({
      appointmentId: appt.id,
      slotIntentId: appt.slotIntentId,
      newStepId: newNextStep.id,
      newStepCode: newNextStep.stepCode,
      newStepSeq: newNextStep.pathwayOrderIndex,
      oldStepId: resetOldStep ? oldStep.id : null,
    });

    if (resetOldStep) oldStep.status = 'pending';
    newNextStep.status = 'scheduled';
  }

  if (planned.length === 0) return;

  // ── 1. fázis: sentinel step_seq (negatív tartomány) ────────────────────────
  // Két jövőbeli foglalás cseréjénél a közvetlen átírás megsértené az
  // idx_appointments_unique_pending_step / uq_slot_intents_episode_step_seq
  // egyediséget (klasszikus temp-nélküli swap probléma), ezért előbb minden
  // érintett sort ütközésmentes sentinel seq-re teszünk, és csak utána írjuk
  // a végleges értékeket.
  for (let i = 0; i < planned.length; i++) {
    const sentinelSeq = -(1000 + i);
    await client.query(
      `UPDATE appointments SET step_seq = $1 WHERE id = $2`,
      [sentinelSeq, planned[i].appointmentId]
    );
    if (planned[i].slotIntentId) {
      await client.query(
        `UPDATE slot_intents SET step_seq = $1 WHERE id = $2 AND state = 'converted'`,
        [sentinelSeq, planned[i].slotIntentId]
      );
    }
  }

  // ── 2. fázis: végleges step_code / step_seq ───────────────────────────────
  for (const move of planned) {
    await client.query(
      `UPDATE appointments SET step_code = $1, step_seq = $2 WHERE id = $3`,
      [move.newStepCode, move.newStepSeq, move.appointmentId]
    );
    if (move.slotIntentId) {
      await client.query(
        `UPDATE slot_intents SET step_code = $1, step_seq = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND state = 'converted'`,
        [move.newStepCode, move.newStepSeq, move.slotIntentId]
      );
    }
  }

  // ── 3. fázis: EWP-könyvelés — előbb minden felszabadítás, aztán a linkek ──
  for (const move of planned) {
    if (move.oldStepId) {
      await client.query(
        `UPDATE episode_work_phases SET status = 'pending', appointment_id = NULL WHERE id = $1`,
        [move.oldStepId]
      );
    }
  }
  for (const move of planned) {
    await client.query(
      `UPDATE episode_work_phases SET appointment_id = NULL
       WHERE episode_id = $1 AND appointment_id = $2`,
      [episodeId, move.appointmentId]
    );
  }
  for (const move of planned) {
    await client.query(
      `UPDATE episode_work_phases SET appointment_id = $1, status = 'scheduled'
       WHERE id = $2`,
      [move.appointmentId, move.newStepId]
    );
  }
}
