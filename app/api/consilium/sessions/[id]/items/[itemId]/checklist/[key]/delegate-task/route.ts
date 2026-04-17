import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  assertSessionWritableForItemFields,
  checklistDelegateTaskSchema,
  ensurePatientVisibleForUser,
  getScopedSessionOrThrow,
  getUserInstitution,
  normalizeChecklist,
} from '@/lib/consilium';
import { insertUserTask } from '@/lib/user-tasks';

export const dynamic = 'force-dynamic';

export const POST = authedHandler(async (req, { auth, params }) => {
  if (auth.role === 'technikus') {
    return NextResponse.json({ error: 'Ehhez a művelethez nincs jogosultság' }, { status: 403 });
  }

  const sessionId = params.id;
  const itemId = params.itemId;
  const key = decodeURIComponent(params.key);
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);
  assertSessionWritableForItemFields(session.status);

  const body = checklistDelegateTaskSchema.parse(await req.json().catch(() => ({})));

  const pool = getDbPool();
  const itemRes = await pool.query(
    `SELECT patient_id as "patientId", checklist
     FROM consilium_session_items
     WHERE id = $1::uuid AND session_id = $2::uuid`,
    [itemId, sessionId],
  );
  if (itemRes.rows.length === 0) {
    throw new HttpError(404, 'Elem nem található ebben az alkalomban', 'ITEM_NOT_FOUND');
  }
  const patientId: string = itemRes.rows[0].patientId;
  const checklist = normalizeChecklist(itemRes.rows[0].checklist);
  const entry = checklist.find((e) => e.key === key);
  if (!entry) {
    throw new HttpError(404, 'Checklist elem nem található', 'CHECKLIST_KEY_NOT_FOUND');
  }

  await ensurePatientVisibleForUser(patientId, auth, institutionId);

  const assigneeRes = await pool.query(
    `SELECT id FROM users
     WHERE id = $1::uuid AND active = true
       AND btrim(coalesce(intezmeny, '')) = btrim(coalesce($2::text, ''))`,
    [body.assigneeUserId, institutionId],
  );
  if (assigneeRes.rows.length === 0) {
    return NextResponse.json(
      { error: 'A kijelölt felhasználó nem található, inaktív, vagy nem ehhez az intézményhez tartozik' },
      { status: 400 },
    );
  }

  const sessionTitle = String(session.title ?? '').trim() || 'Konzílium';
  const checklistLabel = entry.label.trim() || 'Napirendi pont';
  const patientRow = await pool.query(`SELECT nev FROM patients WHERE id = $1::uuid`, [patientId]);
  const patientName = (patientRow.rows[0]?.nev as string | undefined)?.trim() || null;

  const title = `Konzílium: ${checklistLabel}`;
  const dueAtDate = body.dueAt ? new Date(body.dueAt) : null;
  const dueAtHu =
    dueAtDate && !Number.isNaN(dueAtDate.getTime())
      ? dueAtDate.toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' })
      : null;
  const descriptionParts = [
    patientName ? `Beteg: ${patientName}` : null,
    `Alkalom: ${sessionTitle}`,
    dueAtHu ? `Határidő: ${dueAtHu}` : null,
    body.note && body.note.length > 0 ? `Megjegyzés: ${body.note}` : null,
  ].filter(Boolean);
  const description = descriptionParts.length > 0 ? descriptionParts.join('\n') : null;

  const task = await insertUserTask({
    assigneeKind: 'staff',
    assigneeUserId: body.assigneeUserId,
    assigneePatientId: null,
    patientId,
    taskType: 'meeting_action',
    title,
    description,
    metadata: {
      source: 'consilium_checklist',
      consiliumSessionId: sessionId,
      consiliumItemId: itemId,
      checklistKey: key,
      sessionTitle,
      checklistLabel,
      ...(patientName && { patientName }),
      ...(body.dueAt && { dueAt: body.dueAt }),
      presentationPath: `/consilium/${sessionId}/present`,
    },
    createdByUserId: auth.userId,
    dueAt: dueAtDate && !Number.isNaN(dueAtDate.getTime()) ? dueAtDate : null,
  });

  return NextResponse.json({
    success: true,
    task: { id: task.id, title: task.title },
  });
});
