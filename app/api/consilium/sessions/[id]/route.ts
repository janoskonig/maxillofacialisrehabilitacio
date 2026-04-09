import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import {
  assertSessionTransition,
  getScopedSessionOrThrow,
  getUserInstitution,
  updateSessionSchema,
} from '@/lib/consilium';

export const dynamic = 'force-dynamic';

export const PATCH = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  const existing = await getScopedSessionOrThrow(sessionId, institutionId);

  const body = updateSessionSchema.parse(await req.json());

  if (body.status) {
    assertSessionTransition(existing.status, body.status);
  }

  const attendeesJson = body.attendees !== undefined ? JSON.stringify(body.attendees) : null;

  const pool = getDbPool();
  const result = await pool.query(
    `UPDATE consilium_sessions
     SET
       title = COALESCE($2, title),
       scheduled_at = COALESCE($3, scheduled_at),
       status = COALESCE($4, status),
       attendees = COALESCE($5::jsonb, attendees),
       updated_by = $6,
       updated_at = NOW()
     WHERE id = $1::uuid
       AND btrim(coalesce(institution_id, '')) = btrim(coalesce($7::text, ''))
     RETURNING id, title, institution_id as "institutionId", scheduled_at as "scheduledAt", status, attendees`,
    [
      sessionId,
      body.title ?? null,
      body.scheduledAt ?? null,
      body.status ?? null,
      attendeesJson,
      auth.email,
      institutionId,
    ],
  );

  return NextResponse.json({ session: result.rows[0] });
});

export const DELETE = authedHandler(async (_req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  await getScopedSessionOrThrow(sessionId, institutionId);

  const pool = getDbPool();
  await pool.query(
    `DELETE FROM consilium_sessions
     WHERE id = $1::uuid
       AND btrim(coalesce(institution_id, '')) = btrim(coalesce($2::text, ''))`,
    [sessionId, institutionId],
  );

  return NextResponse.json({ ok: true });
});
