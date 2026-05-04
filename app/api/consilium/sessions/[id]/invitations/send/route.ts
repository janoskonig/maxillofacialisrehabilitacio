import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authedHandler } from '@/lib/api/route-handler';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import {
  getScopedSessionOrThrow,
  getUserInstitution,
  normalizeSessionAttendees,
} from '@/lib/consilium';
import {
  ensureInvitationForAttendee,
  markInvitationSent,
} from '@/lib/consilium-invitations';
import { sendConsiliumInvitationEmail } from '@/lib/email';
import { logActivityWithAuth } from '@/lib/activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const NOTE_MAX = 1000;

const sendInvitationsBodySchema = z.object({
  attendeeIds: z.array(z.string().min(1).max(64)).optional(),
  note: z.string().trim().max(NOTE_MAX).optional(),
  /**
   * Ha igaz, az aktív tokent rotáljuk (új linket kapnak, addigi RSVP törlődik).
   * Alapból false: meglévő linket küldjük újra ugyanahhoz a címzetthez.
   */
  regenerate: z.boolean().optional(),
});

function resolvePublicBaseUrl(req: Request): string {
  const envBase = (process.env.NEXT_PUBLIC_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/+$/, '');
  const h = req.headers;
  const xfHost = (h.get('x-forwarded-host') || '').trim();
  const host = xfHost || (h.get('host') || '').trim();
  const xfProto = (h.get('x-forwarded-proto') || '').trim();
  const proto =
    xfProto || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
  if (host) return `${proto}://${host}`;
  return 'https://rehabilitacios-protetika.hu';
}

/**
 * Konzílium meghívó(k) kiküldése a kiválasztott alkalom jelenlévőinek.
 * - `attendeeIds` nélkül: minden olyan jelenlévőnek küld, akinek van email-fiókja.
 * - `attendeeIds` listával: csak a megadott id-knak (subset).
 * - Lezárt alkalomra nem küld új meghívót.
 *
 * A levél RSVP linket tartalmaz: `Ott leszek` / `Kések` / `Máskor lenne jó`.
 */
export const POST = authedHandler(async (req, { auth, params }) => {
  const sessionId = params.id;
  const institutionId = await getUserInstitution(auth);
  const session = await getScopedSessionOrThrow(sessionId, institutionId);

  if (session.status === 'closed') {
    throw new HttpError(409, 'Lezárt alkalomra nem küldhető meghívó', 'SESSION_CLOSED');
  }

  const body = await req.json().catch(() => ({}));
  const parsed = sendInvitationsBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'Érvénytelen kérés', 'INVALID_REQUEST');
  }
  const { attendeeIds, note, regenerate } = parsed.data;

  const allAttendees = normalizeSessionAttendees(session.attendees);
  if (allAttendees.length === 0) {
    throw new HttpError(400, 'Az alkalmon nincs jelenlévő', 'NO_ATTENDEES');
  }

  const wantedIdSet = attendeeIds ? new Set(attendeeIds) : null;
  const targetAttendees = wantedIdSet
    ? allAttendees.filter((a) => wantedIdSet.has(a.id))
    : allAttendees;

  if (targetAttendees.length === 0) {
    throw new HttpError(400, 'Egyik megadott jelenlévő sem szerepel az alkalmon', 'NO_TARGET_ATTENDEES');
  }

  const pool = getDbPool();
  // Az attendee.id a users.id (lásd app/consilium/page.tsx ConsiliumAttendeeTagField → pick).
  // Régi/manuálisan szerkesztett alkalmaknál nem feltétlenül UUID — ezeket itt kihagyjuk
  // a query-ből, és a `userById` Map-ben sem lesznek meg → 'no_user' skipReason-nel jelennek meg.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uuidAttendeeIds = targetAttendees.map((a) => a.id).filter((id) => UUID_RE.test(id));
  const userById = new Map<
    string,
    { id: string; email: string; active: boolean; doktorNeve: string | null }
  >();
  if (uuidAttendeeIds.length > 0) {
    const usersRes = await pool.query<{
      id: string;
      email: string;
      active: boolean;
      doktorNeve: string | null;
    }>(
      `SELECT id, email, active, doktor_neve as "doktorNeve"
       FROM users
       WHERE id = ANY($1::uuid[])`,
      [uuidAttendeeIds],
    );
    for (const u of usersRes.rows) userById.set(u.id, u);
  }

  const senderRes = await pool.query<{ doktorNeve: string | null }>(
    `SELECT doktor_neve as "doktorNeve" FROM users WHERE id = $1`,
    [auth.userId],
  );
  const senderName = senderRes.rows[0]?.doktorNeve?.trim?.() || null;

  // Csak a darabszámot emlegetjük emailben (érzékeny adat ne menjen ki) — a
  // részletes lista az auth-gated agenda oldalon látható.
  const patientCountRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM consilium_session_items WHERE session_id = $1::uuid`,
    [sessionId],
  );
  const patientCount = Number(patientCountRes.rows[0]?.count ?? '0') || 0;

  const baseUrl = resolvePublicBaseUrl(req);
  const sessionScheduledAt = new Date(session.scheduledAt);
  const agendaUrl = `${baseUrl}/consilium/sessions/${encodeURIComponent(sessionId)}/agenda`;

  type SendOutcome = {
    attendeeId: string;
    attendeeName: string;
    attendeeEmail: string | null;
    sent: boolean;
    rotated: boolean;
    skipReason?: 'no_user' | 'inactive' | 'no_email' | 'email_failed';
  };
  const results: SendOutcome[] = [];

  for (const att of targetAttendees) {
    const u = userById.get(att.id);
    if (!u) {
      results.push({
        attendeeId: att.id,
        attendeeName: att.name,
        attendeeEmail: null,
        sent: false,
        rotated: false,
        skipReason: 'no_user',
      });
      continue;
    }
    if (!u.active) {
      results.push({
        attendeeId: att.id,
        attendeeName: att.name,
        attendeeEmail: u.email,
        sent: false,
        rotated: false,
        skipReason: 'inactive',
      });
      continue;
    }
    const recipientEmail = (u.email || '').trim();
    if (!recipientEmail) {
      results.push({
        attendeeId: att.id,
        attendeeName: att.name,
        attendeeEmail: null,
        sent: false,
        rotated: false,
        skipReason: 'no_email',
      });
      continue;
    }

    const client = await pool.connect();
    let rawTokenForLink: string;
    let invitationId: string;
    let rotated = false;
    try {
      await client.query('BEGIN');
      const ensured = await ensureInvitationForAttendee(client, {
        sessionId,
        attendeeId: att.id,
        attendeeName: att.name,
        attendeeEmail: recipientEmail,
        createdBy: auth.email,
        regenerate: regenerate === true,
      });
      invitationId = ensured.invitationId;
      rawTokenForLink = ensured.rawToken;
      rotated = ensured.rotated;

      await markInvitationSent(client, invitationId);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('[consilium-invitations.send] DB error', {
        attendeeId: att.id,
        sessionId,
        error: String(e),
      });
      results.push({
        attendeeId: att.id,
        attendeeName: att.name,
        attendeeEmail: recipientEmail,
        sent: false,
        rotated: false,
        skipReason: 'email_failed',
      });
      client.release();
      continue;
    } finally {
      client.release();
    }

    const rsvpUrl = `${baseUrl}/consilium/rsvp/${encodeURIComponent(rawTokenForLink)}`;

    try {
      await sendConsiliumInvitationEmail(
        recipientEmail,
        u.doktorNeve || att.name,
        senderName,
        session.title,
        sessionScheduledAt,
        rsvpUrl,
        baseUrl,
        note ?? null,
        { patientCount, agendaUrl },
      );
      results.push({
        attendeeId: att.id,
        attendeeName: att.name,
        attendeeEmail: recipientEmail,
        sent: true,
        rotated,
      });
    } catch (emailError) {
      logger.error('[consilium-invitations.send] email failed', {
        attendeeId: att.id,
        sessionId,
        error: String(emailError),
      });
      results.push({
        attendeeId: att.id,
        attendeeName: att.name,
        attendeeEmail: recipientEmail,
        sent: false,
        rotated,
        skipReason: 'email_failed',
      });
    }
  }

  const sentCount = results.filter((r) => r.sent).length;

  await logActivityWithAuth(
    req,
    auth,
    'consilium_invitation_sent',
    `Konzílium meghívó kiküldve ${sentCount}/${targetAttendees.length} címzettnek (session=${sessionId})`,
  );

  return NextResponse.json(
    {
      sentCount,
      totalCount: targetAttendees.length,
      results,
    },
    { status: 200 },
  );
});
