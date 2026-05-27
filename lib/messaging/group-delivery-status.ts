import type { ServerDeliveryStatus } from '@/lib/types/messaging';

export interface GroupParticipantRef {
  userId: string;
}

export interface GroupMessageReadState {
  senderId: string;
  groupId?: string | null;
  readBy?: Array<{ userId: string }>;
  deliveryStatus?: ServerDeliveryStatus;
}

/**
 * Fázis 3.2 — Csoport chat: a küldő bubble kézbesítési ikonjához aggregált
 * állapot. A részletes „ki olvasta” lista továbbra is a `readBy` footerben van.
 *
 * - `read`: minden más résztvevő olvasta
 * - `delivered`: legalább egy másik olvasta, vagy a szerver már delivered-et jelzett
 * - egyébként a szerver `deliveryStatus` (sent / delivered)
 */
export function aggregateGroupSenderDeliveryStatus(
  message: GroupMessageReadState,
  currentUserId: string,
  participants: GroupParticipantRef[],
): ServerDeliveryStatus {
  const base = message.deliveryStatus ?? 'sent';
  if (!message.groupId || message.senderId !== currentUserId) {
    return base;
  }

  const others = participants.filter((p) => p.userId !== message.senderId);
  if (others.length === 0) return base;

  const readIds = new Set(message.readBy?.map((r) => r.userId) ?? []);
  const allRead = others.every((p) => readIds.has(p.userId));
  if (allRead) return 'read';
  if (readIds.size > 0 || base === 'delivered') return 'delivered';
  return base;
}
