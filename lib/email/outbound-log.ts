import { getDbPool } from '@/lib/db';
import { logger } from '@/lib/logger';

export type OutboundEmailStatus = 'sent' | 'failed';

export type EmailLogMetadata = Record<string, string | number | boolean | null | undefined>;

export interface OutboundEmailLogEntry {
  emailType: string;
  recipient: string;
  subject?: string | null;
  messageId?: string | null;
  status: OutboundEmailStatus;
  errorMessage?: string | null;
  sentBy?: string | null;
  metadata?: EmailLogMetadata;
}

export interface LastEmailLogSummary {
  status: OutboundEmailStatus;
  sentAt: string;
  sentBy: string | null;
  errorMessage: string | null;
  recipient: string;
}

/**
 * Kimenő email naplózása. Hiba esetén nem dob — a küldés sikerességét nem akadályozza.
 */
export async function logOutboundEmail(entry: OutboundEmailLogEntry): Promise<void> {
  try {
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO outbound_email_log (
         email_type, recipient, subject, message_id, status, error_message, sent_by, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        entry.emailType,
        entry.recipient,
        entry.subject ?? null,
        entry.messageId ?? null,
        entry.status,
        entry.errorMessage ?? null,
        entry.sentBy ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  } catch (error) {
    logger.error('Failed to log outbound email', {
      emailType: entry.emailType,
      recipient: entry.recipient,
      status: entry.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
