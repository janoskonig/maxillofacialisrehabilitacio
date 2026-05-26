import { NextResponse } from 'next/server';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import {
  assertSessionTransition,
  getScopedSessionOrThrow,
  getUserInstitution,
  updateSessionSchema,
} from '@/lib/consilium';
import { recordScheduledAtChange, scheduledAtChanged } from '@/lib/consilium-session-tracking';

export const dynamic = 'force-dynamic';

const SESSION_RETURNING = `
  id,
  title,
  institution_id as "institutionId",
  scheduled_at as "scheduledAt",
  status,
  attendees,
  invitation_send_count as "invitationSendCount",
  scheduled_at_change_count as "scheduledAtChangeCount"`;

export const PATCH = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  const existing = await getScopedSessionOrThrow(sessionId, institutionId);

  const body = updateSessionSchema.parse(await req.json());

  if (body.status) {
    assertSessionTransition(existing.status, body.status);
  }

  const attendeesJson = body.attendees !== undefined ? JSON.stringify(body.attendees) : null;
  const willRecordScheduleChange =
    body.scheduledAt != null && scheduledAtChanged(existing.scheduledAt, body.scheduledAt);

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
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
       RETURNING ${SESSION_RETURNING}`,
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
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Nem található' }, { status: 404 });
    }
    if (willRecordScheduleChange && body.scheduledAt) {
      await recordScheduledAtChange(client, {
        sessionId,
        oldScheduledAt: existing.scheduledAt,
        newScheduledAt: body.scheduledAt,
        changedBy: auth.email,
      });
    }
    const fresh = await client.query(
      `SELECT ${SESSION_RETURNING} FROM consilium_sessions WHERE id = $1::uuid`,
      [sessionId],
    );
    await client.query('COMMIT');
    return NextResponse.json({ session: fresh.rows[0] ?? result.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
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
