import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { handleApiError } from '@/lib/api-error-handler';

/**
 * POST /api/slot-intents — create soft intent (no slot consumed)
 * Body: { episodeId, stepCode, stepSeq?, windowStart, windowEnd, durationMinutes, pool, priority? }
 * stepSeq: steps_json index (0-based) for repeated step_code (e.g. control_6m, control_12m)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Bejelentkezés szükséges' }, { status: 401 });
    }
    if (auth.role !== 'admin' && auth.role !== 'sebészorvos' && auth.role !== 'fogpótlástanász') {
      return NextResponse.json({ error: 'Nincs jogosultsága az intent létrehozásához' }, { status: 403 });
    }

    const body = await request.json();
    const {
      episodeId,
      stepCode,
      stepSeq = 0,
      windowStart,
      windowEnd,
      durationMinutes,
      pool,
      priority = 0,
    } = body;

    if (!episodeId || !stepCode || !durationMinutes || !pool) {
      return NextResponse.json(
        { error: 'episodeId, stepCode, durationMinutes, pool kötelező' },
        { status: 400 }
      );
    }

    const stepSeqVal = typeof stepSeq === 'number' && stepSeq >= 0 ? stepSeq : 0;

    const validPools = ['consult', 'work', 'control'];
    if (!validPools.includes(pool)) {
      return NextResponse.json(
        { error: 'pool érvényes értékek: consult, work, control' },
        { status: 400 }
      );
    }

    const poolDb = getDbPool();

    const episodeCheck = await poolDb.query(
      'SELECT id FROM patient_episodes WHERE id = $1 AND status = $2',
      [episodeId, 'open']
    );
    if (episodeCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Epizód nem található vagy nem nyitott' }, { status: 404 });
    }

    const windowStartTs = windowStart ? new Date(windowStart) : null;
    const windowEndTs = windowEnd ? new Date(windowEnd) : null;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const r = await poolDb.query(
      `INSERT INTO slot_intents (
        episode_id, step_code, step_seq, window_start, window_end, duration_minutes,
        pool, state, priority, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9)
      RETURNING id, episode_id as "episodeId", step_code as "stepCode", step_seq as "stepSeq",
        window_start as "windowStart", window_end as "windowEnd",
        duration_minutes as "durationMinutes", pool, state, priority,
        expires_at as "expiresAt", created_at as "createdAt"`,
      [episodeId, stepCode, stepSeqVal, windowStartTs, windowEndTs, durationMinutes, pool, priority, expiresAt]
    );

    const intent = r.rows[0];
    return NextResponse.json({ intent }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Hiba történt az intent létrehozásakor');
  }
}
