import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  assertSessionWritableForItems,
  getScopedSessionOrThrow,
  getUserInstitution,
  reorderItemsSchema,
} from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const PATCH = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItems(session.status);

  const body = reorderItemsSchema.parse(await req.json());
  const pool = getDbPool();

  const existing = await pool.query(
    `SELECT id FROM consilium_session_items WHERE session_id = $1 ORDER BY sort_order ASC`,
    [sessionId],
  );
  const existingIds = existing.rows.map((r) => r.id);
  if (existingIds.length !== body.itemIdsInOrder.length) {
    throw new HttpError(400, 'A teljes elem lista szükséges az újrarendezéshez', 'INVALID_REORDER_LIST');
  }
  const setA = new Set(existingIds);
  const setB = new Set(body.itemIdsInOrder);
  if (setA.size !== setB.size || existingIds.some((id) => !setB.has(id))) {
    throw new HttpError(400, 'A teljes elem lista szükséges az újrarendezéshez', 'INVALID_REORDER_LIST');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE consilium_session_items
       SET sort_order = sort_order + 100000,
           updated_by = $2,
           updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, auth.email],
    );

    // Egyetlen batch UPDATE az elemenkénti N lekérdezés helyett: a tömb
    // pozíciója (WITH ORDINALITY) lesz a végső sort_order. Az előző lépés a
    // sort_order-t kiemeltette a tartományból, így nincs tranziens unique-ütközés.
    const reorderResult = await client.query(
      `UPDATE consilium_session_items AS t
       SET sort_order = v.ord,
           updated_by = $3,
           updated_at = NOW()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS v(id, ord)
       WHERE t.id = v.id AND t.session_id = $1`,
      [sessionId, body.itemIdsInOrder, auth.email],
    );
    if (reorderResult.rowCount !== body.itemIdsInOrder.length) {
      throw new HttpError(404, 'Elem nem található ebben az alkalomban', 'ITEM_NOT_FOUND');
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});
