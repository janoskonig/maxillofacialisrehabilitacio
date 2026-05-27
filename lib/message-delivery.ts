import { getDbPool } from './db';

/** Szerveroldali kézbesítési állapot (042 migráció). */
export type ServerDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export function parseServerDeliveryStatus(raw: unknown): ServerDeliveryStatus {
  if (raw === 'delivered' || raw === 'read' || raw === 'failed') return raw;
  return 'sent';
}

/**
 * Fázis 1.2 — A címzett megnyitja a beszélgetést: `sent` → `delivered`.
 * Csak olyan üzeneteket érint, amelyeket a megtekintő NEM küldött.
 */
export async function markDoctorMessagesDeliveredForViewer(
  messageIds: string[],
  viewerUserId: string,
): Promise<void> {
  if (messageIds.length === 0) return;

  const pool = getDbPool();
  await pool.query(
    `UPDATE doctor_messages
        SET delivery_status = 'delivered'
      WHERE id = ANY($1::uuid[])
        AND sender_id != $2
        AND delivery_status = 'sent'`,
    [messageIds, viewerUserId],
  );
}

/**
 * Beteg–orvos csatorna: a megtekintő szerepe alapján jelöljük kézbesítettnek
 * a neki szánt, még `sent` állapotú üzeneteket.
 */
export async function markPatientMessagesDeliveredForViewer(
  messageIds: string[],
  viewerRole: 'doctor' | 'patient',
): Promise<void> {
  if (messageIds.length === 0) return;

  const incomingSenderType = viewerRole === 'doctor' ? 'patient' : 'doctor';
  const pool = getDbPool();
  await pool.query(
    `UPDATE messages
        SET delivery_status = 'delivered'
      WHERE id = ANY($1::uuid[])
        AND sender_type = $2
        AND delivery_status = 'sent'`,
    [messageIds, incomingSenderType],
  );
}
