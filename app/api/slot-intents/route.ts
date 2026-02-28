import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { roleHandler } from '@/lib/api/route-handler';

export const POST = roleHandler(['admin', 'sebészorvos', 'fogpótlástanász'], async (req, { auth }) => {
  const body = await req.json();
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
});
