import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  assertSessionWritableForItemFields,
  checklistRenameSchema,
  checklistResponseBodySchema,
  checklistToggleSchema,
  getScopedSessionOrThrow,
  getUserInstitution,
  normalizeChecklist,
} from '@/lib/consilium';

export const dynamic = 'force-dynamic';

function parseChecklistKeyPatch(
  body: unknown,
): { mode: 'toggle'; checked: boolean } | { mode: 'rename'; label: string } | { mode: 'response'; response: string } {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const o = body as Record<string, unknown>;
    const hasChecked = typeof o.checked === 'boolean';
    const hasLabel = typeof o.label === 'string' && o.label.trim().length > 0;
    const hasResponse = 'response' in o && typeof o.response === 'string';
    const n = (hasChecked ? 1 : 0) + (hasLabel ? 1 : 0) + (hasResponse ? 1 : 0);
    if (n !== 1) {
      throw new HttpError(
        400,
        'Pontosan egy mező: checked (boolean) VAGY label (szöveg) VAGY response (szöveg, üres = törlés)',
        'INVALID_CHECKLIST_PATCH',
      );
    }
    if (hasChecked) {
      return { mode: 'toggle', checked: checklistToggleSchema.parse(o).checked };
    }
    if (hasLabel) {
      return { mode: 'rename', label: checklistRenameSchema.parse(o).label };
    }
    return { mode: 'response', response: checklistResponseBodySchema.parse(o).response };
  }
  throw new HttpError(400, 'Érvénytelen checklist PATCH', 'INVALID_CHECKLIST_PATCH');
}

export const PATCH = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const key = decodeURIComponent(params.key);
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItemFields(session.status);

  const patch = parseChecklistKeyPatch(await req.json());
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
    const idx = checklist.findIndex((e) => e.key === key);
    if (idx < 0) {
      throw new HttpError(404, 'Checklist elem nem található', 'CHECKLIST_KEY_NOT_FOUND');
    }

    if (patch.mode === 'rename') {
      checklist[idx] = {
        ...checklist[idx],
        label: patch.label.trim(),
      };
    } else if (patch.mode === 'response') {
      const trimmed = patch.response.trim();
      const nowIso = new Date().toISOString();
      checklist[idx] = {
        ...checklist[idx],
        response: trimmed === '' ? null : trimmed,
        respondedAt: trimmed === '' ? null : nowIso,
        respondedBy: trimmed === '' ? null : auth.email,
      };
    } else {
      const nowIso = new Date().toISOString();
      checklist[idx] = {
        ...checklist[idx],
        checked: patch.checked,
        checkedAt: patch.checked ? nowIso : null,
        checkedBy: patch.checked ? auth.email : null,
      };
    }

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
    return NextResponse.json({ item: result.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export const DELETE = authedHandler(async (_req, { auth, params }) => {
  const sessionId = params.id;
  const itemId = params.itemId;
  const key = decodeURIComponent(params.key);
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItemFields(session.status);

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

    const before = normalizeChecklist(existing.rows[0].checklist);
    const checklist = before.filter((e) => e.key !== key);
    if (checklist.length === before.length) {
      throw new HttpError(404, 'Checklist elem nem található', 'CHECKLIST_KEY_NOT_FOUND');
    }

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
    return NextResponse.json({ item: result.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});
