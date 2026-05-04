import { createHash, randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { HttpError } from '@/lib/auth-server';
import type { SessionStatus } from '@/lib/consilium';

export const INVITATION_PROPOSED_NOTE_MAX = 1000;

export const invitationResponseSchema = z.enum(['going', 'late', 'reschedule']);
export type InvitationResponse = z.infer<typeof invitationResponseSchema>;

export const submitInvitationResponseSchema = z
  .object({
    response: invitationResponseSchema,
    proposedAt: z.string().datetime().nullable().optional(),
    proposedNote: z
      .string()
      .trim()
      .max(INVITATION_PROPOSED_NOTE_MAX)
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.response === 'reschedule') {
      if (!data.proposedAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Adj meg javasolt időpontot',
          path: ['proposedAt'],
        });
        return;
      }
      const t = new Date(data.proposedAt);
      if (Number.isNaN(t.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Érvénytelen időpont',
          path: ['proposedAt'],
        });
      }
    }
  });

export function hashInvitationToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function generateInvitationTokenRaw(): string {
  return randomBytes(32).toString('base64url');
}

export type InvitationRow = {
  id: string;
  sessionId: string;
  attendeeId: string;
  attendeeName: string;
  attendeeEmail: string;
  createdBy: string;
  createdAt: string;
  sentAt: string | null;
  revokedAt: string | null;
  respondedAt: string | null;
  response: InvitationResponse | null;
  proposedAt: string | null;
  proposedNote: string | null;
};

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapInvitationRow(row: {
  id: string;
  sessionId: string;
  attendeeId: string;
  attendeeName: string;
  attendeeEmail: string;
  createdBy: string;
  createdAt: Date | string;
  sentAt: Date | string | null;
  revokedAt: Date | string | null;
  respondedAt: Date | string | null;
  response: string | null;
  proposedAt: Date | string | null;
  proposedNote: string | null;
}): InvitationRow {
  const respParsed = row.response ? invitationResponseSchema.safeParse(row.response) : null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    attendeeId: row.attendeeId,
    attendeeName: row.attendeeName,
    attendeeEmail: row.attendeeEmail,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt) ?? '',
    sentAt: toIso(row.sentAt),
    revokedAt: toIso(row.revokedAt),
    respondedAt: toIso(row.respondedAt),
    response: respParsed && respParsed.success ? respParsed.data : null,
    proposedAt: toIso(row.proposedAt),
    proposedNote: row.proposedNote,
  };
}

/**
 * Lekéri az alkalom összes (revoked-ot is tartalmazó) meghívóját.
 * A UI ebből készít státusz-összegzést a jelenlévők mellé.
 */
export async function listInvitationsForSession(sessionId: string): Promise<InvitationRow[]> {
  const pool = getDbPool();
  const r = await pool.query(
    `SELECT id,
            session_id as "sessionId",
            attendee_id as "attendeeId",
            attendee_name as "attendeeName",
            attendee_email as "attendeeEmail",
            created_by as "createdBy",
            created_at as "createdAt",
            sent_at as "sentAt",
            revoked_at as "revokedAt",
            responded_at as "respondedAt",
            response,
            proposed_at as "proposedAt",
            proposed_note as "proposedNote"
     FROM consilium_session_invitations
     WHERE session_id = $1::uuid
     ORDER BY created_at DESC`,
    [sessionId],
  );
  return r.rows.map(mapInvitationRow);
}

/**
 * Visszaadja az aktív (visszavonatlan) meghívót egy adott jelenlévőre, vagy `null`-t.
 */
export async function findActiveInvitationForAttendee(
  client: PoolClient,
  sessionId: string,
  attendeeId: string,
): Promise<InvitationRow | null> {
  const r = await client.query(
    `SELECT id,
            session_id as "sessionId",
            attendee_id as "attendeeId",
            attendee_name as "attendeeName",
            attendee_email as "attendeeEmail",
            created_by as "createdBy",
            created_at as "createdAt",
            sent_at as "sentAt",
            revoked_at as "revokedAt",
            responded_at as "respondedAt",
            response,
            proposed_at as "proposedAt",
            proposed_note as "proposedNote"
     FROM consilium_session_invitations
     WHERE session_id = $1::uuid
       AND attendee_id = $2
       AND revoked_at IS NULL
     LIMIT 1`,
    [sessionId, attendeeId],
  );
  if (r.rows.length === 0) return null;
  return mapInvitationRow(r.rows[0]);
}

/**
 * Aktív meghívó tokent ad vissza a jelenlévőhöz: ha már van, ugyanazt a linket
 * használja újra (megőrizve az addigi RSVP választ); ha nincs, újat hoz létre.
 *
 * `regenerate=true` esetén a meglévőt visszavonja és új tokent állít ki — ez
 * törli az addigi RSVP választ is.
 */
export async function ensureInvitationForAttendee(
  client: PoolClient,
  params: {
    sessionId: string;
    attendeeId: string;
    attendeeName: string;
    attendeeEmail: string;
    createdBy: string;
    regenerate?: boolean;
  },
): Promise<{ invitationId: string; rawToken: string; created: boolean; rotated: boolean }> {
  const existing = await client.query<{ id: string; rawToken: string | null }>(
    `SELECT id, raw_token AS "rawToken" FROM consilium_session_invitations
     WHERE session_id = $1::uuid AND attendee_id = $2 AND revoked_at IS NULL
     FOR UPDATE`,
    [params.sessionId, params.attendeeId],
  );

  if (existing.rows.length > 0 && !params.regenerate && existing.rows[0].rawToken) {
    return {
      invitationId: existing.rows[0].id,
      rawToken: existing.rows[0].rawToken,
      created: false,
      rotated: false,
    };
  }

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE consilium_session_invitations
       SET revoked_at = NOW()
       WHERE id = $1::uuid`,
      [existing.rows[0].id],
    );
  }

  const rawToken = generateInvitationTokenRaw();
  const tokenHash = hashInvitationToken(rawToken);

  const ins = await client.query<{ id: string }>(
    `INSERT INTO consilium_session_invitations (
       session_id, attendee_id, attendee_name, attendee_email, token_hash, raw_token, created_by
     )
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.sessionId,
      params.attendeeId,
      params.attendeeName,
      params.attendeeEmail,
      tokenHash,
      rawToken,
      params.createdBy,
    ],
  );

  return {
    invitationId: ins.rows[0].id,
    rawToken,
    created: existing.rows.length === 0,
    rotated: existing.rows.length > 0,
  };
}

export async function markInvitationSent(client: PoolClient, invitationId: string): Promise<void> {
  await client.query(
    `UPDATE consilium_session_invitations
     SET sent_at = NOW()
     WHERE id = $1::uuid`,
    [invitationId],
  );
}

export type InvitationTokenResolution = {
  invitationId: string;
  sessionId: string;
  attendeeId: string;
  attendeeName: string;
  attendeeEmail: string;
  sessionTitle: string;
  sessionScheduledAt: string;
  sessionStatus: SessionStatus;
  responded: boolean;
  response: InvitationResponse | null;
  respondedAt: string | null;
  proposedAt: string | null;
  proposedNote: string | null;
};

/**
 * Token feloldása az RSVP-oldalhoz / API-hoz. Visszavont token esetén `null`-t ad
 * vissza. Lezárt alkalomra már nem fogadunk el RSVP-t (a hívó a `sessionStatus`
 * alapján dönthet a hibaüzenetről).
 */
export async function resolveInvitationToken(
  rawToken: string,
): Promise<InvitationTokenResolution | null> {
  const pool = getDbPool();
  const hash = hashInvitationToken(rawToken.trim());
  const r = await pool.query<{
    invitationId: string;
    sessionId: string;
    attendeeId: string;
    attendeeName: string;
    attendeeEmail: string;
    sessionTitle: string;
    sessionScheduledAt: Date | string;
    sessionStatus: string;
    respondedAt: Date | string | null;
    response: string | null;
    proposedAt: Date | string | null;
    proposedNote: string | null;
  }>(
    `SELECT inv.id as "invitationId",
            inv.session_id as "sessionId",
            inv.attendee_id as "attendeeId",
            inv.attendee_name as "attendeeName",
            inv.attendee_email as "attendeeEmail",
            s.title as "sessionTitle",
            s.scheduled_at as "sessionScheduledAt",
            s.status as "sessionStatus",
            inv.responded_at as "respondedAt",
            inv.response,
            inv.proposed_at as "proposedAt",
            inv.proposed_note as "proposedNote"
     FROM consilium_session_invitations inv
     JOIN consilium_sessions s ON s.id = inv.session_id
     WHERE inv.token_hash = $1
       AND inv.revoked_at IS NULL
     LIMIT 1`,
    [hash],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const status = row.sessionStatus as SessionStatus;
  if (status !== 'draft' && status !== 'active' && status !== 'closed') return null;
  const respParsed = row.response ? invitationResponseSchema.safeParse(row.response) : null;
  return {
    invitationId: row.invitationId,
    sessionId: row.sessionId,
    attendeeId: row.attendeeId,
    attendeeName: row.attendeeName,
    attendeeEmail: row.attendeeEmail,
    sessionTitle: row.sessionTitle,
    sessionScheduledAt: toIso(row.sessionScheduledAt) ?? '',
    sessionStatus: status,
    responded: row.respondedAt != null,
    response: respParsed && respParsed.success ? respParsed.data : null,
    respondedAt: toIso(row.respondedAt),
    proposedAt: toIso(row.proposedAt),
    proposedNote: row.proposedNote,
  };
}

export async function assertInvitationTokenOrThrow(
  rawToken: string,
): Promise<InvitationTokenResolution> {
  const x = await resolveInvitationToken(rawToken);
  if (!x) {
    throw new HttpError(404, 'Érvénytelen vagy visszavont meghívó link', 'INVITATION_TOKEN_INVALID');
  }
  return x;
}

export async function recordInvitationResponse(
  invitationId: string,
  response: InvitationResponse,
  proposedAt: string | null,
  proposedNote: string | null,
): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `UPDATE consilium_session_invitations
     SET response = $2,
         proposed_at = $3,
         proposed_note = $4,
         responded_at = NOW()
     WHERE id = $1::uuid
       AND revoked_at IS NULL`,
    [invitationId, response, proposedAt, proposedNote],
  );
}
