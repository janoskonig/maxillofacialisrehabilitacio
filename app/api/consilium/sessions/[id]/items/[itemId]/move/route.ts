import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import { getDbPool } from '@/lib/db';
import { assertSessionWritableForItems, getUserInstitution } from '@/lib/consilium';

export const dynamic = 'force-dynamic';

const moveBodySchema = z.object({
  targetSessionId: z.string().uuid(),
});

export const POST = authedHandler(async (req, { auth, params }) => {
  const sourceSessionId = params.id;
  const itemId = params.itemId;
  const institutionId = await getUserInstitution(auth);
  const body = moveBodySchema.parse(await req.json());

  if (body.targetSessionId === sourceSessionId) {
    throw new HttpError(400, 'A cél alkalom nem egyezhet a forrás alkalommal', 'MOVE_TARGET_EQUALS_SOURCE');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceLock = await client.query<{ status: string }>(
      `SELECT status
       FROM consilium_sessions
       WHERE id = $1::uuid
         AND btrim(coalesce(institution_id, '')) = btrim(coalesce($2::text, ''))
       FOR UPDATE`,
      [sourceSessionId, institutionId],
    );
    if (sourceLock.rows.length === 0) {
      throw new HttpError(404, 'Forrás konzílium alkalom nem található', 'SOURCE_SESSION_NOT_FOUND');
    }
    assertSessionWritableForItems(sourceLock.rows[0].status as 'draft' | 'active' | 'closed');

    const targetLock = await client.query<{ status: string }>(
      `SELECT status
       FROM consilium_sessions
       WHERE id = $1::uuid
         AND btrim(coalesce(institution_id, '')) = btrim(coalesce($2::text, ''))
       FOR UPDATE`,
      [body.targetSessionId, institutionId],
    );
    if (targetLock.rows.length === 0) {
      throw new HttpError(404, 'Cél konzílium alkalom nem található', 'TARGET_SESSION_NOT_FOUND');
    }
    assertSessionWritableForItems(targetLock.rows[0].status as 'draft' | 'active' | 'closed');

    const itemRow = await client.query<{ patientId: string }>(
      `SELECT patient_id as "patientId"
       FROM consilium_session_items
       WHERE id = $1::uuid
         AND session_id = $2::uuid
       FOR UPDATE`,
      [itemId, sourceSessionId],
    );
    if (itemRow.rows.length === 0) {
      throw new HttpError(404, 'Áthelyezendő elem nem található', 'ITEM_NOT_FOUND');
    }

    const maxRow = await client.query<{ maxSort: string }>(
      `SELECT COALESCE(MAX(sort_order), 0) as "maxSort"
       FROM consilium_session_items
       WHERE session_id = $1::uuid`,
      [body.targetSessionId],
    );
    const nextSort = Number(maxRow.rows[0]?.maxSort ?? 0) + 1;

    const moved = await client.query(
      `UPDATE consilium_session_items
       SET session_id = $2::uuid,
           sort_order = $3,
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING
         id,
         session_id as "sessionId",
         patient_id as "patientId",
         sort_order as "sortOrder",
         discussed,
         checklist`,
      [itemId, body.targetSessionId, nextSort, auth.email],
    );
    if (moved.rows.length === 0) {
      throw new HttpError(404, 'Áthelyezendő elem nem található', 'ITEM_NOT_FOUND');
    }

    await client.query(
      `UPDATE consilium_prep_comments
       SET session_id = $2::uuid
       WHERE item_id = $1::uuid`,
      [itemId, body.targetSessionId],
    );
    await client.query(
      `UPDATE consilium_item_prep_tokens
       SET session_id = $2::uuid
       WHERE item_id = $1::uuid`,
      [itemId, body.targetSessionId],
    );

    await client.query('COMMIT');
    return NextResponse.json({ item: moved.rows[0] });
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') {
      return NextResponse.json({ error: 'Ez a beteg már szerepel a cél alkalmon' }, { status: 409 });
    }
    throw e;
  } finally {
    client.release();
  }
});
