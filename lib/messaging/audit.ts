/**
 * Üzenet-specifikus audit napló (message_audit_events).
 * Best-effort: hiba esetén nem dob — a fő művelet sikeres marad.
 */

import { getDbPool } from '@/lib/db';
import type { MessageChannel } from '@/lib/types/messaging';
import type { MessageAuditEventType } from '@/lib/types/messaging';

export interface RecordMessageAuditInput {
  messageId: string;
  channel: MessageChannel;
  eventType: MessageAuditEventType;
  actorUserId?: string | null;
  payload?: Record<string, unknown>;
}

export async function recordMessageAuditEvent(
  input: RecordMessageAuditInput,
): Promise<string | null> {
  try {
    const pool = getDbPool();
    const result = await pool.query(
      `INSERT INTO message_audit_events (
         message_id, channel, event_type, actor_user_id, payload
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [
        input.messageId,
        input.channel,
        input.eventType,
        input.actorUserId ?? null,
        JSON.stringify(input.payload ?? {}),
      ],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.error('[recordMessageAuditEvent] failed:', err);
    return null;
  }
}
