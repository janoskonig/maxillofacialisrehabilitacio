import { describe, expect, it } from 'vitest';
import { aggregateGroupSenderDeliveryStatus } from '@/lib/messaging/group-delivery-status';
import { incrementParentReplyCount } from '@/components/messaging/reply-count-socket';

describe('aggregateGroupSenderDeliveryStatus (Fázis 3.2)', () => {
  const participants = [{ userId: 'me' }, { userId: 'a' }, { userId: 'b' }];

  it('returns read when every other participant read', () => {
    expect(
      aggregateGroupSenderDeliveryStatus(
        {
          senderId: 'me',
          groupId: 'g1',
          readBy: [{ userId: 'a' }, { userId: 'b' }],
          deliveryStatus: 'delivered',
        },
        'me',
        participants,
      ),
    ).toBe('read');
  });

  it('returns delivered when only some read', () => {
    expect(
      aggregateGroupSenderDeliveryStatus(
        {
          senderId: 'me',
          groupId: 'g1',
          readBy: [{ userId: 'a' }],
          deliveryStatus: 'sent',
        },
        'me',
        participants,
      ),
    ).toBe('delivered');
  });

  it('ignores non-own messages', () => {
    expect(
      aggregateGroupSenderDeliveryStatus(
        { senderId: 'other', groupId: 'g1', deliveryStatus: 'sent' },
        'me',
        participants,
      ),
    ).toBe('sent');
  });
});

describe('incrementParentReplyCount (Fázis 3.3)', () => {
  it('increments replyCount on parent message', () => {
    const messages = [
      { id: 'parent', replyCount: 1 },
      { id: 'child', replyToMessageId: 'parent' },
    ];
    const next = incrementParentReplyCount(messages, 'parent');
    expect(next[0].replyCount).toBe(2);
    expect(next[1]).toBe(messages[1]);
  });

  it('no-ops when parent not in list', () => {
    const messages = [{ id: 'a', replyCount: 0 }];
    expect(incrementParentReplyCount(messages, 'missing')).toBe(messages);
  });
});
