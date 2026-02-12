import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { checkOneHardNext } from '@/lib/scheduling-service';
import { handleApiError } from '@/lib/api-error-handler';

/**
 * POST /api/slot-intents/:id/convert — convert soft intent to hard appointment
 * Body: { timeSlotId } — picks a free slot within the window
 * If timeSlotId not provided, finds first free slot in window.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultsága az intent megvalósításához' }, { status: 403 });
    }

    const intentId = params.id;
    const body = await request.json().catch(() => ({}));
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

    // One-hard-next check for work pool
    const oneHardNext = await checkOneHardNext(intent.episode_id, intent.pool as 'work' | 'consult' | 'control');
    if (!oneHardNext.allowed) {
      return NextResponse.json(
        { error: oneHardNext.reason, code: 'ONE_HARD_NEXT_VIOLATION' },
        { status: 409 }
      );
    }

    let slotId = timeSlotId;

    if (!slotId) {
      // Find first free slot in window matching pool and duration
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
        return NextResponse.json(
          { error: 'Nincs szabad időpont a megadott ablakban' },
          { status: 404 }
        );
      }

      slotId = slotResult.rows[0].id;
    }

    await pool.query('BEGIN');

    try {
      // Verify slot is free
      const slotCheck = await pool.query(
        `SELECT id, start_time, user_id FROM available_time_slots WHERE id = $1 FOR UPDATE`,
        [slotId]
      );

      if (slotCheck.rows.length === 0) {
        await pool.query('ROLLBACK');
        return NextResponse.json({ error: 'Időpont nem található' }, { status: 404 });
      }

      const slot = slotCheck.rows[0];
      const slotStateCheck = await pool.query(
        'SELECT state FROM available_time_slots WHERE id = $1',
        [slotId]
      );

      if (slotStateCheck.rows[0]?.state !== 'free') {
        await pool.query('ROLLBACK');
        return NextResponse.json({ error: 'Az időpont már nem szabad' }, { status: 400 });
      }

      const startTime = new Date(slot.start_time);
      const durationMinutes = intent.duration_minutes || 30;

      const apptResult = await pool.query(
        `INSERT INTO appointments (
          patient_id, episode_id, time_slot_id, created_by, dentist_email,
          pool, duration_minutes, created_via, start_time, end_time
        )
        SELECT $1, $2, $3, $4, u.email, $5, $6, 'worklist', $7, $8
        FROM available_time_slots ats
        JOIN users u ON ats.user_id = u.id
        WHERE ats.id = $3
        RETURNING id, patient_id as "patientId", episode_id as "episodeId",
          time_slot_id as "timeSlotId", pool, duration_minutes as "durationMinutes"`,
        [
          intent.patientId,
          intent.episode_id,
          slotId,
          auth.email,
          intent.pool,
          durationMinutes,
          startTime,
          new Date(startTime.getTime() + durationMinutes * 60 * 1000),
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
  } catch (error) {
    return handleApiError(error, 'Hiba történt az intent megvalósításakor');
  }
}
