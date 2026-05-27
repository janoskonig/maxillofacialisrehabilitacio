import { describe, expect, it } from 'vitest';
import { attachReplyCounts } from '@/lib/message-reply-counts';
import { parseServerDeliveryStatus } from '@/lib/message-delivery';

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
