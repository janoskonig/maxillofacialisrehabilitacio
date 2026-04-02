import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  assertSessionWritableForItemFields,
  checklistAddSchema,
  getScopedSessionOrThrow,
  getUserInstitution,
  normalizeChecklist,
} from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItemFields(session.status);

  const body = checklistAddSchema.parse(await req.json());
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT checklist FROM consilium_session_items WHERE id = $1 AND session_id = $2 FOR UPDATE`,
      [itemId, sessionId],
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
      [itemId, sessionId, JSON.stringify(checklist), auth.email],
    );

    await client.query('COMMIT');
    return NextResponse.json({ item: result.rows[0] }, { status: 201 });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});
