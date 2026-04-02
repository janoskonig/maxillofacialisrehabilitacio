import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  assertSessionWritableForItemFields,
  assertSessionWritableForItems,
  getScopedSessionOrThrow,
  getUserInstitution,
  patchSessionItemSchema,
} from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const PATCH = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItemFields(session.status);

  const body = patchSessionItemSchema.parse(await req.json());
  const pool = getDbPool();

  const result = await pool.query(
    `UPDATE consilium_session_items
     SET discussed = $3,
         updated_by = $4,
         updated_at = NOW()
     WHERE id = $1 AND session_id = $2
     RETURNING id, discussed, checklist`,
    [itemId, sessionId, body.discussed, auth.email],
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, 'Elem nem található ebben az alkalomban', 'ITEM_NOT_FOUND');
  }
  return NextResponse.json({ item: result.rows[0] });
});

export const DELETE = authedHandler(async (_req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItems(session.status);

  const pool = getDbPool();
  const result = await pool.query(
    `DELETE FROM consilium_session_items WHERE id = $1 AND session_id = $2 RETURNING id`,
    [itemId, sessionId],
  );
  if (result.rows.length === 0) {
    throw new HttpError(404, 'Elem nem található ebben az alkalomban', 'ITEM_NOT_FOUND');
  }
  return NextResponse.json({ ok: true });
});
