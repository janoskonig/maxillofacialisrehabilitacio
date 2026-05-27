import { describe, expect, it } from 'vitest';
import { attachReplyCounts } from '@/lib/message-reply-counts';
import {
  parseServerDeliveryStatus,
  deliveryStatusEmitRoom,
  buildPatientChannelReadDeliveryUpdate,
} from '@/lib/message-delivery';
import {
  applyDeliveryStatusUpdate,
  isPatientChannelDeliveryEvent,
} from '@/components/messaging/delivery-status-socket';

describe('attachReplyCounts', () => {
  it('maps counts by message id, defaulting missing to 0', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const map = new Map([
      ['a', 2],
      ['c', 1],
    ]);
    expect(attachReplyCounts(items, map)).toEqual([
      { id: 'a', replyCount: 2 },
      { id: 'b', replyCount: 0 },
      { id: 'c', replyCount: 1 },
    ]);
  });
});

describe('parseServerDeliveryStatus', () => {
  it('accepts known server values', () => {
    expect(parseServerDeliveryStatus('delivered')).toBe('delivered');
    expect(parseServerDeliveryStatus('read')).toBe('read');
    expect(parseServerDeliveryStatus('failed')).toBe('failed');
  });

  it('defaults unknown values to sent', () => {
    expect(parseServerDeliveryStatus(null)).toBe('sent');
    expect(parseServerDeliveryStatus('pending')).toBe('sent');
  });
});

describe('deliveryStatusEmitRoom (Fázis 2)', () => {
  it('routes doctor channel to user room', () => {
    expect(
      deliveryStatusEmitRoom({ channel: 'doctor', senderId: 'doc-1' }),
    ).toBe('user:doc-1');
  });

  it('routes patient sender to patient room', () => {
    expect(
      deliveryStatusEmitRoom({ channel: 'patient', senderId: 'pat-1', senderType: 'patient' }),
    ).toBe('patient:pat-1');
  });

  it('routes doctor sender on patient channel to user room', () => {
    expect(
      deliveryStatusEmitRoom({ channel: 'patient', senderId: 'doc-1', senderType: 'doctor' }),
    ).toBe('user:doc-1');
  });
});

describe('applyDeliveryStatusUpdate (Fázis 2)', () => {
  it('updates deliveryStatus and readAt on read', () => {
    const messages = [{ id: 'm1', deliveryStatus: 'sent' as const, readAt: null }];
    const updated = applyDeliveryStatusUpdate(messages, {
      messageId: 'm1',
      deliveryStatus: 'read',
      channel: 'patient',
      patientId: 'p1',
    });
    expect(updated[0].deliveryStatus).toBe('read');
    expect(updated[0].readAt).toBeInstanceOf(Date);
  });

  it('filters patient channel events by patientId', () => {
    expect(
      isPatientChannelDeliveryEvent(
        { messageId: 'm1', deliveryStatus: 'delivered', channel: 'patient', patientId: 'p1' },
        'p1',
      ),
    ).toBe(true);
    expect(
      isPatientChannelDeliveryEvent(
        { messageId: 'm1', deliveryStatus: 'delivered', channel: 'patient', patientId: 'p2' },
        'p1',
      ),
    ).toBe(false);
  });
});

describe('buildPatientChannelReadDeliveryUpdate', () => {
  it('builds read update for doctor sender', () => {
    const update = buildPatientChannelReadDeliveryUpdate({
      id: 'msg-1',
      sender_id: 'doc-1',
      sender_type: 'doctor',
      patient_id: 'pat-1',
    });
    expect(update.deliveryStatus).toBe('read');
    expect(update.senderType).toBe('doctor');
    expect(deliveryStatusEmitRoom(update)).toBe('user:doc-1');
  });
});
