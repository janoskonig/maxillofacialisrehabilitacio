import { getDbPool } from './db';
import type { MessageChannel, MessageDeliveryStatusEvent } from './types/messaging';
import { emitMessageDeliveryStatusBatch } from './socket-server';

/** Szerveroldali kézbesítési állapot (042 migráció). */
export type ServerDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export function parseServerDeliveryStatus(raw: unknown): ServerDeliveryStatus {
  if (raw === 'delivered' || raw === 'read' || raw === 'failed') return raw;
  return 'sent';
}

export interface DeliveryStatusRowUpdate {
  messageId: string;
  deliveryStatus: 'delivered' | 'read';
  channel: MessageChannel;
  senderId: string;
  senderType?: 'patient' | 'doctor';
  patientId?: string;
  groupId?: string | null;
}

/** Socket szoba a küldő felé (Fázis 2). */
export function deliveryStatusEmitRoom(update: {
  channel: MessageChannel;
  senderId: string;
  senderType?: 'patient' | 'doctor';
}): string {
  if (update.channel === 'doctor') {
    return `user:${update.senderId}`;
  }
  if (update.senderType === 'patient') {
    return `patient:${update.senderId}`;
  }
  return `user:${update.senderId}`;
}

export function toDeliveryStatusEvent(row: DeliveryStatusRowUpdate): MessageDeliveryStatusEvent {
  return {
    messageId: row.messageId,
    deliveryStatus: row.deliveryStatus,
    channel: row.channel,
    patientId: row.patientId,
    groupId: row.groupId ?? undefined,
  };
}

/** Best-effort realtime értesítés a küldő(k) felé — soha ne dobjon a hívó rétegből. */
export function notifyDeliveryStatusUpdates(updates: DeliveryStatusRowUpdate[]): void {
  if (updates.length === 0) return;
  try {
    const items = updates.map((update) => ({
      room: deliveryStatusEmitRoom(update),
      event: toDeliveryStatusEvent(update),
    }));
    emitMessageDeliveryStatusBatch(items);
  } catch {
    // Socket nem elérhető (pl. külön API process) — csendben kihagyjuk.
  }
}

/**
 * Fázis 1.2 / 2 — A címzett megnyitja a beszélgetést: `sent` → `delivered`.
 * Visszaadja az érintett sorokat a socket emithez.
 */
export async function markDoctorMessagesDeliveredForViewer(
  messageIds: string[],
  viewerUserId: string,
): Promise<DeliveryStatusRowUpdate[]> {
  if (messageIds.length === 0) return [];

  const pool = getDbPool();
  const result = await pool.query<{
    id: string;
    sender_id: string;
    group_id: string | null;
  }>(
    `UPDATE doctor_messages
        SET delivery_status = 'delivered'
      WHERE id = ANY($1::uuid[])
        AND sender_id != $2
        AND delivery_status = 'sent'
      RETURNING id, sender_id, group_id`,
    [messageIds, viewerUserId],
  );

  return result.rows.map((row) => ({
    messageId: row.id,
    deliveryStatus: 'delivered' as const,
    channel: 'doctor' as const,
    senderId: row.sender_id,
    groupId: row.group_id,
  }));
}

/**
 * Beteg–orvos csatorna: a megtekintő szerepe alapján jelöljük kézbesítettnek
 * a neki szánt, még `sent` állapotú üzeneteket.
 */
export async function markPatientMessagesDeliveredForViewer(
  messageIds: string[],
  viewerRole: 'doctor' | 'patient',
  patientId: string,
): Promise<DeliveryStatusRowUpdate[]> {
  if (messageIds.length === 0) return [];

  const incomingSenderType = viewerRole === 'doctor' ? 'patient' : 'doctor';
  const pool = getDbPool();
  const result = await pool.query<{
    id: string;
    sender_id: string;
    sender_type: 'patient' | 'doctor';
    patient_id: string;
  }>(
    `UPDATE messages
        SET delivery_status = 'delivered'
      WHERE id = ANY($1::uuid[])
        AND sender_type = $2
        AND delivery_status = 'sent'
      RETURNING id, sender_id, sender_type, patient_id`,
    [messageIds, incomingSenderType],
  );

  return result.rows.map((row) => ({
    messageId: row.id,
    deliveryStatus: 'delivered' as const,
    channel: 'patient' as const,
    senderId: row.sender_id,
    senderType: row.sender_type,
    patientId: row.patient_id ?? patientId,
  }));
}

/** Olvasáskor `read` státusz socket értesítés egy üzenethez. */
export function buildPatientChannelReadDeliveryUpdate(row: {
  id: string;
  sender_id: string;
  sender_type: 'patient' | 'doctor';
  patient_id: string;
}): DeliveryStatusRowUpdate {
  return {
    messageId: row.id,
    deliveryStatus: 'read',
    channel: 'patient',
    senderId: row.sender_id,
    senderType: row.sender_type,
    patientId: row.patient_id,
  };
}

export function buildDoctorChannelReadDeliveryUpdate(row: {
  id: string;
  sender_id: string;
  group_id: string | null;
}): DeliveryStatusRowUpdate {
  return {
    messageId: row.id,
    deliveryStatus: 'read',
    channel: 'doctor',
    senderId: row.sender_id,
    groupId: row.group_id,
  };
}

/**
 * Fázis 3.2 — Csoport üzenet: ha minden más résztvevő olvasta, értesítjük
 * a küldőt `read` delivery státusszal.
 */
export async function notifyGroupMessageFullyReadIfNeeded(
  messageId: string,
  groupId: string,
): Promise<void> {
  const pool = getDbPool();
  const msgResult = await pool.query<{ sender_id: string; group_id: string | null }>(
    `SELECT sender_id, group_id FROM doctor_messages WHERE id = $1`,
    [messageId],
  );
  if (msgResult.rows.length === 0) return;

  const { sender_id: senderId, group_id: msgGroupId } = msgResult.rows[0];
  if (!msgGroupId || msgGroupId !== groupId) return;

  const participantsResult = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM doctor_message_group_participants WHERE group_id = $1`,
    [groupId],
  );
  const others = participantsResult.rows.filter((p) => p.user_id !== senderId);
  if (others.length === 0) return;

  const readsResult = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM doctor_message_reads WHERE message_id = $1`,
    [messageId],
  );
  const readIds = new Set(readsResult.rows.map((r) => r.user_id));
  const allRead = others.every((p) => readIds.has(p.user_id));
  if (!allRead) return;

  notifyDeliveryStatusUpdates([
    buildDoctorChannelReadDeliveryUpdate({
      id: messageId,
      sender_id: senderId,
      group_id: groupId,
    }),
  ]);
}
