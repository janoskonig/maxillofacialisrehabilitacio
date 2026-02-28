import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';
import { checkOneHardNext, getAppointmentRiskSettings } from '@/lib/scheduling-service';

/**
 * POST /api/slot-intents/:id/convert — convert soft intent to hard appointment
 * Body: { timeSlotId } — picks a free slot within the window
 */
export const POST = roleHandler(['admin', 'sebészorvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const intentId = params.id;
  const body = await req.json().catch(() => ({}));
  const { timeSlotId } = body;

  const pool = getDbPool();

  const intentResult = await pool.query(
    `SELECT si.*, pe.patient_id as "patientId"
     FROM slot_intents si
     JOIN patient_episodes pe ON si.episode_id = pe.id
     WHERE si.id = $1 AND si.state = 'open'`,
    [intentId]
  );

  if (intentResult.rows.length === 0) {
    return NextResponse.json(
      { error: 'Intent nem található vagy már nem open' },
      { status: 404 }
    );
  }

  const intent = intentResult.rows[0];

  await pool.query('BEGIN');

  try {
    const intentLock = await pool.query(
      `SELECT id FROM slot_intents WHERE id = $1 AND state = 'open' FOR UPDATE`,
      [intentId]
    );
    if (intentLock.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Intent nem található vagy már nem open' },
        { status: 404 }
      );
    }

    const episodeLock = await pool.query(
      `SELECT id FROM patient_episodes WHERE id = $1 FOR UPDATE`,
      [intent.episode_id]
    );
    if (episodeLock.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
    }

    let requiresPrecommit = false;
    if (intent.pool === 'work') {
      const pathwayResult = await pool.query(
        `SELECT cp.steps_json FROM patient_episodes pe
         JOIN care_pathways cp ON pe.care_pathway_id = cp.id
         WHERE pe.id = $1`,
        [intent.episode_id]
      );
      const steps = pathwayResult.rows[0]?.steps_json as Array<{ step_code: string; requires_precommit?: boolean }> | null;
      const step = steps?.find((s) => s.step_code === intent.step_code);
      requiresPrecommit = step?.requires_precommit === true;
    }

    const episodeCheck = await pool.query(
      `SELECT id FROM patient_episodes WHERE id = $1`,
      [intent.episode_id]
    );
    if (episodeCheck.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json({ error: 'Intent episode_id nem található' }, { status: 400 });
    }

    const oneHardNext = await checkOneHardNext(intent.episode_id, intent.pool as 'work' | 'consult' | 'control', {
      requiresPrecommit,
      stepCode: intent.step_code,
    });
    if (!oneHardNext.allowed) {
      await pool.query('ROLLBACK');
      return NextResponse.json(
        { error: oneHardNext.reason, code: 'ONE_HARD_NEXT_VIOLATION' },
        { status: 409 }
      );
    }

    if (requiresPrecommit && intent.episode_id) {
      await pool.query(
        `INSERT INTO scheduling_override_audit (episode_id, user_id, override_reason) VALUES ($1, $2, $3)`,
        [intent.episode_id, auth.userId, `precommit: ${intent.step_code}`]
      );
    }

    let slotId = timeSlotId;

    if (!slotId) {
      const windowStart = intent.window_start ? new Date(intent.window_start) : new Date();
      const windowEnd = intent.window_end ? new Date(intent.window_end) : new Date(windowStart.getTime() + 14 * 24 * 60 * 60 * 1000);

      const slotResult = await pool.query(
        `SELECT id FROM available_time_slots
         WHERE state = 'free' AND (slot_purpose = $1 OR slot_purpose IS NULL)
         AND start_time >= $2 AND start_time <= $3
         AND (duration_minutes >= $4 OR duration_minutes IS NULL)
         ORDER BY start_time ASC LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [intent.pool, windowStart, windowEnd, intent.duration_minutes]
      );

      if (slotResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Nincs szabad időpont a megadott ablakban' },
          { status: 404 }
        );
      }

      slotId = slotResult.rows[0].id;
    }

    const slotCheck = await pool.query(
      `SELECT id, start_time, user_id, state FROM available_time_slots WHERE id = $1 FOR UPDATE`,
      [slotId]
    );

    if (slotCheck.rows.length === 0) {
      await pool.query('ROLLBACK');
      return NextResponse.json({ error: 'Időpont nem található' }, { status: 404 });
    }

    const slot = slotCheck.rows[0];
    if (slot.state !== 'free') {
      await pool.query('ROLLBACK');
      return NextResponse.json({ error: 'Az időpont már nem szabad' }, { status: 400 });
    }

    const startTime = new Date(slot.start_time);
    const durationMinutes = intent.duration_minutes || 30;

    let noShowRisk = 0;
    let requiresConfirmation = false;
    let holdExpiresAt: Date | null = null;
    try {
      const riskSettings = await getAppointmentRiskSettings(intent.patientId, startTime, auth.email);
      noShowRisk = riskSettings.noShowRisk;
      requiresConfirmation = riskSettings.requiresConfirmation;
      holdExpiresAt = riskSettings.holdExpiresAt;
    } catch {
      holdExpiresAt = new Date();
      holdExpiresAt.setHours(holdExpiresAt.getHours() + 48);
    }

    const appointmentType =
      intent.pool === 'consult' ? 'elso_konzultacio' : intent.pool === 'control' ? 'kontroll' : 'munkafazis';

    const apptResult = await pool.query(
      `INSERT INTO appointments (
        patient_id, episode_id, time_slot_id, created_by, dentist_email, appointment_type,
        pool, duration_minutes, no_show_risk, requires_confirmation, hold_expires_at, created_via, requires_precommit, start_time, end_time,
        slot_intent_id, step_code, step_seq
      )
      SELECT $1, $2, $3, $4, u.email, $5, $6, $7, $8, $9, $10, 'worklist', $11, $12, $13,
             $14, $15, $16
      FROM available_time_slots ats
      JOIN users u ON ats.user_id = u.id
      WHERE ats.id = $3
      RETURNING id, patient_id as "patientId", episode_id as "episodeId",
        time_slot_id as "timeSlotId", pool, duration_minutes as "durationMinutes", appointment_type as "appointmentType"`,
      [
        intent.patientId,
        intent.episode_id,
        slotId,
        auth.email,
        appointmentType,
        intent.pool,
        durationMinutes,
        noShowRisk,
        requiresConfirmation,
        holdExpiresAt,
        requiresPrecommit,
        startTime,
        new Date(startTime.getTime() + durationMinutes * 60 * 1000),
        intentId,
        intent.step_code,
        intent.step_seq,
      ]
    );

    const appointment = apptResult.rows[0];

    await pool.query(
      `UPDATE available_time_slots SET state = 'booked', status = 'booked' WHERE id = $1`,
      [slotId]
    );

    await pool.query(
      `UPDATE slot_intents SET state = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [intentId]
    );

    await pool.query('COMMIT');

    return NextResponse.json({ appointment, intentId }, { status: 201 });
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
});
