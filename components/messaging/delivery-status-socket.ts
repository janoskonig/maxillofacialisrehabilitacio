import type { MessageDeliveryStatusEvent, ServerDeliveryStatus } from '@/lib/types/messaging';

type MessageWithDelivery = {
  id: string;
  deliveryStatus?: ServerDeliveryStatus;
  readAt?: Date | null;
};

/**
 * Fázis 2 — Socket `message-delivery-status` esemény alkalmazása egy
 * üzenetlistára. A `read` státusz beállítja a `readAt`-ot is (ha még nincs).
 */
export function applyDeliveryStatusUpdate<T extends MessageWithDelivery>(
  messages: T[],
  event: MessageDeliveryStatusEvent,
): T[] {
  return messages.map((m) => {
    if (m.id !== event.messageId) return m;
    return {
      ...m,
      deliveryStatus: event.deliveryStatus,
      readAt:
        event.deliveryStatus === 'read'
          ? m.readAt ?? new Date()
          : m.readAt,
    };
  });
}

/** Beteg csatorna: csak az adott beteg szál üzeneteire reagálunk. */
export function isPatientChannelDeliveryEvent(
  event: MessageDeliveryStatusEvent,
  patientId: string,
): boolean {
  return event.channel === 'patient' && event.patientId === patientId;
}

/** Orvos csatorna 1:1: nincs groupId az eseményben. */
export function isDoctorDirectDeliveryEvent(
  event: MessageDeliveryStatusEvent,
  selectedDoctorId: string | null,
): boolean {
  return event.channel === 'doctor' && !event.groupId && !!selectedDoctorId;
}

/** Orvos csatorna csoport: groupId egyezés. */
export function isDoctorGroupDeliveryEvent(
  event: MessageDeliveryStatusEvent,
  selectedGroupId: string | null,
): boolean {
  return event.channel === 'doctor' && !!event.groupId && event.groupId === selectedGroupId;
}
