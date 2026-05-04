import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import { assertPrepTokenOrThrow } from '@/lib/consilium-prep-share';
import {
  assertSessionWritableForItemFields,
  checklistAddSchema,
  getScopedSessionOrThrow,
  normalizeChecklist,
} from '@/lib/consilium';
import { logActivity } from '@/lib/activity';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth, params }) => {
  const rawToken = decodeURIComponent(params.token ?? '');
  if (!rawToken) {
    return NextResponse.json({ error: 'Hiányzó token' }, { status: 400 });
  }

  const prep = await assertPrepTokenOrThrow(rawToken);

  const session = await getScopedSessionOrThrow(prep.sessionId, prep.institutionId);
  assertSessionWritableForItemFields(session.status);

  const body = checklistAddSchema.parse(await req.json());

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT checklist FROM consilium_session_items WHERE id = $1 AND session_id = $2 FOR UPDATE`,
      [prep.itemId, prep.sessionId],
    );
    if (existing.rows.length === 0) {
      throw new HttpError(404, 'Elem nem található ebben az alkalomban', 'ITEM_NOT_FOUND');
    }

    const checklist = normalizeChecklist(existing.rows[0].checklist);
    const key = `pt-${randomUUID()}`;
    checklist.push({
      key,
      label: body.label.trim(),
      checked: false,
    });

    const result = await client.query(
      `UPDATE consilium_session_items
       SET checklist = $3::jsonb,
           updated_by = $4,
           updated_at = NOW()
       WHERE id = $1 AND session_id = $2
       RETURNING id, checklist`,
      [prep.itemId, prep.sessionId, JSON.stringify(checklist), auth.email],
    );

    await client.query('COMMIT');

    await logActivity(
      req,
      auth.email,
      'consilium_prep_checklist_point_added',
      JSON.stringify({
        sessionId: prep.sessionId,
        itemId: prep.itemId,
        checklistKey: key,
        labelPreview: body.label.trim().slice(0, 200),
      }),
      { skipAdminNotificationQueue: true },
    );

    return NextResponse.json({ item: result.rows[0] }, { status: 201 });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});
