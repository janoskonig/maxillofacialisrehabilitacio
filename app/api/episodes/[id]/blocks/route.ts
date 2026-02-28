import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { getDefaultTtlDays, isValidBlockKey } from '@/lib/episode-block-taxonomy';

/**
 * GET /api/episodes/:id/blocks
 * List active and recently inactive blocks for an episode.
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT id, episode_id as "episodeId", key, active, expires_at as "expiresAt",
            renewal_count as "renewalCount", expected_unblock_date as "expectedUnblockDate",
            note, created_at as "createdAt", updated_at as "updatedAt"
     FROM episode_blocks
     WHERE episode_id = $1
     ORDER BY active DESC, created_at DESC`,
    [episodeId]
  );

  return NextResponse.json({ blocks: result.rows });
});

/**
 * POST /api/episodes/:id/blocks
 * Create a new episode block.
 * Body: { key, reason?, expectedUnblockDate?, note? }
 */
export const POST = roleHandler(['admin', 'sebészorvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const body = await req.json().catch(() => ({}));
  const { key, reason, expectedUnblockDate, note } = body;

  if (!key || typeof key !== 'string') {
    return NextResponse.json(
      { error: 'key kötelező (pl. WAIT_LAB, WAIT_HEALING, WAIT_SURGERY, PATIENT_DELAY)' },
      { status: 400 }
    );
  }

  if (!isValidBlockKey(key)) {
    return NextResponse.json(
      { error: `Érvénytelen block key: ${key}. Használható: WAIT_LAB, WAIT_HEALING, WAIT_SURGERY, PATIENT_DELAY, WAIT_OR, WAIT_IMPLANT, OTHER` },
      { status: 400 }
    );
  }

  const pool = getDbPool();

  const episodeCheck = await pool.query(
    'SELECT id FROM patient_episodes WHERE id = $1',
    [episodeId]
  );
  if (episodeCheck.rows.length === 0) {
    return NextResponse.json({ error: 'Epizód nem található' }, { status: 404 });
  }

  const ttlDays = getDefaultTtlDays(key);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  const expectedUnblock = expectedUnblockDate
    ? new Date(expectedUnblockDate)
    : new Date(expiresAt.getTime() - 2 * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO episode_blocks (episode_id, key, active, expires_at, expected_unblock_date, note)
     VALUES ($1, $2, true, $3, $4, $5)
     RETURNING id, episode_id as "episodeId", key, active, expires_at as "expiresAt",
               renewal_count as "renewalCount", expected_unblock_date as "expectedUnblockDate",
               note, created_at as "createdAt"`,
    [episodeId, key, expiresAt, expectedUnblock, note ?? reason ?? null]
  );

  const block = result.rows[0];

  const taskDue = new Date(expectedUnblock.getTime() - 2 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO episode_tasks (episode_id, task_type, due_at) VALUES ($1, 'unblock_check', $2)`,
    [episodeId, taskDue]
  );

  try {
    await emitSchedulingEvent('block', block.id, 'created');
  } catch {
    // Non-blocking
  }

  return NextResponse.json({ block }, { status: 201 });
});
