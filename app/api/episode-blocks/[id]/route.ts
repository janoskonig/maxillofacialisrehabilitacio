import { NextResponse } from 'next/server';
import { roleHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { emitSchedulingEvent } from '@/lib/scheduling-events';
import { OBSTACLE_COLUMNS, updateObstacleSchema, obstacleDate } from '@/lib/episode-obstacles';

export const PATCH = roleHandler(['admin', 'beutalo_orvos', 'fogpótlástanász'], async (req, { auth, params }) => {
  const parsed = updateObstacleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const data = parsed.data;
  const client = await getDbPool().connect();
  let block;
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT id, active, waiting_since FROM episode_blocks WHERE id = $1 FOR UPDATE', [params.id]);
    if (!current.rows.length || !current.rows[0].active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: current.rows.length ? 'Az akadály már nem aktív' : 'Akadály nem található' }, { status: current.rows.length ? 409 : 404 });
    }
    if (data.action === 'update' && data.expectedUnblockDate && data.expectedUnblockDate < obstacleDate(current.rows[0].waiting_since)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'A várt válasz dátuma nem előzheti meg a várakozás kezdetét' }, { status: 400 });
    }
    const result = data.action === 'resolve'
      ? await client.query(
        `UPDATE episode_blocks SET active = false, resolved_at = CURRENT_TIMESTAMP,
           resolved_by = $2, resolution_note = $3, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING ${OBSTACLE_COLUMNS}`,
        [params.id, auth.userId, data.resolutionNote || null]
      )
      : await client.query(
        `UPDATE episode_blocks SET key = $2, waiting_on = $3,
           expected_unblock_date = $4::date::timestamp AT TIME ZONE 'Europe/Budapest',
           note = $5, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING ${OBSTACLE_COLUMNS}`,
        [params.id, data.key, data.waitingOn, data.expectedUnblockDate ?? null, data.note || null]
      );
    block = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  try { await emitSchedulingEvent('block', block.id, data.action === 'resolve' ? 'resolved' : 'updated'); } catch { /* Non-blocking. */ }
  return NextResponse.json({ block });
});
