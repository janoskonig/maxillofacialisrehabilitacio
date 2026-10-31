import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { authedHandler, roleHandler } from '@/lib/api/route-handler';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { createObstacleSchema, OBSTACLE_COLUMNS } from '@/lib/episode-obstacles';

export const dynamic = 'force-dynamic';

/**
 * GET /api/episodes/:id/blocks
 * List active and recently inactive blocks for an episode.
 */
export const GET = authedHandler(async (req, { auth, params }) => {
  const episodeId = params.id;
  const pool = getDbPool();

  const result = await pool.query(
    `SELECT ${OBSTACLE_COLUMNS} FROM episode_blocks
     WHERE episode_id = $1
     ORDER BY active DESC, waiting_since ASC, id`,
    [episodeId]
  );

  return NextResponse.json({ blocks: result.rows, serverNow: new Date().toISOString() });
});

/**
 * POST /api/episodes/:id/blocks
 * Create a new episode block.
 * Body: { key, waitingOn, waitingSince?, expectedUnblockDate?, note? }
 */
export const POST = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const episodeId = params.id;
  const parsed = createObstacleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { key, waitingOn, waitingSince, expectedUnblockDate, note } = parsed.data;
  const pool = getDbPool();
  const client = await pool.connect();
  let block;
  try {
    await client.query('BEGIN');
    const episode = await client.query('SELECT id, status FROM patient_episodes WHERE id = $1 FOR UPDATE', [episodeId]);
    if (!episode.rows.length || episode.rows[0].status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: episode.rows.length ? 'Akadály csak nyitott kezeléshez rögzíthető' : 'Epizód nem található' }, { status: episode.rows.length ? 409 : 404 });
    }
    const result = await client.query(
      `INSERT INTO episode_blocks
        (episode_id, key, active, expires_at, waiting_on, waiting_since, expected_unblock_date, note, created_by)
       VALUES ($1, $2, true, NULL, $3,
         COALESCE($4::date::timestamp AT TIME ZONE 'Europe/Budapest', CURRENT_TIMESTAMP),
         $5::date::timestamp AT TIME ZONE 'Europe/Budapest', $6, $7)
       RETURNING ${OBSTACLE_COLUMNS}`,
      [episodeId, key, waitingOn, waitingSince ?? null, expectedUnblockDate ?? null, note || null, auth.userId]
    );
    block = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  try {
    await emitSchedulingEvent('block', block.id, 'created');
  } catch {
    // Non-blocking
  }

  return NextResponse.json({ block }, { status: 201 });
});
