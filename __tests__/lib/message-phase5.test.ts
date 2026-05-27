import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  filterMessagesByThreadCollapse,
  isDirectReplyVisible,
  countHiddenDirectReplies,
} from '@/lib/messaging/reply-thread-visibility';
import { checkRateLimitAsync, resetRateLimit } from '@/lib/api/rate-limit';

describe('reply-thread-visibility nested (Fázis 5.3)', () => {
  const nestedMessages = [
    { id: 'p1', replyToMessageId: null },
    { id: 'r1', replyToMessageId: 'p1' },
    { id: 'r1.1', replyToMessageId: 'r1' },
    { id: 'p2', replyToMessageId: null },
  ];

  it('hides nested replies when root thread is collapsed', () => {
    const collapsed = new Set(['p1']);
    expect(filterMessagesByThreadCollapse(nestedMessages, collapsed)).toEqual([
      nestedMessages[0],
      nestedMessages[3],
    ]);
    expect(countHiddenDirectReplies(nestedMessages, 'p1', collapsed)).toBe(2);
  });

  it('isDirectReplyVisible walks ancestor chain', () => {
    const collapsed = new Set(['p1']);
    const index = new Map(nestedMessages.map((m) => [m.id, m]));
    expect(
      isDirectReplyVisible({ id: 'r1.1', replyToMessageId: 'r1' }, collapsed, index),
    ).toBe(false);
    expect(
      isDirectReplyVisible({ id: 'r1', replyToMessageId: 'p1' }, collapsed, index),
    ).toBe(false);
  });
});

describe('checkRateLimitAsync (Fázis 5.1)', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    resetRateLimit();
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it('uses in-memory sliding window when REDIS_URL is unset', async () => {
    const opts = { key: 'async-fallback', limit: 2, windowMs: 60_000 };
    expect((await checkRateLimitAsync(opts)).allowed).toBe(true);
    expect((await checkRateLimitAsync(opts)).allowed).toBe(true);
    expect((await checkRateLimitAsync(opts)).allowed).toBe(false);
  });
});
