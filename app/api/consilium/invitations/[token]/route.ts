import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/route-handler';
import { HttpError } from '@/lib/auth-server';
import {
  assertInvitationTokenOrThrow,
  recordInvitationResponse,
  submitInvitationResponseSchema,
} from '@/lib/consilium-invitations';
import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Publikus, token-alapú RSVP végpont. A token feloldása maga az auth: aki ismeri,
 * jelezhet vissza. Lezárt alkalomra már nem fogadunk el választ.
 */
export const GET = apiHandler(async (_req, { params }) => {
  const token = params.token;
  if (!token) {
    throw new HttpError(400, 'Hiányzó token', 'MISSING_TOKEN');
  }
  const resolved = await assertInvitationTokenOrThrow(token);
  return NextResponse.json({
    invitation: {
      attendeeName: resolved.attendeeName,
      sessionTitle: resolved.sessionTitle,
      sessionScheduledAt: resolved.sessionScheduledAt,
      sessionStatus: resolved.sessionStatus,
      responded: resolved.responded,
      response: resolved.response,
      respondedAt: resolved.respondedAt,
      proposedAt: resolved.proposedAt,
      proposedNote: resolved.proposedNote,
    },
  });
});

export const POST = apiHandler(async (req, { params }) => {
  const token = params.token;
  if (!token) {
    throw new HttpError(400, 'Hiányzó token', 'MISSING_TOKEN');
  }
  const resolved = await assertInvitationTokenOrThrow(token);
  if (resolved.sessionStatus === 'closed') {
    throw new HttpError(409, 'A konzílium alkalom már lezárult', 'SESSION_CLOSED');
  }

  const body = await req.json().catch(() => ({}));
  const parsed = submitInvitationResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'Érvénytelen RSVP adat', 'INVALID_REQUEST');
  }
  const { response, proposedAt, proposedNote } = parsed.data;

  const proposedAtForDb = response === 'reschedule' ? (proposedAt ?? null) : null;
  const proposedNoteForDb =
    response === 'reschedule' && proposedNote && proposedNote.length > 0 ? proposedNote : null;

  await recordInvitationResponse(
    resolved.invitationId,
    response,
    proposedAtForDb,
    proposedNoteForDb,
  );

  // Activity log a szervezőnek (best-effort, nem kritikus).
  try {
    const pool = getDbPool();
    const ipHeader = req.headers.get('x-forwarded-for') || '';
    const ipAddress = ipHeader.split(',')[0]?.trim() || null;
    const detail = `Konzílium RSVP: ${resolved.attendeeName} → ${response}` +
      (response === 'reschedule' && proposedAtForDb
        ? ` (javasolt: ${new Date(proposedAtForDb).toLocaleString('hu-HU')})`
        : '');
    await pool.query(
      `INSERT INTO activity_logs (user_email, action, detail, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [resolved.attendeeEmail, 'consilium_rsvp_submitted', detail, ipAddress],
    );
  } catch (e) {
    logger.error('[consilium-invitations.respond] activity log failed', { error: String(e) });
  }

  return NextResponse.json({
    ok: true,
    response,
    proposedAt: proposedAtForDb,
    proposedNote: proposedNoteForDb,
  });
});
