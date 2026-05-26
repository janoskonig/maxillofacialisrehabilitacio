import type { PoolClient } from 'pg';

/** Igaz, ha a két időpont különbözik (ms pontosság). */
export function scheduledAtChanged(prev: string | Date, nextIso: string): boolean {
  const oldMs = new Date(prev).getTime();
  const newMs = new Date(nextIso).getTime();
  return !Number.isNaN(oldMs) && !Number.isNaN(newMs) && oldMs !== newMs;
}

/** Sikeres meghívó-email után: sent_at, számlálók, naplósor. */
export async function recordInvitationEmailSent(
  client: PoolClient,
  params: {
    invitationId: string;
    sessionId: string;
    attendeeId: string;
    sentBy: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE consilium_session_invitations
     SET sent_at = NOW(),
         send_count = send_count + 1
     WHERE id = $1::uuid`,
    [params.invitationId],
  );
  await client.query(
    `UPDATE consilium_sessions
     SET invitation_send_count = invitation_send_count + 1
     WHERE id = $1::uuid`,
    [params.sessionId],
  );
  await client.query(
    `INSERT INTO consilium_invitation_send_log (
       session_id, invitation_id, attendee_id, sent_by
     ) VALUES ($1::uuid, $2::uuid, $3, $4)`,
    [params.sessionId, params.invitationId, params.attendeeId, params.sentBy],
  );
}

/** Időpont módosítás után: számláló + audit sor (a scheduled_at UPDATE már megtörtént). */
export async function recordScheduledAtChange(
  client: PoolClient,
  params: {
    sessionId: string;
    oldScheduledAt: string | Date;
    newScheduledAt: string | Date;
    changedBy: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE consilium_sessions
     SET scheduled_at_change_count = scheduled_at_change_count + 1
     WHERE id = $1::uuid`,
    [params.sessionId],
  );
  await client.query(
    `INSERT INTO consilium_session_schedule_audit (
       session_id, old_scheduled_at, new_scheduled_at, changed_by
     ) VALUES ($1::uuid, $2::timestamptz, $3::timestamptz, $4)`,
    [params.sessionId, params.oldScheduledAt, params.newScheduledAt, params.changedBy],
  );
}
